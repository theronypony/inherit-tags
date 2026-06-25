/**
 * Computes text ranges where `#` tokens must NOT be treated as inline tags:
 *   - fenced code blocks (``` / ~~~, including inside blockquotes)
 *   - inline code spans (`` `...` ``)
 *   - HTML tags (`<...>`), including raw-text elements (script/style/etc.)
 *
 * These are faithful reimplementations of Notebook Navigator's `codeRangeUtils.ts` and
 * `htmlParsingUtils.ts`, since the plugin cannot import NN's internal modules. Ranges use
 * `[start, end)` indexing.
 */

import { NumericRange, findRangeContainingIndex, mergeRanges } from '../utils/ranges';

// ── Fenced code blocks ──────────────────────────────────────────────────────

type FenceMarkerChar = '`' | '~';
interface ParsedBlockquotePrefix {
    depth: number;
    nextIndex: number;
}
interface ParsedFenceMarker {
    markerChar: FenceMarkerChar;
    markerLength: number;
    nextIndex: number;
}
interface ParsedFenceOpen {
    depth: number;
    markerChar: FenceMarkerChar;
    markerLength: number;
}

const CHAR_CODE_TAB = 9;
const CHAR_CODE_CARRIAGE_RETURN = 13;
const CHAR_CODE_FORM_FEED = 12;
const CHAR_CODE_SPACE = 32;

function isMarkdownWhitespace(code: number): boolean {
    return code === CHAR_CODE_TAB || code === CHAR_CODE_CARRIAGE_RETURN || code === CHAR_CODE_FORM_FEED || code === CHAR_CODE_SPACE;
}

function skipMarkdownWhitespace(line: string, startIndex: number): number {
    let index = startIndex;
    while (index < line.length && isMarkdownWhitespace(line.charCodeAt(index))) {
        index += 1;
    }
    return index;
}

function parseBlockquotePrefix(line: string): ParsedBlockquotePrefix {
    let index = skipMarkdownWhitespace(line, 0);
    let depth = 0;
    while (index < line.length && line[index] === '>') {
        depth += 1;
        index += 1;
        index = skipMarkdownWhitespace(line, index);
    }
    return { depth, nextIndex: index };
}

function parseFenceMarker(line: string, startIndex: number): ParsedFenceMarker | null {
    if (startIndex >= line.length) {
        return null;
    }
    const markerChar = line[startIndex];
    if (markerChar !== '`' && markerChar !== '~') {
        return null;
    }
    let index = startIndex + 1;
    while (index < line.length && line[index] === markerChar) {
        index += 1;
    }
    const markerLength = index - startIndex;
    if (markerLength < 3) {
        return null;
    }
    return { markerChar, markerLength, nextIndex: index };
}

function parseFenceOpen(line: string, prefix: ParsedBlockquotePrefix): ParsedFenceOpen | null {
    const markerIndex = skipMarkdownWhitespace(line, prefix.nextIndex);
    const marker = parseFenceMarker(line, markerIndex);
    if (!marker) {
        return null;
    }
    return { depth: prefix.depth, markerChar: marker.markerChar, markerLength: marker.markerLength };
}

function isFenceClose(
    line: string,
    depth: number,
    markerChar: FenceMarkerChar,
    markerLength: number,
    prefix: ParsedBlockquotePrefix
): boolean {
    if (prefix.depth !== depth) {
        return false;
    }
    const markerIndex = skipMarkdownWhitespace(line, prefix.nextIndex);
    const marker = parseFenceMarker(line, markerIndex);
    if (!marker || marker.markerChar !== markerChar || marker.markerLength < markerLength) {
        return false;
    }
    const trailingIndex = skipMarkdownWhitespace(line, marker.nextIndex);
    return trailingIndex === line.length;
}

/**
 * Finds fenced code block ranges (```...``` or ~~~...~~~), including fences inside blockquotes.
 * An unclosed opening fence runs to end-of-content.
 */
