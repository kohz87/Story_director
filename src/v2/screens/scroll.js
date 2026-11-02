// Story Director v2: bring one box into view inside the scroller that holds it, and move nothing else.
//
// `node.scrollIntoView()` scrolls every scrollable ancestor, the document and the phone's visual viewport with them. Story Block's own
// view/scroll.js has the helpers for that (`revealIn`, `zoomOf`); a module cannot import a host file, so this is the same small piece
// (same maths, same margins): it sets one scroller's `scrollTop` and nothing else. Everything tolerates a document with no layout
// (the tests' fake DOM): nothing is scrolled then, and nothing throws.

/** The CSS zoom `node` is drawn at (the browser's `currentCSSZoom`, else its drawn width over its own); 1 when there is nothing to measure. */
export function zoomOf(node) {
    const own = Number(node?.currentCSSZoom);
    if (Number.isFinite(own) && own > 0) return own;
    const width = Number(node?.offsetWidth);
    const drawn = Number(node?.getBoundingClientRect?.()?.width);
    return width > 0 && drawn > 0 ? drawn / width : 1;
}

/** The nearest ancestor of `node` that scrolls (overflow auto or scroll, with more to show), never the page itself; null where there is none. */
export function scrollerOf(node) {
    const doc = node?.ownerDocument;
    const view = doc?.defaultView;
    if (typeof view?.getComputedStyle !== 'function') return null;
    for (let at = node.parentElement; at && at !== doc.body && at !== doc.documentElement; at = at.parentElement) {
        const overflow = view.getComputedStyle(at)?.overflowY;
        if ((overflow === 'auto' || overflow === 'scroll') && Number(at.scrollHeight) > Number(at.clientHeight)) return at;
    }
    return null;
}

/**
 * Scrolls `scroller` (not its ancestors; null: the node's own scroller) so `node` shows: 'nearest' only as far as needed (a box taller than
 * the room has its top at the top), 'start' puts it near the top. → whether it moved.
 */
export function revealIn(scroller, node, block = 'nearest') {
    const box = scroller ?? scrollerOf(node);
    if (!box || !node || typeof box.getBoundingClientRect !== 'function' || typeof node.getBoundingClientRect !== 'function') return false;
    const outer = box.getBoundingClientRect();
    const rect = node.getBoundingClientRect();
    if (!(outer.height > 0)) return false;
    const margin = 8;
    let delta = 0;
    if (block === 'nearest') {
        if (rect.top < outer.top + margin) delta = rect.top - (outer.top + margin);
        else if (rect.bottom > outer.bottom - margin) delta = Math.min(rect.bottom - (outer.bottom - margin), rect.top - (outer.top + margin));
    } else delta = rect.top - (outer.top + margin);
    if (!delta) return false;
    const before = box.scrollTop;
    box.scrollTop = before + delta / zoomOf(box);
    return box.scrollTop !== before;
}
