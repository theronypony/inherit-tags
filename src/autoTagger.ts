import { App, TAbstractFile, TFile } from 'obsidian';
import { NavItem, NotebookNavigatorAPI } from './nnApi';
import { readNavItemTag, resolveActiveTag } from './tagResolver';
import { mergeTagsIntoFrontmatter, readFrontmatterTags } from './frontmatter';
import { AutoTagSettings } from './settings';

/**
 * Feature A — Auto-Tagger.
 *
 * Listens for new markdown notes and writes the active Notebook Navigator tag into their
 * frontmatter. Holds the `nav-item-changed` cache (the last-known selected tag) so tagging still
 * works when the navigator pane is closed at note-creation time.
 *
 * Writes are queued and run sequentially to avoid concurrent `processFrontMatter` races.
 */
export class AutoTagger {
    private lastKnownTag: string | null = null;
    /** De-dupe guard keyed by `path:mtime` to avoid double-processing the same create. */
    private readonly processed = new Set<string>();
    /** Serializes frontmatter writes. */
    private queue: Promise<void> = Promise.resolve();

    constructor(
        private readonly app: App,
        private readonly getApi: () => NotebookNavigatorAPI | null,
        private readonly getSettings: () => AutoTagSettings
    ) {}

    /**
     * Updates the cached tag from a `nav-item-changed` event.
     * On a concrete tag selection, caches it; on any other selection (folder/property/none),
     * clears the cache so newly created notes don't inherit a stale tag.
     */
    handleNavItemChanged(item: NavItem): void {
        const tag = readNavItemTag(this.getApi(), item);
        this.lastKnownTag = tag; // tag string or null
    }

    /** Vault `create` handler. Filters, resolves a tag, and enqueues the frontmatter write. */
    handleCreate(file: TAbstractFile): void {
        const settings = this.getSettings();
        if (!settings.autoTaggerEnabled) {
            return;
        }
        if (!(file instanceof TFile) || file.extension !== 'md') {
            return; // Known limitation: only .md files are auto-tagged.
        }
        if (isExcludedPath(file.path, settings.excludeFolders)) {
            return;
        }

        const key = `${file.path}:${file.stat.mtime}`;
        if (this.processed.has(key)) {
            return;
        }
        this.processed.add(key);

        // Enqueue; failures are swallowed per-file so one bad write can't stall the queue.
        this.queue = this.queue.then(() => this.process(file)).catch(error => {
            console.error(`[inherit-tags] Failed to auto-tag ${file.path}:`, error);
        });
    }

    private async process(file: TFile): Promise<void> {
        const api = this.getApi();
        // Guard: don't query the navigator before it has bootstrapped.
        try {
            await api?.whenReady?.();
        } catch {
            // ignore — fall through and let resolveActiveTag decide
        }

        const tag = resolveActiveTag(api, this.lastKnownTag);
        if (!tag) {
            return; // No tag selected and no cached tag → no-op.
        }

        // Wait until Obsidian has finished its *initial* metadata parse of the new file before
        // writing. Otherwise that parse can land after our write and clobber the tag index back to
        // "no tags": the tag is correct on disk (the note shows it) but consumers of the metadata
        // tag index (the Tags pane, Notebook Navigator's tag tree) don't see it until a full reparse
        // at restart. Waiting first means our write produces a clean change event everyone picks up.
        await this.whenFileIndexed(file);

        // Cross-device guard: only tag notes that this device actually authored. When the same vault
        // is open on multiple devices (e.g. Mac + iOS via Obsidian Sync / Syncthing / iCloud), a note
        // created on one device fires a `create` event on the *other* device when it syncs in — and
        // without this guard that device would also stamp its own active tag, so the note ends up with
        // both selections. A note authored elsewhere arrives already carrying its tag(s), so the
        // presence of any frontmatter tag means "not mine — leave it alone". A genuinely new local
        // note is empty at creation, so this only suppresses synced-in notes.
        // Known limitation: notes created from a template that pre-fills `tags:` look "already tagged"
        // and so will NOT receive the active navigator tag, even on the device that created them.
        if (readFrontmatterTags(this.app, file).length > 0) {
            return;
        }

        await mergeTagsIntoFrontmatter(this.app, file, [tag]);
    }

    /**
     * Resolves once the metadata cache has indexed `file`, or after `timeoutMs` as a safety net.
     * A brand-new file returns `null` from `getFileCache` until its first parse completes; we listen
     * for the `changed` event for this specific path to know that parse has landed.
     */
    private whenFileIndexed(file: TFile, timeoutMs = 2000): Promise<void> {
        return new Promise(resolve => {
            if (this.app.metadataCache.getFileCache(file) != null) {
                resolve();
                return;
            }
            let settled = false;
            const finish = () => {
                if (settled) {
                    return;
                }
                settled = true;
                this.app.metadataCache.offref(ref);
                window.clearTimeout(timer);
                resolve();
            };
            const ref = this.app.metadataCache.on('changed', changed => {
                if (changed.path === file.path) {
                    finish();
                }
            });
            const timer = window.setTimeout(finish, timeoutMs);
        });
    }
}

/**
 * Returns true if `path` lies within any of the excluded folders.
 * Folder entries are matched on path-segment boundaries (so `Arch` doesn't match `Archive/...`).
 */
export function isExcludedPath(path: string, excludeFolders: string[]): boolean {
    const normalizedPath = path.replace(/^\/+/, '');
    for (const folder of excludeFolders) {
        const f = folder.trim().replace(/^\/+|\/+$/g, '');
        if (f.length === 0) {
            continue;
        }
        if (normalizedPath === f || normalizedPath.startsWith(f + '/')) {
            return true;
        }
    }
    return false;
}
