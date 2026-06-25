/**
 * Tag hierarchy helpers for nested tags (e.g. `work/meetings`).
 *
 * Obsidian represents nested tags with `/` separators. A tag is a "descendant" of another
 * when it lives under that tag's path.
 */

/**
 * Returns true when `child` is a strict descendant of `parent` in the tag hierarchy.
 *
 * Comparison is case-insensitive to match Obsidian's case-insensitive tag matching.
 * `isDescendantOf('work/meetings', 'work')` → true
 * `isDescendantOf('work', 'work')` → false (not a strict descendant)
 * `isDescendantOf('workshop', 'work')` → false (prefix but not a path segment boundary)
 */
export function isDescendantOf(child: string, parent: string): boolean {
    const c = normalize(child);
    const p = normalize(parent);
    if (!c || !p) {
        return false;
    }
    return c.startsWith(p + '/');
}

/** Case-insensitive equality for tag paths. */
export function tagsEqual(a: string, b: string): boolean {
    return normalize(a) === normalize(b);
}

function normalize(tag: string): string {
    return tag.trim().replace(/^#+/, '').toLowerCase();
}
