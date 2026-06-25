import { Notice, Plugin, TFile } from 'obsidian';
import { AutoTagNotesSettings, AutoTagNotesSettingTab, AutoTagSettings, DEFAULT_SETTINGS, parseExcludeFolders } from './settings';
import { AutoTagger } from './autoTagger';
import { NavEventRef, NotebookNavigatorAPI, getNotebookNavigatorApi } from './nnApi';
import { ExtractorSettings, tryCompileRegex } from './converter/tagExtractor';
import { ConversionResult, ExistingOnlyContext, buildPreviewMarkdown, buildVaultTagFileMap, convertFiles, dryRunScan } from './converter/inlineTagConverter';
import { ConversionLog, writeConversionLog } from './transactionLog';
import { ScopeSelection, promptScope } from './ui/scopeDialog';
import { showPreview } from './ui/previewModal';
import { confirmConversion } from './ui/confirmDialog';
import { ProgressModal } from './ui/progressModal';
import { showSummary } from './ui/summaryModal';

export default class AutoTagNotesPlugin extends Plugin {
    settings: AutoTagNotesSettings = DEFAULT_SETTINGS;
    private autoTagger!: AutoTagger;
    private navEventRef: NavEventRef | null = null;
    private converterRunning = false;

    async onload(): Promise<void> {
        await this.loadSettings();

        this.autoTagger = new AutoTagger(
            this.app,
            () => this.getNavigatorApi(),
            () => this.getAutoTagSettings()
        );

        this.addSettingTab(new AutoTagNotesSettingTab(this.app, this));

        this.addCommand({
            id: 'convert-inline-tags',
            name: 'Convert inline tags to frontmatter',
            callback: () => this.runConverter()
        });

        // Register the create listener only after layout is ready. During initial vault load Obsidian
        // fires 'create' for every existing file; deferring avoids auto-tagging the whole vault.
        this.app.workspace.onLayoutReady(() => {
            this.registerEvent(this.app.vault.on('create', file => this.autoTagger.handleCreate(file)));
            this.subscribeToNavigator();
        });
    }

    onunload(): void {
        this.unsubscribeFromNavigator();
    }

    private getNavigatorApi(): NotebookNavigatorAPI | null {
        return getNotebookNavigatorApi(this.app);
    }

    private getAutoTagSettings(): AutoTagSettings {
        return {
            autoTaggerEnabled: this.settings.autoTaggerEnabled,
            excludeFolders: parseExcludeFolders(this.settings.excludeFolders)
        };
    }

    private getExtractorSettings(): ExtractorSettings {
        return {
            hexColorFilter: this.settings.hexColorFilter,
            skipShortNumericTags: this.settings.skipShortNumericTags,
            customExcludePattern: tryCompileRegex(this.settings.customExcludeRegex).pattern
        };
    }

    // ── Notebook Navigator subscription (nav-item-changed cache) ──────────────

    private subscribeToNavigator(): void {
        if (this.trySubscribeToNavigator()) {
            return;
        }
        // NN may load after us; poll a bounded number of times. Live getNavItem() still works when
        // the navigator pane is open even without the cache, so this is best-effort.
        let attempts = 0;
        const interval = window.setInterval(() => {
            attempts += 1;
            if (this.trySubscribeToNavigator() || attempts >= 10) {
                window.clearInterval(interval);
            }
        }, 2000);
        this.registerInterval(interval); // cleared on unload as a safety net
    }

    /** Returns true once a subscription attempt should stop (subscribed, or NN unavailable-but-tried). */
    private trySubscribeToNavigator(): boolean {
        if (this.navEventRef) {
            return true;
        }
        const api = this.getNavigatorApi();
        if (!api?.on) {
            return false;
        }
        try {
            this.navEventRef = api.on('nav-item-changed', data => this.autoTagger.handleNavItemChanged(data.item));
        } catch (error) {
            console.error('[inherit-tags] Failed to subscribe to Notebook Navigator:', error);
        }
        return true;
    }

    private unsubscribeFromNavigator(): void {
        if (!this.navEventRef) {
            return;
        }
        const api = this.getNavigatorApi();
        try {
            if (api?.offref) {
                api.offref(this.navEventRef);
            } else if (api?.off) {
                api.off('nav-item-changed', this.navEventRef);
            }
        } catch (error) {
            console.error('[inherit-tags] Failed to unsubscribe from Notebook Navigator:', error);
        }
        this.navEventRef = null;
    }

    // ── Feature B entry point ─────────────────────────────────────────────────

    runConverter(): void {
        if (this.converterRunning) {
            new Notice('Inherit Tags: a conversion is already in progress.');
            return;
        }
        // Fire-and-forget; internal errors are surfaced via Notice.
        void this.runConverterFlow();
    }

