/**
 * Numeric range utilities for locating regions of text.
 *
 * Ranges use `[start, end)` indexing (end is exclusive).
 *
 * These helpers replicate the behavior of Notebook Navigator's internal range utilities
 * (`src/utils/arrayUtils.ts`, `src/utils/codeRangeUtils.ts`) so the inline-tag converter
 * recognizes the exact same protected regions Obsidian/NN do. They are reimplemented here
 * because the plugin cannot import NN's internal modules.
 */

export interface NumericRange {
    start: number;
    end: number;
}

/**
 * Merges overlapping ranges into a sorted, non-overlapping set.
 * Ranges that merely touch (range.start === last.end) ARE coalesced, since the guard below only
 * starts a new range when range.start is strictly greater than the previous end. This keeps the
 * result minimal and is harmless for every consumer (membership tests and seam computation are
 * unaffected by whether touching exclusion regions are reported as one range or two).
 */
export function mergeRanges<T extends NumericRange>(ranges: readonly T[]): T[] {
    if (ranges.length === 0) {
        return [];
    }

    const sorted = [...ranges].sort((first, second) => first.start - second.start || first.end - second.end);
    const merged: T[] = [];

    for (const range of sorted) {
        const last = merged[merged.length - 1];
        if (!last || range.start > last.end) {
            merged.push({ ...range });
        } else if (range.end > last.end) {
            last.end = range.end;
        }
    }

    return merged;
}

/**
 * Finds the range containing the provided index within sorted, non-overlapping ranges.
 * Returns null when the index is not contained in any range.
 */
export function findRangeContainingIndex(index: number, ranges: readonly NumericRange[]): NumericRange | null {
    let left = 0;
    let right = ranges.length - 1;

    while (left <= right) {
        const mid = Math.floor((left + right) / 2);
        const range = ranges[mid];
        if (index < range.start) {
            right = mid - 1;
        } else if (index >= range.end) {
            left = mid + 1;
        } else {
            return range;
        }
    }

    return null;
}

/** Returns true if the index falls within any of the provided ranges. */
export function isIndexInRanges(index: number, ranges: readonly NumericRange[]): boolean {
    return findRangeContainingIndex(index, ranges) !== null;
}
