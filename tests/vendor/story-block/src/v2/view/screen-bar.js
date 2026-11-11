// The screen bar (UI stage 7): the navigation between screens for the game view and the Story panel; both draw the strip (below).
// The older pill is kept for `strip: false`: on a phone a floating glass pill at the foot of the window with five slots:
// the first four screens that are in the bar (an item says `moreOnly` when it is not; Settings → Tabs & Packs), in the reader's
// order, then More. More opens a glass sheet over the bar with the remaining screens in a four-column grid; a tap on the scrim,
// Escape or a tile closes it, and the focus goes back to More. The wide game view draws every screen that is in the bar in one
// row instead (`row: true`), with More at the end while some screen is under it. `pinned` (in the options, or on an update) is the
// number of slots before More when the bar is not a row: four on a phone's pill; the Story panel gives more when it is wide enough
// (host-ui.js panelSlots) and the columns follow (an inline grid-template-columns).
//
// The current item: the icon and label in the accent colour and a 4px dot under it, no pill or background. While a screen
// under More is current, More shows that screen's icon and label (More's accessible name says so) and is current itself.
// createScreenBar(doc, host, { label, onSelect(id), pinned? })
//   host: the positioned box the bar, its scrim and its sheet are added to (the game view or the Story panel).
//   className: the host's own class for the bar (its placement: mounts.css, host.css), e.g. `ss-gameview-nav`.
//   onSelect(id): a slot or a tile was chosen (the caller shows that screen, then calls update).
//   decorate(node, item): optional; called for each slot and each tile on every draw (the Story panel adds its own names).
//   → { el, update({ items, current, strip?, row, pinned? }), isMoreOpen(), openMore(), closeMore(), destroy() }
// items: [{ id, label, icon, moreOnly? }] in the reader's order; current: the id on screen; row: every item that is in the bar in one
// row, More after them (hidden while nothing is under it).
// Icons: the item's icon is a `ph-*` id from the Phosphor set (view/icons: iconFor gives it, the screen's own icon or the
// default for the id); the current one draws the solid weight (`ph-x:fill`), the others the line weight. A Font Awesome class
// (a module's own icon) still draws as it did. More is `ph-dots-three-outline`.
// The strip (`strip: true`, what the game view and the Story panel pass): every item is a slot in ONE row that scrolls sideways (the
// CSS snaps it and hides the scrollbar), the ones the reader put in the bar first, the `moreOnly` ones after them in the same order; More
// is never drawn. `data-fade` on the bar says which edge has more tabs (`start`, `end`, `both`; kept on scroll and on resize) and the CSS fades it;
// `data-alert` and a dot on that edge say an alerting tab is out of sight beyond it. The current slot is scrolled into view when the bar opens
// and when the current screen changes. Left and Right (Home, End) move the focus between slots. Slots are buttons in the page's Tab order;
// the sheet (`strip: false`) keeps Tab inside and closes on Escape. Built with createElement and textContent only (dom.js); focusNode (scroll.js).

import { h, iconNode, str } from './widgets/dom.js';
import { focusNode, revealIn } from './scroll.js';
import { stackOf } from './modal-stack.js';
import { hasIcon } from './icons/index.js';
import { STRINGS, fill } from '../strings.js';

const S = STRINGS.bar;
export const PINNED = 4;
export const MORE_ICON = 'ph-dots-three-outline';
export const DEFAULT_ICON = 'ph-list';
const LABEL_MAX = 200;
let serial = 0;

/** The items as drawn: { id, label, icon }, the first of each id, a label that is empty takes the id. */
export function barItems(list) {
    const out = [];
    const seen = new Set();
    for (const raw of Array.isArray(list) ? list : []) {
        if (!raw || typeof raw !== 'object') continue;
        const id = str(raw.id).trim();
        if (!id || seen.has(id)) continue;
        seen.add(id);
        const label = str(raw.label).replace(/\s+/g, ' ').trim().slice(0, LABEL_MAX) || id;
        // `alert`: the tab is active with something to show (a red dot, no number); `alertText` is the badge's words for its name; see pinAlerts.
        const alert = raw.alert === true;
        out.push({ id, label, icon: typeof raw.icon === 'string' ? raw.icon : '', alert, alertText: alert ? str(raw.alertText).replace(/\s+/g, ' ').trim().slice(0, 40) : '',
            ...(raw.moreOnly === true ? { moreOnly: true } : {}) });
    }
    return out;
}

/**
 * An active tab with an alert takes the last pinned slot while it has something to show, and the item that held that slot goes to
 * More (the rest keep their order). The first alert only. Items without one are returned as they are. Only the items that are in
 * the bar take part: one that is under More (`moreOnly`) keeps its own place in the list.
 */
