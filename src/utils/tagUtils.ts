/**
 * Tag character/validation utilities.
 *
 * These replicate Notebook Navigator's inline-tag rules (`src/utils/tagUtils.ts`) so the converter
 * extracts exactly the tokens Obsidian would treat as inline tags. Reimplemented here because the
 * plugin cannot import NN's internal modules.
 */

/**
 * Character-class content for characters that are NOT allowed inside an inline `#tag` token.
 *
 * Inserted into a RegExp character class (e.g. `[^${...}]`), so it must be valid character-class
 * content (not wrapped in `[]`). Copied verbatim from NN's
 * `OBSIDIAN_INLINE_TAG_DISALLOWED_CLASS_CONTENT`.
 */
export const OBSIDIAN_INLINE_TAG_DISALLOWED_CLASS_CONTENT = '\\u2000-\\u206F\\u2E00-\\u2E7F\'!"#$%&()*+,.:;<=>?@^`{|}~[\\]\\\\\\s';

/** Matches a single non-newline horizontal whitespace character. */
export const HORIZONTAL_WHITESPACE_SOURCE = '[^\\S\\r\\n]';

/** Source for an inline tag token: `#` followed by one or more allowed characters. */
export const INLINE_TAG_TOKEN_SOURCE = `#[^${OBSIDIAN_INLINE_TAG_DISALLOWED_CLASS_CONTENT}]+`;

const TAG_ALLOWED_CHAR_PATTERN = /^[\p{L}\p{N}\p{M}_\-/]$/u;
const TAG_COMBINING_MARK_PATTERN = /^\p{M}$/u;
const TAG_ALLOWED_PICTOGRAPHIC_PATTERN = /^\p{Extended_Pictographic}$/u;
const TAG_ALLOWED_REGIONAL_INDICATOR_PATTERN = /^\p{Regional_Indicator}$/u;
const EMOJI_SEQUENCE_JOINERS = new Set(['\u200D', '\uFE0E', '\uFE0F']);

/**
 * Checks if a tag input can be used as a canonical tag path string.
 * Trims whitespace and rejects empty values, whitespace, and hash characters.
 * Rejects leading/trailing slashes and double slashes. Requires at least one base character.
 *
 * Faithful port of NN's `hasValidTagCharacters`.
 */
export function hasValidTagCharacters(tagValue: string | null | undefined): boolean {
    if (!tagValue) {
        return false;
    }

    const trimmed = tagValue.trim();
    if (trimmed.length === 0) {
        return false;
    }

    if (/\s/u.test(trimmed)) {
        return false;
    }

    if (trimmed.includes('#')) {
        return false;
    }

    if (trimmed.startsWith('/') || trimmed.endsWith('/')) {
        return false;
    }

    if (trimmed.includes('//')) {
        return false;
    }

    let hasBaseCharacter = false;

    for (const char of trimmed) {
        if (EMOJI_SEQUENCE_JOINERS.has(char)) {
            continue;
        }

        if (TAG_ALLOWED_CHAR_PATTERN.test(char)) {
            if (!TAG_COMBINING_MARK_PATTERN.test(char)) {
                hasBaseCharacter = true;
            }
            continue;
        }

        if (TAG_ALLOWED_PICTOGRAPHIC_PATTERN.test(char)) {
            hasBaseCharacter = true;
            continue;
        }

        if (TAG_ALLOWED_REGIONAL_INDICATOR_PATTERN.test(char)) {
            hasBaseCharacter = true;
            continue;
        }

        return false;
    }

    return hasBaseCharacter;
}

/**
 * Checks whether `char` is a valid preceding character for an inline `#tag` token.
 *
 * Obsidian only recognizes inline tags when `#` is preceded by whitespace or is at the start of the
 * string/line. Faithful port of NN's `isValidTagPrecedingChar`.
 */
export function isValidTagPrecedingChar(char: string | null | undefined): boolean {
    if (!char) {
        return true; // Start of line/string
    }
    return /\s/u.test(char);
}
