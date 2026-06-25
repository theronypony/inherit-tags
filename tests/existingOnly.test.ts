import { describe, expect, it } from 'vitest';
import { extractInlineTags } from '../src/converter/tagExtractor';
import { computeExclusionRanges } from '../src/converter/exclusionRanges';
import { ExistingOnlyContext, buildConvertPolicy } from '../src/converter/inlineTagConverter';

const SETTINGS = { hexColorFilter: true };

/** Builds an ExistingOnlyContext from a plain {tag: [paths]} map (keys must be lowercase). */
function context(map: Record<string, string[]>, stripSingleNote = false): ExistingOnlyContext {
    const tagFiles = new Map<string, Set<string>>(
        Object.entries(map).map(([tag, paths]) => [tag, new Set(paths)])
    );
    return { tagFiles, stripSingleNote };
}

function run(content: string, ctx: ExistingOnlyContext | null, filePath: string, frontmatter: string[] = []) {
    const ranges = computeExclusionRanges(content);
    const policy = buildConvertPolicy(ctx, filePath, frontmatter);
    return extractInlineTags(content, ranges, SETTINGS, policy);
}

describe('buildConvertPolicy', () => {
    it('returns undefined (convert everything) when not in existing-only mode', () => {
        expect(buildConvertPolicy(null, 'a.md', [])).toBeUndefined();
    });
});

describe('existing-tags-only conversion', () => {
    it('converts a tag established in another note, leaving a one-off in place', () => {
        const ctx = context({ work: ['other.md'] });
        const { tags, removals } = run('body #work and #oneoff', ctx, 'a.md');
        expect(tags).toEqual(['work']); // only the established tag is added
        expect(removals).toHaveLength(1); // only #work is stripped; #oneoff stays
    });

    it('does not treat presence in the same file as "another note"', () => {
        // #solo only exists in a.md (this file) → one-off → left alone.
        const ctx = context({ solo: ['a.md'] });
        const { tags, removals } = run('body #solo', ctx, 'a.md');
        expect(tags).toEqual([]);
        expect(removals).toHaveLength(0);
    });

    it('strips a one-off without adding it when stripSingleNote is on', () => {
        const ctx = context({ work: ['other.md'] }, true);
        const { tags, removals } = run('body #work and #oneoff', ctx, 'a.md');
        expect(tags).toEqual(['work']); // one-off is never added to frontmatter
        expect(removals).toHaveLength(2); // but both inline tokens are stripped
    });

    it('treats a tag already in this note’s frontmatter as established (dedup)', () => {
        // #done appears only in this note inline, but it is already in frontmatter → strip the dup.
        const ctx = context({});
        const { tags, removals } = run('body #done', ctx, 'a.md', ['done']);
        expect(tags).toEqual(['done']);
        expect(removals).toHaveLength(1);
    });

    it('matches established tags case-insensitively', () => {
        const ctx = context({ work: ['other.md'] });
        const { tags, removals } = run('body #Work', ctx, 'a.md');
        expect(tags).toEqual(['Work']); // original case preserved, but recognized as established
        expect(removals).toHaveLength(1);
    });
});
