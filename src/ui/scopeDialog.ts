import { App, Modal, Setting, TFolder } from 'obsidian';

export type ScopeSelection = { type: 'all' } | { type: 'folder'; folder: string };

/**
 * Asks the user to choose the conversion scope: the entire vault or a single folder (recursive).
 * Resolves with the selection, or null if cancelled/closed.
 */
export function promptScope(app: App): Promise<ScopeSelection | null> {
    return new Promise(resolve => {
        new ScopeDialog(app, resolve).open();
    });
}

class ScopeDialog extends Modal {
    private mode: 'all' | 'folder' = 'all';
    private folderPath = '';
    private resolved = false;
    private folderSetting: Setting | null = null;

    constructor(
        app: App,
        private readonly resolve: (value: ScopeSelection | null) => void
    ) {
        super(app);
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.createEl('h2', { text: 'Convert inline tags' });
        contentEl.createEl('p', {
            text: 'Choose which notes to scan for inline #tags.'
        });

        const folders = this.getFolders();
        if (folders.length === 0) {
            this.folderPath = '';
        } else {
            this.folderPath = folders[0];
        }

        new Setting(contentEl).setName('Scope').addDropdown(dropdown => {
            dropdown
                .addOption('all', 'Convert all notes')
                .addOption('folder', 'Convert notes in a specific folder')
                .setValue(this.mode)
                .onChange(value => {
                    this.mode = value === 'folder' ? 'folder' : 'all';
                    this.updateFolderVisibility();
                });
        });

        this.folderSetting = new Setting(contentEl).setName('Folder').setDesc('Files within this folder (and subfolders) will be scanned.').addDropdown(dropdown => {
            if (folders.length === 0) {
                dropdown.addOption('', '(no folders in vault)');
                dropdown.setDisabled(true);
            } else {
                for (const path of folders) {
                    dropdown.addOption(path, path === '/' ? '/ (vault root)' : path);
                }
                dropdown.setValue(this.folderPath);
            }
            dropdown.onChange(value => {
                this.folderPath = value;
            });
        });

        this.updateFolderVisibility();

        new Setting(contentEl)
            .addButton(button =>
                button.setButtonText('Cancel').onClick(() => {
                    this.finish(null);
                })
            )
            .addButton(button =>
                button
                    .setButtonText('Continue')
                    .setCta()
                    .onClick(() => {
                        if (this.mode === 'folder') {
                            this.finish({ type: 'folder', folder: this.folderPath });
                        } else {
                            this.finish({ type: 'all' });
                        }
                    })
            );
    }

    private updateFolderVisibility(): void {
        this.folderSetting?.settingEl.toggle(this.mode === 'folder');
    }

    private getFolders(): string[] {
        const paths = this.app.vault
            .getAllLoadedFiles()
            .filter((f): f is TFolder => f instanceof TFolder)
            .map(folder => folder.path);
        // Root folder reports path '/'; keep it but sort the rest alphabetically.
        return paths.sort((a, b) => (a === '/' ? -1 : b === '/' ? 1 : a.localeCompare(b)));
    }

    private finish(value: ScopeSelection | null): void {
        this.resolved = true;
        this.resolve(value);
        this.close();
    }

    onClose(): void {
        this.contentEl.empty();
        if (!this.resolved) {
            this.resolve(null);
        }
    }
}