export function pinAlerts(items, pinned = PINNED) {
    const list = Array.isArray(items) ? items : [];
    const slots = list.map((item, at) => (item.moreOnly ? -1 : at)).filter(at => at >= 0);
    const at = slots.findIndex(place => list[place].alert === true);
    if (at < 0 || at < pinned - 1) return list;
    const order = slots.map(place => list[place]);
    const [alert] = order.splice(at, 1);
    order.splice(pinned - 1, 0, alert);
    const out = list.slice();
    slots.forEach((place, i) => { out[place] = order[i]; });
    return out;
}

/** The reader's order split into the slots (the first `pinned` that are in the bar) and what More holds (the rest). */
export function splitItems(items, pinned = PINNED) {
    const list = Array.isArray(items) ? items : [];
    const visible = list.filter(item => !item.moreOnly).slice(0, pinned);
    const ids = new Set(visible.map(item => item.id));
    return { pinned: visible, more: list.filter(item => !ids.has(item.id)) };
}

/** The strip's order: the items that are in the bar first, then the `moreOnly` ones, each group in the reader's order. */
export function stripOrder(items) {
    const list = Array.isArray(items) ? items : [];
    return [...list.filter(item => !item.moreOnly), ...list.filter(item => item.moreOnly)];
}

/** The item under More that is current (More then shows its icon and label), or null. */
export function moreHolds(items, current, pinned = PINNED) {
    return splitItems(items, pinned).more.find(item => item.id === current) ?? null;
}

// The one seam for the icon set (see the header): the icon's weight is the solid one when `solid` (the current item).
// Never empty: an icon that does not draw gives the default.
function glyph(doc, value, className, solid = false) {
    const id = typeof value === 'string' ? value.trim() : '';
    const base = id.split(':')[0];
    const named = hasIcon(base) ? `${base}${solid ? ':fill' : ''}` : id;
    return iconNode(doc, named, className) ?? iconNode(doc, DEFAULT_ICON, className);
}

function labelNode(doc, text) {
    return h(doc, 'span', 'ss-screenbar-label', text);
}

// The alert's red dot (an active tab with something to show): at the icon's top-right, decorative; the name says it.
function alertNode(doc) {
    const alert = h(doc, 'span', 'ss-screenbar-alert');
    alert.setAttribute('aria-hidden', 'true');
    return alert;
}

// The name of a slot or tile: its label, and the alert's words after it when it has one ("Fight, your move"; "Fight, alert" with none).
function nameOf(item) {
    return item.alert ? fill(S.alertSlot, { title: item.label, alert: item.alertText || S.alertWord }) : item.label;
}

// The dot under the current slot: decorative (the state is in aria-current).
function dotNode(doc) {
    const dot = h(doc, 'span', 'ss-screenbar-dot');
    dot.setAttribute('aria-hidden', 'true');
    return dot;
}

