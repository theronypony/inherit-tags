import { NavItem, NotebookNavigatorAPI } from './nnApi';

/**
 * Resolves the "active" navigator tag to apply to a newly created note.
 *
 * Strategy (per the plan):
 *   1. Ask NN for the live selection via `selection.getNavItem()`.
 *   2. If that isn't a usable tag (e.g. the navigator pane is closed → `type: 'none'`),
 *      fall back to the last-known cached tag captured from `nav-item-changed`.
 *   3. Skip aggregate/virtual collection rows (`__tagged__` / `__untagged__`) via
 *      `tagCollections.isCollection()`.
 *
 * Returns the canonical tag path (e.g. `work/meetings`) or null when nothing applies.
 * Never throws — any API inconsistency results in null (silent no-op).
 */
export function resolveActiveTag(api: NotebookNavigatorAPI | null, cachedTag: string | null): string | null {
    if (!api) {
        return null;
    }

    const liveTag = readNavItemTag(api, safeGetNavItem(api));
    if (liveTag) {
        return liveTag;
    }

    // Fall back to the cached last-known tag (navigator pane may be closed).
    if (cachedTag && !isCollection(api, cachedTag)) {
        return cachedTag;
    }

    return null;
}

/**
 * Extracts a usable tag from a NavItem, or null if it isn't a concrete tag selection.
 * Filters out virtual collection rows.
 */
export function readNavItemTag(api: NotebookNavigatorAPI | null, item: NavItem | null): string | null {
    if (!item || item.type !== 'tag') {
        return null;
    }
    const tag = item.tag?.trim();
    if (!tag) {
        return null;
    }
    if (isCollection(api, tag)) {
        return null;
    }
    return tag;
}

function safeGetNavItem(api: NotebookNavigatorAPI): NavItem | null {
    try {
        return api.selection?.getNavItem() ?? null;
    } catch {
        return null;
    }
}

function isCollection(api: NotebookNavigatorAPI | null, tag: string): boolean {
    try {
        return api?.tagCollections?.isCollection(tag) ?? false;
    } catch {
        return false;
    }
}
