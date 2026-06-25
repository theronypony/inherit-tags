import { NumericRange, isIndexInRanges } from '../utils/ranges';
import {
    HORIZONTAL_WHITESPACE_SOURCE,
    INLINE_TAG_TOKEN_SOURCE,
    hasValidTagCharacters,
    isValidTagPrecedingChar
} from '../utils/tagUtils';

/**
 * Settings that affect inline-tag extraction.
 */
export interface ExtractorSettings {
    /** When true, skip tokens that look like hex colors (`#FF5733`). On by default. */
    hexColorFilter: boolean;
    /** When true, skip short numeric tags (`#1`–`#999`). Off by default; 4-digit years are kept. */
    skipShortNumericTags?: boolean;
    /**
     * Optional user-supplied pattern. A token whose tag name (without `#`) matches is skipped.
     * Pre-compiled by the caller; null/undefined means no custom exclusion.
     */
    customExcludePattern?: RegExp | null;
}

/**
 * Per-file policy deciding, for an already-valid (non-excluded) tag name, whether it should be
 * merged into frontmatter (`shouldAdd`) and/or stripped from the body (`shouldRemove`). Both default
 * to true (convert everything), which is the create-new-tags behavior. The "existing tags only" mode
 * supplies narrower predicates. Add implies remove in practice, but the two are tracked
 * independently so a one-off tag can be stripped without being added.
 */
export interface TagConvertPolicy {
    shouldAdd?: (tagName: string) => boolean;
    shouldRemove?: (tagName: string) => boolean;
}

export interface InlineTagExtraction {
    /** Unique tag paths to merge into frontmatter, original case, in first-seen order. */
    tags: string[];
    /** Body ranges (including any captured leading horizontal whitespace) to remove. */
    removals: NumericRange[];
}

/** Short numeric tags (`#1`–`#999`). 3-digit cap deliberately leaves 4-digit years (`#2024`) alone. */
const NUMERIC_TAG_PATTERN = /^[0-9]{1,3}$/;

/**
 * Compiles a user-supplied custom-exclusion regex string. Returns the pattern (or null when the
 * input is empty) and an error message when the source is not a valid regular expression. Used both
 * to build the runtime pattern and to drive live validation in settings.
 */
export function tryCompileRegex(raw: string): { pattern: RegExp | null; error: string | null } {
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
        return { pattern: null, error: null };
    }
    try {
        return { pattern: new RegExp(trimmed), error: null };
    } catch (error) {
        return { pattern: null, error: error instanceof Error ? error.message : String(error) };
    }
}

/**
 * Pattern matching an inline tag token with an optional single leading horizontal-whitespace char.
 * Mirrors NN's `INLINE_TAG_PATTERN`. The token source stops at the first disallowed character, so
 * `# Heading` (space after `#`) and `## Heading` (`#` after `#`) never match — headings are
 * naturally excluded.
 */
const INLINE_TAG_PATTERN = new RegExp(`(${HORIZONTAL_WHITESPACE_SOURCE})?${INLINE_TAG_TOKEN_SOURCE}`, 'gu');

const HEX_COLOR_PATTERN = /^[0-9A-Fa-f]{3,8}$/;

/**
 * Extracts inline `#tag` tokens from `content`, honoring:
 *  - preceding-char validation (`#` must be at start or after whitespace)
 *  - exclusion ranges (code blocks, inline code, HTML)
 *  - heading rejection (handled implicitly by the token grammar)
 *  - hex-color rejection (optional)
 *  - short-numeric rejection (optional)
 *  - custom-regex rejection (optional)
 *  - tag character validation (Unicode-aware, no leading/trailing/double slash)
 *
 * An optional `policy` decides, per valid tag name, whether it is merged into frontmatter and/or
 * stripped from the body (defaults: both). Tokens rejected by the filters above are always left in
 * the body untouched. Returns the unique tags to add and the body ranges to remove. Pure function.
 */
export function extractInlineTags(
    content: string,
    exclusionRanges: NumericRange[],
    settings: ExtractorSettings,
    policy?: TagConvertPolicy
): InlineTagExtraction {
    const removals: NumericRange[] = [];
    const tags: string[] = [];
    const seen = new Set<string>();

    INLINE_TAG_PATTERN.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = INLINE_TAG_PATTERN.exec(content)) !== null) {
        const full = match[0];
        const leadingWs = match[1] ?? '';
        const matchStart = match.index;
        const hashIndex = matchStart + leadingWs.length;

        // `#` must be at start-of-string or preceded by whitespace.
        const precedingChar = hashIndex > 0 ? content[hashIndex - 1] : null;
        if (!isValidTagPrecedingChar(precedingChar)) {
            continue;
        }

        // Inside a protected region (code/inline-code/HTML)? Leave it untouched.
        if (isIndexInRanges(hashIndex, exclusionRanges)) {
            continue;
        }

        const token = full.slice(leadingWs.length); // starts with '#'
        const tagName = token.slice(1);

        if (settings.hexColorFilter && HEX_COLOR_PATTERN.test(tagName)) {
            continue;
        }

        if (settings.skipShortNumericTags && NUMERIC_TAG_PATTERN.test(tagName)) {
            continue;
        }

        if (settings.customExcludePattern && settings.customExcludePattern.test(tagName)) {
            continue;
        }

        if (!hasValidTagCharacters(tagName)) {
            continue;
        }

        // Decide this tag's fate (defaults: convert — add to frontmatter and strip from body).
        const allowRemove = policy?.shouldRemove ? policy.shouldRemove(tagName) : true;
        const allowAdd = policy?.shouldAdd ? policy.shouldAdd(tagName) : true;

        // Remove every occurrence from the body when permitted...
        if (allowRemove) {
            removals.push({ start: matchStart, end: matchStart + full.length });
        }

        // ...but add the tag to frontmatter only once (case-insensitive de-dupe, keep first case).
        if (allowAdd) {
            const key = tagName.toLowerCase();
            if (!seen.has(key)) {
                seen.add(key);
                tags.push(tagName);
            }
        }
    }

    return { tags, removals };
}
