import { NumericRange, mergeRanges } from '../utils/ranges';

const HORIZONTAL_WHITESPACE = /[^\S\r\n]/;

function isHorizontalWhitespace(char: string | undefined): boolean {
    return char !== undefined && HORIZONTAL_WHITESPACE.test(char);
}

/** A line boundary is a newline/carriage-return or the start/end of the string (undefined). */
function isLineBoundary(char: string | undefined): boolean {
    return char === undefined || char === '\n' || char === '\r';
}

/**
 * Removes the given ranges from `content` and normalizes whitespace at each seam so the body reads
 * cleanly after inline tags are stripped:
 *  - Tag mid-line (text on both sides) → collapse the surrounding whitespace run to a single space.
 *  - Tag at end of line → trailing whitespace removed.
 *  - Tag at start of line followed by text → leading whitespace removed.
 *  - Tag is the only content on a line → an empty line remains (markdown structure preserved).
 *
 * Ranges are expected to include any captured leading whitespace (as produced by the extractor).
 * Pure function.
 */
export function stripInlineTags(content: string, removals: NumericRange[]): string {
    if (removals.length === 0) {
        return content;
    }

    const merged = mergeRanges(removals);

    // Build the result while recording the offset (in the result string) of each removal seam.
    let result = '';
    let cursor = 0;
    const seams: number[] = [];
    for (const range of merged) {
        result += content.slice(cursor, range.start);
        seams.push(result.length); // seam sits between kept-left and kept-right text
        cursor = range.end;
    }
    result += content.slice(cursor);

    // Normalize whitespace at each seam, processing right-to-left so earlier offsets stay valid.
    for (let i = seams.length - 1; i >= 0; i--) {
        const seam = seams[i];

        // Expand over the contiguous horizontal-whitespace run straddling the seam.
        let left = seam;
        while (left > 0 && isHorizontalWhitespace(result[left - 1])) {
            left -= 1;
        }
        let right = seam;
        while (right < result.length && isHorizontalWhitespace(result[right])) {
            right += 1;
        }

        const prevChar = left > 0 ? result[left - 1] : undefined;
        const nextChar = right < result.length ? result[right] : undefined;

        // Keep a single space only when real text sits on both sides; otherwise drop the run so we
        // don't leave leading/trailing spaces or spaces on otherwise-empty lines.
        const replacement = !isLineBoundary(prevChar) && !isLineBoundary(nextChar) ? ' ' : '';

        result = result.slice(0, left) + replacement + result.slice(right);
    }

    return result;
}
