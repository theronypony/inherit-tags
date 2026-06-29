import { describe, expect, it } from 'vitest';
import type { App, DataWriteOptions, TFile } from 'obsidian';
import { convertSingleFile } from '../src/converter/inlineTagConverter';

const SETTINGS = { hexColorFilter: true };

/**
 * Builds a minimal fake App + TFile pair that records the DataWriteOptions handed to each write,
 * so we can assert the converter forwards the file's original timestamps instead of letting
 * Obsidian stamp "now".
 */
function harness(initialContent: string, stat: { ctime: number; mtime: number }) {
    let content = initialContent;
    let frontmatterTags: string[] = [];
    const recorded: { frontmatter?: DataWriteOptions; body?: DataWriteOptions } = {};

    const file = { path: 'note.md', stat: { ...stat } } as unknown as TFile;

    const app = {
        vault: {
            async read() {
                return content;
            },
            async process(_f: TFile, fn: (data: string) => string, options?: DataWriteOptions) {
                recorded.body = options;
                content = fn(content);
                return content;
            }
        },
        metadataCache: {
            getFileCache() {
                return { frontmatter: { tags: frontmatterTags } };
            }
        },
        fileManager: {
            async processFrontMatter(
                _f: TFile,
                fn: (fm: Record<string, unknown>) => void,
                options?: DataWriteOptions
            ) {
                recorded.frontmatter = options;
                const fm: Record<string, unknown> = { tags: [...frontmatterTags] };
                fn(fm);
                frontmatterTags = (fm.tags as string[]) ?? frontmatterTags;
            }
        }
    } as unknown as App;

    return { app, file, recorded, getContent: () => content };
}

describe('convertSingleFile timestamp preservation', () => {
    it('forwards the original ctime/mtime to both the frontmatter and body writes', async () => {
        const stat = { ctime: 1_600_000_000_000, mtime: 1_650_000_000_000 };
        const { app, file, recorded, getContent } = harness('body #work here', stat);

        const result = await convertSingleFile(app, file, SETTINGS);

        expect(result.status).toBe('ok');
        // Both writes must carry the captured timestamps, not "now".
        expect(recorded.frontmatter).toEqual(stat);
        expect(recorded.body).toEqual(stat);
        // Sanity: the conversion actually happened (inline tag stripped).
        expect(getContent()).not.toContain('#work');
    });
});
