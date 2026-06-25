import { describe, expect, it } from 'vitest';
import { ExtractorSettings, extractInlineTags, tryCompileRegex } from '../src/converter/tagExtractor';
import { computeExclusionRanges } from '../src/converter/exclusionRanges';
import { findFrontmatterRange } from '../src/converter/inlineTagConverter';
import { mergeRanges } from '../src/utils/ranges';

const SETTINGS = { hexColorFilter: true };

function extract(content: string, hexFilter = true) {
    const ranges = computeExclusionRanges(content);
    const fm = findFrontmatterRange(content);
    const all = fm ? mergeRanges([...ranges, fm]) : ranges;
    return extractInlineTags(content, all, { ...SETTINGS, hexColorFilter: hexFilter });
}

function extractWith(content: string, settings: ExtractorSettings) {
    const ranges = computeExclusionRanges(content);
    const fm = findFrontmatterRange(content);
    const all = fm ? mergeRanges([...ranges, fm]) : ranges;
    return extractInlineTags(content, all, settings);
}

describe('extractInlineTags', () => {
    it('extracts simple and nested tags', () => {
        const { tags } = extract('Some text #work and #work/meetings here.');
        expect(tags).toEqual(['work', 'work/meetings']);
    });

    it('deduplicates case-insensitively, keeping first case', () => {
        const { tags } = extract('#Work then #work again');
        expect(tags).toEqual(['Work']);
    });

    it('rejects markdown headings', () => {
        const { tags, removals } = extract('# Heading\n## Subheading\nbody #real');
        expect(tags).toEqual(['real']);
        expect(removals).toHaveLength(1);
    });

    it('rejects hex colors when filter is on, accepts when off', () => {
        expect(extract('color #FF5733 here').tags).toEqual([]);
        expect(extract('color #FF5733 here', false).tags).toEqual(['FF5733']);
    });

    it('ignores # not preceded by whitespace', () => {
        const { tags } = extract('foo#bar and http://x/#anchor');
        expect(tags).toEqual([]);
    });

    it('ignores tags inside fenced code blocks', () => {
        const content = ['before #keep', '```', 'code #ignored', '```', 'after #also'].join('\n');
        const { tags } = extract(content);
        expect(tags).toEqual(['keep', 'also']);
    });

    it('ignores tags inside inline code', () => {
        const { tags } = extract('text `#ignored` and #kept');
        expect(tags).toEqual(['kept']);
    });

    it('ignores tags inside HTML tags', () => {
        const { tags } = extract('<a href="#anchor">link</a> and #kept');
        expect(tags).toEqual(['kept']);
    });

    it('ignores # inside the frontmatter block', () => {
        const content = ['---', 'title: a # not a tag', 'tags: [existing]', '---', '', 'body #real'].join('\n');
        const { tags } = extract(content);
        expect(tags).toEqual(['real']);
    });

    it('stops the token at disallowed punctuation', () => {
        const { tags } = extract("end of #sentence. and #tag's apostrophe");
        expect(tags).toEqual(['sentence', 'tag']);
    });
});

describe('skipShortNumericTags', () => {
    // Hex filter off so these cases isolate the numeric rule (pure-digit tags also look like hex).
    const on = { hexColorFilter: false, skipShortNumericTags: true };

    it('excludes 1–3 digit numbers when enabled, leaving them in the body', () => {
        const { tags, removals } = extractWith('Session #1 and item #42 and #999 done', on);
        expect(tags).toEqual([]);
        expect(removals).toHaveLength(0);
    });

    it('keeps 4-digit years and longer numbers', () => {
        expect(extractWith('year #2024 and #10000 here', on).tags).toEqual(['2024', '10000']);
    });

    it('does not affect mixed or nested numeric tags', () => {
        expect(extractWith('#a1 and #2024/q1 and #1b', on).tags).toEqual(['a1', '2024/q1', '1b']);
    });

    it('captures short numbers when disabled (default)', () => {
        expect(extractWith('Session #1 here', { hexColorFilter: true }).tags).toEqual(['1']);
    });
});

describe('customExcludePattern', () => {
    it('excludes any tag whose name matches the pattern', () => {
        const settings = { hexColorFilter: true, customExcludePattern: /^\d+$/ };
        const { tags } = extractWith('#1 #2024 #work here', settings);
        expect(tags).toEqual(['work']);
    });

    it('matches the tag name without the leading #', () => {
        const settings = { hexColorFilter: true, customExcludePattern: /^draft$/ };
        expect(extractWith('#draft and #drafted and #work', settings).tags).toEqual(['drafted', 'work']);
    });

    it('is ignored when null', () => {
        expect(extractWith('#1 #work', { hexColorFilter: true, customExcludePattern: null }).tags).toEqual(['1', 'work']);
    });
});

describe('tryCompileRegex', () => {
    it('compiles a valid pattern', () => {
        const { pattern, error } = tryCompileRegex('^\\d+$');
        expect(pattern).toBeInstanceOf(RegExp);
        expect(error).toBeNull();
    });

    it('returns an error for an invalid pattern', () => {
        const { pattern, error } = tryCompileRegex('[');
        expect(pattern).toBeNull();
        expect(error).toBeTruthy();
    });

    it('treats empty/whitespace input as disabled (no pattern, no error)', () => {
        expect(tryCompileRegex('   ')).toEqual({ pattern: null, error: null });
    });
});
