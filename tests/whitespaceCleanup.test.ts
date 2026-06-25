import { describe, expect, it } from 'vitest';
import { extractInlineTags } from '../src/converter/tagExtractor';
import { computeExclusionRanges } from '../src/converter/exclusionRanges';
import { stripInlineTags } from '../src/converter/whitespaceCleanup';

const SETTINGS = { hexColorFilter: true };

/** Strip helper that runs the real extractor → cleanup pipeline. */
function strip(content: string): string {
    const ranges = computeExclusionRanges(content);
    const { removals } = extractInlineTags(content, ranges, SETTINGS);
    return stripInlineTags(content, removals);
}

describe('stripInlineTags', () => {
    it('removes a mid-line tag and leaves a single space', () => {
        expect(strip('foo #tag bar')).toBe('foo bar');
    });

    it('collapses double spaces left by removal', () => {
        expect(strip('foo #tag  bar')).toBe('foo bar');
    });

    it('trims trailing whitespace when tag ends the line', () => {
        expect(strip('foo #tag\nnext')).toBe('foo\nnext');
    });

    it('removes leading space when tag starts the line', () => {
        expect(strip('#tag content')).toBe('content');
    });

    it('leaves an empty line when the tag is the only content', () => {
        expect(strip('a\n#tag\nb')).toBe('a\n\nb');
    });

    it('preserves list indentation', () => {
        expect(strip('  - #tag item')).toBe('  - item');
    });

    it('handles multiple tags on one line', () => {
        expect(strip('start #a middle #b end')).toBe('start middle end');
    });

    it('leaves content untouched when there are no tags', () => {
        expect(strip('no tags here')).toBe('no tags here');
    });
});
