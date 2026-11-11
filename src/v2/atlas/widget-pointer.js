// Story Director v2, atlas part: the Map widget's place clicks, hover and pointer input (moved out of widget.js;
// widget.js still exports its public names): taps pick the nearest dot on a phone, hover and focus
// show a place's name, and pointer drags, pinches and the wheel pan and zoom the stage.

import { panBy, zoomAt } from './view.js';

const WHEEL_RATE = 0.0015;
const DRAG_THRESHOLD = 4;
const TAP_HALF = 22;               // half of a phone's 44px tap area on the screen (a coarse pointer, PHONE)
// The phone line, as Story Block's (its size.css): a narrow screen or a coarse pointer gets the dots' 44px tap areas.
const PHONE = '(pointer: coarse)';

// Three groups: `dom` (window, document and the nodes), `view` (the state `s` and what reads the view) and `hooks` (what the widget lends it).
export function createPointer({ dom, view, hooks }) {
    const { win, doc, stage, placesLayer, results, searchBox } = dom;
    const { s, nodes, placeAt, measure, zoomOf, getBox, getLimits } = view;
    const { pick, paint, listen, stopAnimation, setView } = hooks;
    // A place: click, tap, Enter or Space (it is a button). Hover and focus show its name.
    const placeOf = target => {
        for (let node = target; node && node !== placesLayer; node = node.parentNode) if (node.getAttribute?.('data-id') && nodes.get(node.getAttribute('data-id')) === node) return node.getAttribute('data-id');
        return '';
    };
    let dropClick = false;
    // On a phone the tap went to a button whose 44px square holds the tap; where two squares
    // cover one dot, the place whose dot is nearest the tap is the one picked (desktop: as is).
    // A click from the keyboard (Enter or Space on a focused place: detail 0, no pointer position)
    // is that place's own, never the nearest dot's.
    const phone = () => Boolean(win?.matchMedia?.(PHONE)?.matches);
    const tapped = event => {
        const own = placeOf(event.target);
        if (!phone() || typeof event.clientX !== 'number' || event.detail === 0) return own;
        const tap = local(event);
        const half = TAP_HALF / zoomOf();
        let best = '';
        let bestD = Infinity;
        for (const [id, dot] of placeAt) {
            if (Math.abs(dot.x - tap.x) > half || Math.abs(dot.y - tap.y) > half) continue;
            const d = Math.hypot(dot.x - tap.x, dot.y - tap.y);
            if (d < bestD) { best = id; bestD = d; }
        }
        return best || own;
    };
    listen(placesLayer, 'click', event => {
        const id = tapped(event);
        if (!id) return;
        if (dropClick) {
            dropClick = false;
            return;
        }
        pick(id);
    });
    const hover = id => {
        if (s.hovered === id) return;
        s.hovered = id;
        paint();
    };
    listen(placesLayer, 'pointerover', event => hover(placeOf(event.target)));
    listen(placesLayer, 'pointerout', () => hover(''));
    listen(placesLayer, 'focusin', event => hover(placeOf(event.target)));
    listen(placesLayer, 'focusout', () => hover(''));

    // Pointer pan (mouse, pen, one finger) and pinch (two fingers).
    const pointers = new Map();
    let moved = 0;
    let captured = null;
    const local = event => {
        const rect = stage.getBoundingClientRect?.() ?? { left: 0, top: 0 };
        const z = zoomOf();
        return { x: (event.clientX - rect.left) / z, y: (event.clientY - rect.top) / z };
    };
    listen(stage, 'pointerdown', event => {
        if (event.pointerType === 'mouse' && event.button) return;
        stopAnimation();
        measure();
        if (!pointers.size) {
            moved = 0;
            dropClick = false;
        }
        pointers.set(event.pointerId, local(event));
    });
    listen(stage, 'pointermove', event => {
        const before = pointers.get(event.pointerId);
        if (!before) return;
        const now = local(event);
        if (pointers.size === 1) {
            moved += Math.abs(now.x - before.x) + Math.abs(now.y - before.y);
            pointers.set(event.pointerId, now);
            if (moved > DRAG_THRESHOLD && captured === null) {
                captured = event.pointerId;
                try { stage.setPointerCapture?.(event.pointerId); } catch { /* not capturable */ }
                stage.classList.add('sd-map-dragging');
            }
            if (moved > DRAG_THRESHOLD) setView(panBy(s.view, now.x - before.x, now.y - before.y, getBox(), getLimits()));
            return;
        }
        const [a, b] = [...pointers.values()];
        const oldMid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const oldDistance = Math.hypot(a.x - b.x, a.y - b.y);
        pointers.set(event.pointerId, now);
        const [c, d] = [...pointers.values()];
        const newMid = { x: (c.x + d.x) / 2, y: (c.y + d.y) / 2 };
        const newDistance = Math.hypot(c.x - d.x, c.y - d.y);
        moved = Infinity;
        let next = oldDistance > 0 && newDistance > 0 ? zoomAt(s.view, newDistance / oldDistance, oldMid.x, oldMid.y, s.size.width, s.size.height, getBox(), getLimits()) : s.view;
        next = panBy(next, newMid.x - oldMid.x, newMid.y - oldMid.y, getBox(), getLimits());
        setView(next);
    });
    const release = event => {
        if (!pointers.delete(event.pointerId) || pointers.size) return;
        // A drag that ends on a place must not pick it: the click that follows is dropped.
        if (moved > DRAG_THRESHOLD) {
            dropClick = true;
            win?.setTimeout?.(() => { dropClick = false; }, 0);
        }
        if (captured !== null) {
            try { stage.releasePointerCapture?.(captured); } catch { /* already released */ }
            captured = null;
        }
        stage.classList.remove('sd-map-dragging');
    };
    listen(stage, 'pointerup', release);
    listen(stage, 'pointercancel', release);
    listen(stage, 'wheel', event => {
        event.preventDefault?.();
        stopAnimation();
        measure();
        const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaMode === 2 ? event.deltaY * s.size.height : event.deltaY;
        const at = local(event);
        setView(zoomAt(s.view, Math.exp(-(Number(delta) || 0) * WHEEL_RATE), at.x, at.y, s.size.width, s.size.height, getBox(), getLimits()));
    }, { passive: false });

    // A click elsewhere closes the results list.
    if (typeof doc.addEventListener === 'function') {
        listen(doc, 'click', event => {
            if (!results.hidden && !searchBox.contains?.(event.target)) results.hidden = true;
        });
    }
}