export function findFencedCodeBlockRanges(content: string): NumericRange[] {
    const ranges: NumericRange[] = [];
    let index = 0;
    let inFence = false;
    let fenceStart = 0;
    let fenceChar: FenceMarkerChar | null = null;
    let fenceLength = 0;
    let fenceDepth = 0;

    while (index < content.length) {
        const lineEnd = content.indexOf('\n', index);
        let line = lineEnd === -1 ? content.slice(index) : content.slice(index, lineEnd);
        if (line.endsWith('\r')) {
            line = line.slice(0, -1);
        }
        const segmentEnd = lineEnd === -1 ? content.length : lineEnd + 1;
        const prefix = parseBlockquotePrefix(line);

        if (!inFence) {
            const openFence = parseFenceOpen(line, prefix);
            if (openFence) {
                inFence = true;
                fenceStart = index;
                fenceChar = openFence.markerChar;
                fenceLength = openFence.markerLength;
                fenceDepth = openFence.depth;
            }
        } else if (fenceChar !== null && isFenceClose(line, fenceDepth, fenceChar, fenceLength, prefix)) {
            ranges.push({ start: fenceStart, end: segmentEnd });
            inFence = false;
            fenceChar = null;
            fenceLength = 0;
            fenceDepth = 0;
        }

        if (lineEnd === -1) {
            break;
        }
        index = lineEnd + 1;
    }

    if (inFence && fenceStart < content.length) {
        ranges.push({ start: fenceStart, end: content.length });
    }

    return ranges;
}

// ── Inline code spans ───────────────────────────────────────────────────────

function findClosingBacktick(content: string, startIndex: number, tickCount: number, excluded: readonly NumericRange[]): number {
    let searchIndex = startIndex;
    while (searchIndex < content.length) {
        const nextBacktick = content.indexOf('`', searchIndex);
        if (nextBacktick === -1) {
            return -1;
        }
        const containing = findRangeContainingIndex(nextBacktick, excluded);
        if (containing) {
            searchIndex = containing.end;
            continue;
        }
        let runLength = 1;
        while (nextBacktick + runLength < content.length && content[nextBacktick + runLength] === '`') {
            runLength += 1;
        }
        if (runLength === tickCount) {
            return nextBacktick;
        }
        searchIndex = nextBacktick + runLength;
    }
    return -1;
}

/**
 * Finds inline code ranges, respecting backtick run lengths and skipping any backticks that fall
 * inside `excluded` ranges (typically the fenced-code ranges).
 */
export function findInlineCodeRanges(content: string, excluded: readonly NumericRange[] = []): NumericRange[] {
    const ranges: NumericRange[] = [];
    const mergedExcluded = mergeRanges([...excluded]);
    let searchIndex = 0;

    while (searchIndex < content.length) {
        const nextBacktick = content.indexOf('`', searchIndex);
        if (nextBacktick === -1) {
            break;
        }
        const containing = findRangeContainingIndex(nextBacktick, mergedExcluded);
        if (containing) {
            searchIndex = containing.end;
            continue;
        }
        let tickCount = 1;
        while (nextBacktick + tickCount < content.length && content[nextBacktick + tickCount] === '`') {
            tickCount += 1;
        }
        const closingIndex = findClosingBacktick(content, nextBacktick + tickCount, tickCount, mergedExcluded);
        if (closingIndex === -1) {
            searchIndex = nextBacktick + tickCount;
            continue;
        }
        const rangeEnd = closingIndex + tickCount;
        ranges.push({ start: nextBacktick, end: rangeEnd });
        searchIndex = rangeEnd;
    }

    return mergeRanges(ranges);
}

// ── HTML tags ───────────────────────────────────────────────────────────────

const RAW_TEXT_HTML_TAG_NAMES = new Set(['script', 'style', 'textarea', 'title', 'pre']);

