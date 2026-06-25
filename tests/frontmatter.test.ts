import { describe, expect, it } from 'vitest';
import { computeTagsToAdd, normalizeTagsValue } from '../src/frontmatter';
import { isDescendantOf, tagsEqual } from '../src/utils/tagHierarchy';

describe('normalizeTagsValue', () => {
    it('handles arrays, single strings, and space/comma separated strings', () => {
        expect(normalizeTagsValue(['a', '#b'])).toEqual(['a', 'b']);
        expect(normalizeTagsValue('#solo')).toEqual(['solo']);
        expect(normalizeTagsValue('a, b c')).toEqual(['a', 'b', 'c']);
        expect(normalizeTagsValue(null)).toEqual([]);
        expect(normalizeTagsValue(undefined)).toEqual([]);
    });
});

describe('isDescendantOf', () => {
    it('detects strict descendants on path boundaries', () => {
        expect(isDescendantOf('work/meetings', 'work')).toBe(true);
        expect(isDescendantOf('work', 'work')).toBe(false);
        expect(isDescendantOf('workshop', 'work')).toBe(false);
    });
    it('is case-insensitive', () => {
        expect(isDescendantOf('Work/Meetings', 'work')).toBe(true);
    });
});

describe('tagsEqual', () => {
    it('compares case-insensitively and ignores leading #', () => {
        expect(tagsEqual('#Work', 'work')).toBe(true);
        expect(tagsEqual('a', 'b')).toBe(false);
    });
});

describe('computeTagsToAdd', () => {
    it('skips exact duplicates (case-insensitive)', () => {
        expect(computeTagsToAdd(['work'], ['Work', 'new'])).toEqual(['new']);
    });

    it('skips a parent that is already implied by an existing descendant', () => {
        expect(computeTagsToAdd(['work/meetings'], ['work'])).toEqual([]);
    });

    it('still adds a descendant when only the parent exists', () => {
        expect(computeTagsToAdd(['work'], ['work/meetings'])).toEqual(['work/meetings']);
    });

    it('dedupes candidates against themselves', () => {
        expect(computeTagsToAdd([], ['a', 'A', 'b'])).toEqual(['a', 'b']);
    });

    it('strips leading # from candidates', () => {
        expect(computeTagsToAdd([], ['#tag'])).toEqual(['tag']);
    });
});