export function createScreenBar(doc, host, options = {}) {
    const onSelect = typeof options.onSelect === 'function' ? options.onSelect : () => {};
    const decorate = typeof options.decorate === 'function' ? options.decorate : () => {};
    const slotCount = value => (Number.isInteger(value) && value > 0 ? value : null);
    let pinnedCount = slotCount(options.pinned) ?? PINNED;
    // The hint in the sheet: where the reader chooses what stays in the bar.
    const moreHint = S.moreHint;
    const id = `ss-screenbar-${(serial += 1)}`;

    const nav = h(doc, 'nav', ['ss-screenbar', str(options.className).trim()].filter(Boolean).join(' '));
    nav.setAttribute('aria-label', str(options.label) || S.screens);
    const more = h(doc, 'button', 'ss-screenbar-item ss-screenbar-more');
    more.setAttribute('type', 'button');
    more.setAttribute('aria-expanded', 'false');
    more.setAttribute('aria-controls', `${id}-sheet`);
    // The strip's edge alert dots (sticky at each edge while an alerting tab is scrolled out past it; see edgeAlerts()).
    const edgeDot = edge => { const dot = h(doc, 'span', 'ss-screenbar-edge-alert'); dot.hidden = true; dot.setAttribute('aria-hidden', 'true'); dot.setAttribute('data-edge', edge); return dot; };
    const [startDot, endDot] = [edgeDot('start'), edgeDot('end')];
    nav.append(startDot, more, endDot);

    // The scrim and the sheet: over the host, under the bar (which stays tappable: More closes the sheet).
    const scrim = h(doc, 'div', 'ss-screenbar-scrim');
    scrim.hidden = true;
    scrim.setAttribute('aria-hidden', 'true');
    const sheet = h(doc, 'div', 'ss-screenbar-sheet');
    sheet.setAttribute('id', `${id}-sheet`);
    sheet.hidden = true;
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('aria-label', S.moreSheet);
    sheet.setAttribute('tabindex', '-1');
    const head = h(doc, 'div', 'ss-screenbar-sheet-head');
    head.append(h(doc, 'span', 'ss-screenbar-sheet-title', S.more), h(doc, 'span', 'ss-screenbar-sheet-rule'));
    const hint = h(doc, 'span', 'ss-screenbar-sheet-hint', moreHint);
    head.appendChild(hint);
    const grid = h(doc, 'div', 'ss-screenbar-grid');
    const empty = h(doc, 'p', 'ss-screenbar-empty', S.moreEmpty);
    empty.hidden = true;
    sheet.append(head, grid, empty);
    host.append(nav, scrim, sheet);

    let items = [];
    let current = null;
    let row = false;
    let strip = false;
    let scrolledTo = null;    // the current id the strip was last scrolled to
    let open = false;
    let layer = null;         // the sheet's entry in the shared stack (modal-stack.js) while it is open
    const slots = new Map();   // id → the slot button (kept across draws, so a focused slot keeps its focus)
    const tiles = new Map();   // id → the sheet's tile

    // The slot's content: the icon, the label, the dot (the dot is what marks the current one, besides the colour).
    function paint(node, item, isCurrent) {
        node.replaceChildren(glyph(doc, item.icon, 'ss-screenbar-icon', isCurrent), labelNode(doc, item.label), dotNode(doc));
        // The alert: a small red dot at the icon's top-right (Cards.dc.html); the slot's name and tooltip say it ("Fight, your move").
        if (item.alert) node.appendChild(alertNode(doc));
        node.setAttribute('data-id', item.id);
        name(node, item);
        if (isCurrent) {
            node.setAttribute('aria-current', 'page');
            node.classList.add('ss-screenbar-current');
        } else {
            node.removeAttribute('aria-current');
            node.classList.remove('ss-screenbar-current');
        }
    }

    // The accessible name and the tooltip: the label alone, or with the alert's words.
    function name(node, item) {
        node.setAttribute('title', nameOf(item));
        if (item.alert) node.setAttribute('aria-label', nameOf(item));
        else node.removeAttribute('aria-label');
    }

    function slotFor(item) {
        let node = slots.get(item.id);
        if (!node) {
            node = h(doc, 'button', 'ss-screenbar-item');
            node.setAttribute('type', 'button');
            node.addEventListener('click', () => choose(item.id, false));
            slots.set(item.id, node);
        }
        return node;
    }

    function tileFor(item) {
        let node = tiles.get(item.id);
        if (!node) {
            node = h(doc, 'button', 'ss-screenbar-tile');
            node.setAttribute('type', 'button');
            node.addEventListener('click', () => choose(item.id, true));
            tiles.set(item.id, node);
        }
        return node;
    }

    function choose(itemId, fromSheet) {
        // A tile closes the sheet and gives the focus back to More; a slot closes it and leaves the focus where the reader put it.
        if (open) closeMore({ focus: fromSheet });
        onSelect(itemId);
    }

    // Where the focus is in the bar, as a key the redraw can find again: More, a slot (by id), a tile (by id), the sheet.
    function focusedKey() {
        const a = doc.activeElement;
        if (!a) return null;
        if (a === more) return { more: true };
        const id = a.getAttribute?.('data-id');
        if (nav.contains?.(a)) return id ? { slot: id } : null;
        if (sheet.contains?.(a)) return id ? { tile: id } : { sheet: true };
        return null;
    }

    // After a redraw: the focus goes where it was, or to its nearest equivalent: a slot that moved under More gives More; in the
    // row while More is not drawn (nothing is under it) More's held screen, else the current slot, else the first one takes it; a tile
    // that is gone gives the first tile.
    function restoreFocus(before) {
        if (!before) return;
        // the first slot as drawn (the map holds them in the order they were made, which is not the bar's)
        const firstSlot = [...nav.children].find(node => node !== more && node.getAttribute?.('data-id')) ?? null;
        const firstTile = [...tiles.values()][0] ?? null;
        const moreDrawn = !more.hidden;
        let target = null;
        // Where a slot that is gone sends the focus: More while it is drawn; else the current slot or the first.
        const fallback = moreDrawn ? more : (slots.get(current) ?? firstSlot);
        if (before.more) {
            const held = moreDrawn ? null : moreHolds(items, current, pinnedCount);
            target = moreDrawn ? more : (slots.get(held?.id ?? current) ?? firstSlot);
        } else if (before.slot) {
            target = slots.get(before.slot) ?? fallback;
        } else if (before.tile) {
            target = moreDrawn ? (open ? (tiles.get(before.tile) ?? firstTile ?? sheet) : more) : (slots.get(before.tile) ?? fallback);
        } else if (before.sheet) {
            target = open ? sheet : more;
        }
        if (!target || doc.activeElement === target) return;
        focusNode(target);
        if (target !== more && target !== sheet) revealIn(sheet, target, 'nearest');
    }

    function draw() {
        const focusBefore = focusedKey();
        // The row has no room limit: every item that is in the bar is a slot, and More holds the others (it is drawn only then).
        const { pinned, more: rest } = strip ? { pinned: stripOrder(items), more: [] } : splitItems(items, row ? Infinity : pinnedCount);
        // More columns than the pill's five only when more than four slots are drawn (the Story panel on a wide window): one for each slot and More.
        const wideGrid = !row && !strip && pinned.length > PINNED;
        if (wideGrid) {
            nav.style?.setProperty?.('grid-template-columns', `repeat(${pinned.length + 1}, minmax(0, 1fr))`);
            more.style?.setProperty?.('grid-column', String(pinned.length + 1));   // glass.css keeps More in the pill's fifth column
        } else {
            nav.style?.removeProperty?.('grid-template-columns');
            more.style?.removeProperty?.('grid-column');
        }
        nav.classList.toggle('ss-screenbar-row', row);
        nav.classList.toggle('ss-screenbar-strip', strip);
        more.hidden = strip || (row && !rest.length);
        if (more.hidden && open) closeMore({ focus: false });

        // The slots, in order, before More.
        const keep = new Set(pinned.map(item => item.id));
        for (const [key, node] of slots) if (!keep.has(key)) { node.remove(); slots.delete(key); }
        let next = more;
        for (let at = pinned.length - 1; at >= 0; at--) {
            const item = pinned[at];
            const node = slotFor(item);
            paint(node, item, item.id === current);
            decorate(node, item);
            if (node.parentNode !== nav || node.nextSibling !== next) nav.insertBefore(node, next);
            next = node;
        }

        // More: its own icon and label, unless a screen under it is current.
        const held = more.hidden ? null : moreHolds(items, current, row ? Infinity : pinnedCount);
        // An alerting tab under More (the second one: only the first is pinned) gives More the dot.
        const hidden = rest.find(item => item.alert);
        more.replaceChildren(
            glyph(doc, held ? held.icon : MORE_ICON, 'ss-screenbar-icon', Boolean(held)),
            labelNode(doc, held ? held.label : S.more),
            dotNode(doc),
            ...(hidden ? [alertNode(doc)] : []),
        );
        more.classList.toggle('ss-screenbar-current', Boolean(held));
        const moreName = held ? fill(S.moreWith, { title: held.label }) : S.more;
        const shown = hidden ? fill(S.moreAlert, { more: moreName, title: hidden.label, alert: hidden.alertText || S.alertWord }) : moreName;
        if (held) {
            more.setAttribute('aria-current', 'page');
            more.setAttribute('title', shown);
        } else {
            more.removeAttribute('aria-current');
            more.setAttribute('title', hidden ? shown : S.more);
        }
        if (held || hidden) more.setAttribute('aria-label', shown);
        else more.removeAttribute('aria-label');

        // The sheet's tiles: the rest, in order; the current one marked.
        const tileKeep = new Set(rest.map(item => item.id));
        for (const [key, node] of tiles) if (!tileKeep.has(key)) { node.remove(); tiles.delete(key); }
        rest.forEach((item, at) => {
            const node = tileFor(item);
            const isCurrent = item.id === current;
            node.replaceChildren(glyph(doc, item.icon, 'ss-screenbar-tile-icon', isCurrent), labelNode(doc, item.label), ...(item.alert ? [alertNode(doc)] : []));
            node.setAttribute('data-id', item.id);
            name(node, item);
            if (isCurrent) node.setAttribute('aria-current', 'page');
            else node.removeAttribute('aria-current');
            decorate(node, item);
            if (grid.children[at] !== node) grid.insertBefore(node, grid.children[at] ?? null);
        });
        empty.hidden = rest.length > 0;
        restoreFocus(focusBefore);
        if (strip) showCurrent();
        else { nav.removeAttribute('data-fade'); edgeAlerts(false); }
    }

    // The strip: the current slot into view (once for each current id), and the fade on the edge that has more tabs.
    function showCurrent() {
        if (current !== scrolledTo) {
            const node = slots.get(current);
            if (node) { scrolledTo = current; node.scrollIntoView?.({ inline: 'center', block: 'nearest' }); }
        }
        fade();
    }
    function fade() {
        const left = Number(nav.scrollLeft) || 0;
        const room = (Number(nav.scrollWidth) || 0) - (Number(nav.clientWidth) || 0);
        const edge = room > 1 ? `${left > 1 ? 'start' : ''}${left < room - 1 ? 'end' : ''}` : '';
        if (edge) nav.setAttribute('data-fade', edge === 'startend' ? 'both' : edge);
        else nav.removeAttribute('data-fade');
        edgeAlerts(edge !== '');
    }
    // An alerting slot past an edge (its centre in the fade or beyond): a chevron shows on that edge; it clears when the slot is in view.
    function edgeAlerts(fading) {
        let before = false, after = false;
        const box = fading && strip && nav.getBoundingClientRect?.();
        for (const item of box ? items : []) {
            const at = item.alert && slots.get(item.id)?.getBoundingClientRect?.();
            if (!at) continue;
            const mid = at.left + (at.width ?? at.right - at.left) / 2; // past an edge once its centre is inside the 28px fade
            if (mid <= box.left + 28) before = true;
            else if (mid >= box.right - 28) after = true;
        }
        startDot.hidden = !before;
        endDot.hidden = !after;
        nav.setAttribute('data-alert', `${before ? 'start' : ''} ${after ? 'end' : ''}`.trim());
    }
    // Arrow keys between the slots (the strip's own keys; Tab still walks them too).
    nav.addEventListener('keydown', event => {
        if (!strip || event.altKey || event.ctrlKey || event.metaKey) return;
        const at = [...nav.children].filter(node => node !== more && node.getAttribute?.('data-id'));
        const here = at.indexOf(doc.activeElement);
        const to = { ArrowRight: here + 1, ArrowLeft: here - 1, Home: 0, End: at.length - 1 }[event.key];
        if (here < 0 || to === undefined || !at[to]) return;
        event.preventDefault?.();
        focusNode(at[to]);
        at[to].scrollIntoView?.({ inline: 'nearest', block: 'nearest' });
    });
    nav.addEventListener('scroll', fade);
    // The fade follows the bar's size (a resize or a rotation that changes what fits); no observer, no recompute.
    const resizes = typeof globalThis.ResizeObserver === 'function' ? new globalThis.ResizeObserver(() => { if (strip) fade(); }) : null;
    resizes?.observe(nav);

    function tileNodes() {
        return [...grid.children].filter(node => node.getAttribute?.('data-id') && !node.hidden);
    }

    function openMore() {
        if (open || more.hidden) return false;
        open = true;
        more.setAttribute('aria-expanded', 'true');
        scrim.hidden = false;
        sheet.hidden = false;
        // A layer of the shared stack: Escape closes the sheet first, Tab stays in it (modal-stack.js).
        layer = stackOf(doc).push({ name: 'more', root: sheet, onEscape: () => { closeMore({ focus: true }); return true; }, reveal: node => revealIn(sheet, node, 'nearest') });
        const target = tileNodes().find(node => node.getAttribute('aria-current') === 'page') ?? tileNodes()[0] ?? sheet;
        focusNode(target);
        if (target !== sheet) revealIn(sheet, target, 'nearest');
        return true;
    }

    function closeMore({ focus = true } = {}) {
        if (!open) return false;
        open = false;
        more.setAttribute('aria-expanded', 'false');
        scrim.hidden = true;
        sheet.hidden = true;
        stackOf(doc).pop(layer, { focus: false });
        layer = null;
        if (focus) focusNode(more);
        return true;
    }

    more.addEventListener('click', () => {
        if (open) closeMore({ focus: true });
        else openMore();
    });
    scrim.addEventListener('click', () => closeMore({ focus: true }));

    return {
        el: nav,
        update(next = {}) {
            items = barItems(next.items);
            current = typeof next.current === 'string' && next.current ? next.current : null;
            row = next.row === true;
            strip = next.strip === true;
            pinnedCount = slotCount(next.pinned) ?? slotCount(options.pinned) ?? PINNED;
            draw();
        },
        isMoreOpen: () => open,
        openMore,
        closeMore: (options = {}) => closeMore({ focus: options.focus !== false }),
        destroy() {
            closeMore({ focus: false });
            resizes?.disconnect();
            nav.remove();
            scrim.remove();
            sheet.remove();
            slots.clear();
            tiles.clear();
        },
    };
}