interface HtmlToken {
    start: number;
    end: number;
    tag: boolean;
    closing: boolean;
    tagName: string | null;
}

/**
 * Reads an HTML-ish token starting at `<`. Recognizes element tags, comments, CDATA, and
 * processing/declaration tokens. Returns null when `<` does not begin a recognizable token.
 */
function readHtmlTokenAt(text: string, start: number): HtmlToken | null {
    if (text[start] !== '<') {
        return null;
    }

    // Comments <!-- ... -->
    if (text.startsWith('<!--', start)) {
        const close = text.indexOf('-->', start + 4);
        const end = close === -1 ? text.length : close + 3;
        return { start, end, tag: true, closing: false, tagName: null };
    }

    // Declarations / processing instructions <! ...> or <? ...>
    const second = text[start + 1];
    if (second === '!' || second === '?') {
        const close = text.indexOf('>', start + 1);
        const end = close === -1 ? text.length : close + 1;
        return { start, end, tag: true, closing: false, tagName: null };
    }

    const closing = second === '/';
    let nameStart = start + 1 + (closing ? 1 : 0);
    // A valid element tag name must start with an ASCII letter.
    if (!/[A-Za-z]/.test(text[nameStart] ?? '')) {
        return null;
    }
    let cursor = nameStart;
    while (cursor < text.length && /[A-Za-z0-9-]/.test(text[cursor])) {
        cursor += 1;
    }
    const tagName = text.slice(nameStart, cursor).toLowerCase();

    const close = text.indexOf('>', cursor);
    if (close === -1) {
        return { start, end: text.length, tag: true, closing, tagName };
    }
    return { start, end: close + 1, tag: true, closing, tagName };
}

function findRawTextClosingTag(text: string, fromIndex: number, tagName: string): HtmlToken | null {
    const lower = text.toLowerCase();
    const needle = `</${tagName}`;
    const idx = lower.indexOf(needle, fromIndex);
    if (idx === -1) {
        return null;
    }
    const close = text.indexOf('>', idx + needle.length);
    const end = close === -1 ? text.length : close + 1;
    return { start: idx, end, tag: true, closing: true, tagName };
}

/**
 * Finds HTML tag ranges. For raw-text elements (script/style/etc.), the entire element body is
 * protected so `#` inside is never treated as a tag. Faithful port of NN's `findHtmlTagRanges`.
 */
export function findHtmlTagRanges(text: string): NumericRange[] {
    if (!text.includes('<')) {
        return [];
    }

    const ranges: NumericRange[] = [];
    for (let cursor = 0; cursor < text.length; ) {
        const start = text.indexOf('<', cursor);
        if (start === -1) {
            break;
        }
        const token = readHtmlTokenAt(text, start);
        if (!token) {
            cursor = start + 1;
            continue;
        }
        if (token.tag) {
            ranges.push({ start: token.start, end: token.end });
            if (!token.closing && token.tagName && RAW_TEXT_HTML_TAG_NAMES.has(token.tagName)) {
                const closingToken = findRawTextClosingTag(text, token.end, token.tagName);
                if (closingToken) {
                    // Protect everything from the opening tag through the closing tag.
                    ranges.push({ start: token.end, end: closingToken.start });
                    ranges.push({ start: closingToken.start, end: closingToken.end });
                    cursor = closingToken.end;
                    continue;
                }
            }
        }
        cursor = token.end;
    }

    return mergeRanges(ranges);
}

// ── Combined ────────────────────────────────────────────────────────────────

/**
 * Computes the merged set of ranges where inline `#tag` tokens must be ignored.
 */
export function computeExclusionRanges(content: string): NumericRange[] {
    const fencedBlocks = findFencedCodeBlockRanges(content);
    const inlineCodeSpans = findInlineCodeRanges(content, fencedBlocks);
    const htmlTagRanges = findHtmlTagRanges(content);
    return mergeRanges([...fencedBlocks, ...inlineCodeSpans, ...htmlTagRanges]);
}