    private async runConverterFlow(): Promise<void> {
        this.converterRunning = true;
        try {
            const scope = await promptScope(this.app);
            if (!scope) {
                return;
            }

            const files = this.collectFiles(scope);
            if (files.length === 0) {
                new Notice('Inherit Tags: no markdown files found in the selected scope.');
                return;
            }

            const settings = this.getExtractorSettings();

            // Warn once if the user typed a custom exclusion regex that doesn't compile (it's ignored).
            const regexCheck = tryCompileRegex(this.settings.customExcludeRegex);
            if (this.settings.customExcludeRegex.trim().length > 0 && regexCheck.error) {
                new Notice(`Inherit Tags: ignoring invalid custom exclusion regex (${regexCheck.error}).`);
            }

            // Snapshot the vault's tag→files index once (before any edits) for existing-tags-only mode.
            const existingOnly: ExistingOnlyContext | null = this.settings.convertExistingOnly
                ? { tagFiles: buildVaultTagFileMap(this.app), stripSingleNote: this.settings.stripSingleNoteTags }
                : null;

            new Notice(`Inherit Tags: scanning ${files.length} ${files.length === 1 ? 'file' : 'files'}…`);
            const previews = await dryRunScan(this.app, files, settings, {}, existingOnly);

            const scopeLabel = scope.type === 'all' ? 'all' : `folder:${scope.folder}`;
            const onExport = async () => {
                // Mirror transactionLog.getLogPath's fallback: manifest.dir is optional in the API.
                const dir = this.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.manifest.id}`;
                const path = `${dir}/conversion-preview.md`;
                try {
                    await this.app.vault.adapter.write(path, buildPreviewMarkdown(previews, scopeLabel));
                    new Notice(`Preview report written to ${path}`);
                } catch (error) {
                    console.error('[inherit-tags] Failed to export preview:', error);
                    new Notice('Inherit Tags: failed to export preview report (see console).');
                }
            };

            const action = await showPreview(this.app, previews, onExport);
            if (action !== 'proceed' || previews.length === 0) {
                return;
            }

            const confirmed = await confirmConversion(this.app, previews.length);
            if (!confirmed) {
                return;
            }

            const targetFiles = previews
                .map(preview => this.app.vault.getAbstractFileByPath(preview.path))
                .filter((file): file is TFile => file instanceof TFile);

            const progress = new ProgressModal(this.app);
            progress.open();

            const results = await convertFiles(this.app, targetFiles, settings, {
                onProgress: info => progress.update(info),
                shouldCancel: () => progress.isCancelled()
            }, existingOnly);

            const cancelled = progress.isCancelled();
            progress.markCompleted();
            progress.close();

            const log = this.buildLog(scopeLabel, files.length, results);
            // null when the write failed; the summary omits the log line in that case, so don't
            // substitute a path that doesn't exist on disk.
            const logPath = await writeConversionLog(this, log);

            const ok = results.filter(r => r.status === 'ok').length;
            const failed = results.filter(r => r.status === 'failed').length;
            new Notice(`Inherit Tags: converted ${ok} ${ok === 1 ? 'file' : 'files'}${failed > 0 ? `, ${failed} failed` : ''}.`);

            showSummary(this.app, { results, cancelled, logPath });
        } catch (error) {
            console.error('[inherit-tags] Converter failed:', error);
            new Notice('Inherit Tags: conversion failed unexpectedly (see console).');
        } finally {
            this.converterRunning = false;
        }
    }

    private collectFiles(scope: ScopeSelection): TFile[] {
        const all = this.app.vault.getMarkdownFiles();
        if (scope.type === 'all') {
            return all;
        }
        const folder = scope.folder.replace(/^\/+|\/+$/g, '');
        if (folder === '' || folder === '/') {
            return all; // vault root
        }
        return all.filter(file => file.path === folder || file.path.startsWith(folder + '/'));
    }

    private buildLog(scopeLabel: string, totalFiles: number, results: ConversionResult[]): ConversionLog {
        const modifiedFiles = results.filter(r => r.status === 'ok').length;
        const failedFiles = results.filter(r => r.status === 'failed').length;
        return {
            timestamp: new Date().toISOString(),
            scope: scopeLabel,
            totalFiles,
            modifiedFiles,
            failedFiles,
            files: results.map(r => ({
                path: r.path,
                extractedTags: r.extractedTags,
                status: r.status,
                ...(r.error ? { error: r.error } : {})
            }))
        };
    }

    async loadSettings(): Promise<void> {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings(): Promise<void> {
        await this.saveData(this.settings);
    }
}
