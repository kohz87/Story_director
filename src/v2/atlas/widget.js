// Story Director v2, atlas part: the Map widget `story-director.map` (MODULES §F9 namespaced widget).
//
// Draws `atlas.view` (map.js `atlasView`): routes as SVG lines in stage pixels (one view transform,
// view.js `toScreen`, for routes and places alike; each line cut to the stage, so a street seen at a
// country's zoom never becomes a line a million pixels long), places as buttons over it, their names placed so none overlaps another (view.js
// `placeLabels`), and the "you are here" ring above everything. The reader can:
// * pan (drag, one finger, arrow keys) and zoom (wheel about the pointer, pinch, + / − buttons and
//   keys, 0 or "Fit" for the whole layer, "Me" to centre on the current place), inside the zoom
//   limits and never off the world; unvisited places get their icon, then their name, as the map
//   comes closer, and hover or focus shows any place's name;
// * switch layers with the Region list beside the search box: All, then each region and plane that has places;
// * search places by name, alias or region (unvisited ones too, marked "not visited"); picking one
//   moves the map to it and shows it;
// * pick a place (click, tap, Enter) for its details: kind, region, visited or not, and the trip
//   from the current place by known routes (query `atlas.place`, travel.js).
// * a trip (feature `story-director.trip`, query `atlas.trip` as the prop `trip`): its route drawn as a thick accent line over the known
//   routes, a "You" marker at the derived point along the current leg, the movers {{user}} knows of as diamonds on their leg, and an "On the
//   road" panel (destination, mode and pace, each leg with a progress bar on the current one, the movers). The panel sits over the map's
//   corner; on a phone it goes under the map.
// The view (centre and zoom) is the reader's alone: kept in memory per layer for this page, never
// in the story state. Picking a place writes nothing either (a screen may still pass `onSelect`).
// Moves to a picked place are eased, except under prefers-reduced-motion.
// Story Block draws its screens zoomed (its size.css): pointer and measured positions are drawn pixels, the stage's own
// lengths (style.left, the view) are not, so every measure is divided by the stage's zoom (zoomOf).
//
// The stylesheet is in widget-css.js; the prop readers and small helpers are in widget-view.js; the drawing is in widget-draw.js.

import {
    NEAR_PX, between, boundsOf, centreOn, clampView, fitView, mapPoint, nearestGap, panBy, placeUnplaced, searchPlaces, zoomAt, zoomLevel,
    zoomLimits,
} from './view.js';
import { ensureStyle } from './widget-css.js';
import { SVG_NS, createDraw } from './widget-draw.js';
import { ALL, button, h, humanize, icon, layerFor, onLayer, readTrip, readView, text } from './widget-view.js';

export { MAP_CSS } from './widget-css.js';
export { onLayer, readTrip, readView } from './widget-view.js';

export const MAP_WIDGET = 'story-director.map';
const FALLBACK_SIZE = Object.freeze({ width: 640, height: 480 });
const BUTTON_ZOOM = 1.5;
const KEY_PAN = 0.15;              // share of the stage an arrow key moves
const WHEEL_RATE = 0.0015;
const DRAG_THRESHOLD = 4;
const EASE_MS = 260;
const TAP_HALF = 22;               // half of a phone's 44px tap area on the screen (the phone line, PHONE)
// The phone line, as Story Block's (its size.css): a narrow screen or a coarse pointer gets the dots' 44px tap areas.
const PHONE = '(max-width: 759.98px), (pointer: coarse)';

// Remembered views for this page: `${viewKey}|${layer}` → { cx, cy, zoom (× fit) }. Never story state.
const views = new Map();
/** Forget remembered views (tests). */
export const forgetViews = () => views.clear();

function render(el, props, api) {
    const doc = el.ownerDocument ?? globalThis.document;
    ensureStyle(doc);
    const win = doc.defaultView ?? globalThis.window ?? null;
    const listeners = [];
    const listen = (node, type, fn, options) => {
        node.addEventListener(type, fn, options);
        listeners.push([node, type, fn, options]);
    };

    // ---- the DOM --------------------------------------------------------------------------------
    const root = h(doc, 'div', 'sd-map ss-glass');
    root.setAttribute('role', 'group');
    const bar = h(doc, 'div', 'sd-map-bar');
    const searchBox = h(doc, 'div', 'sd-map-search');
    const input = h(doc, 'input');
    input.setAttribute('type', 'search');
    input.setAttribute('placeholder', 'Find a place');
    input.setAttribute('aria-label', 'Find a place by name, other name or region');
    input.setAttribute('autocomplete', 'off');
    const results = h(doc, 'ul', 'sd-map-results');
    results.setAttribute('aria-label', 'Places found');
    results.hidden = true;
    searchBox.append(input, results);
    const tools = h(doc, 'div', 'sd-map-tools');
    tools.setAttribute('role', 'toolbar');
    tools.setAttribute('aria-label', 'Zoom');
    const zoomIn = button(doc, 'sd-map-btn sd-map-zoom-in', '+', 'Zoom in');
    const zoomOut = button(doc, 'sd-map-btn sd-map-zoom-out', '−', 'Zoom out');
    const fitAll = button(doc, 'sd-map-btn sd-map-fit', '', 'Show the whole layer');
    fitAll.append(icon(doc, 'fa-expand'));
    const centreMe = button(doc, 'sd-map-btn sd-map-me', '', 'Centre on where you are');
    centreMe.append(icon(doc, 'fa-location-crosshairs'));
    tools.append(zoomIn, zoomOut, fitAll, centreMe);
    // The layers as a Region list between the search box and the zoom buttons (All first; the shown one selected).
    const regionBox = h(doc, 'label', 'sd-map-region');
    const regions = h(doc, 'select', 'sd-map-regions');
    regions.setAttribute('aria-label', 'Region');
    regionBox.append(h(doc, 'span', 'sd-map-region-cap', 'Region'), regions);
    bar.append(searchBox, regionBox, tools);

    const stage = h(doc, 'div', 'sd-map-stage');
    stage.setAttribute('tabindex', '0');
    stage.setAttribute('role', 'group');
    stage.setAttribute('aria-roledescription', 'map');
    stage.setAttribute('aria-label', 'Map. Drag or use the arrow keys to move; scroll, pinch, or plus and minus to zoom; 0 shows the whole layer.');
    const svg = doc.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'sd-map-svg');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    const worldGroup = doc.createElementNS(SVG_NS, 'g');
    worldGroup.setAttribute('class', 'sd-map-world');
    svg.appendChild(worldGroup);
    const placesLayer = h(doc, 'div', 'sd-map-places');
    placesLayer.setAttribute('role', 'group');
    placesLayer.setAttribute('aria-label', 'Places');
    const labelsLayer = h(doc, 'div', 'sd-map-labels');
    labelsLayer.setAttribute('aria-hidden', 'true');
    const hereRing = h(doc, 'div', 'sd-map-here');
    hereRing.setAttribute('aria-hidden', 'true');
    // The trip's marks above the places: "You" on the current leg, the movers on theirs, each with its pin (all drawn by paint()).
    const markLayer = h(doc, 'div', 'sd-map-marks');
    markLayer.setAttribute('aria-hidden', 'true');
    markLayer.style.cssText = 'position:absolute;inset:0;pointer-events:none;';
    stage.append(svg, placesLayer, labelsLayer, hereRing, markLayer);
    const road = h(doc, 'section', 'sd-map-road');
    road.setAttribute('aria-label', 'On the road');
    road.hidden = true;
    const frame = h(doc, 'div', 'sd-map-frame');
    frame.append(stage, road);

    const empty = h(doc, 'p', 'sd-map-empty', 'No places to show yet.');
    const details = h(doc, 'section', 'sd-map-details');
    details.setAttribute('aria-live', 'polite');
    details.hidden = true;
    const legend = h(doc, 'ul', 'sd-map-legend ss-listcard-rows');
    legend.setAttribute('aria-label', 'Legend');
    const legendCard = h(doc, 'section', 'sd-map-legend-card ss-listcard');
    legendCard.setAttribute('aria-label', 'Legend');
    legendCard.append(h(doc, 'h4', 'ss-label ss-listcard-head', 'Legend'), legend);
    root.append(bar, frame, empty, details, legendCard);
    el.appendChild(root);

    // ---- state ----------------------------------------------------------------------------------
    // The state the drawing reads and writes: one object, so the drawing functions can live in a file of their own.
    const s = {
        data: readView(props),
        layer: '',
        points: new Map(),           // id → map-space point (unplaced ones laid out)
        shown: [],                   // places on the layer
        fitK: 1,
        view: { cx: 0, cy: 0, k: 1 },
        size: { ...FALLBACK_SIZE },
        picked: '',
        hovered: '',
        lines: [],                   // [{ line, route }] on the layer (the known routes, then the trip's legs)
        trip: null,                  // the trip prop, cleaned (readTrip)
        marks: [],                   // [{ node, ids: [from, to], t }]: "You" and the movers, placed by paint()
    };
    let viewKey = text(props?.viewKey) || 'map';
    let onSelect = text(props?.onSelect);
    s.layer = s.data.layer;
    let box = boundsOf([]);
    let limits = { min: 0.5, max: 8 };
    let anim = null;
    const nodes = new Map();         // id → place button
    const placeAt = new Map();       // id → the dot's point in the stage, as drawn last
    const labels = new Map();        // id → label span
    const byId = id => s.data.places.find(place => place.id === id) ?? null;
    const { drawLayers, drawShown, drawRoad, paint } = createDraw(s, {
        doc, regions, regionBox, worldGroup, nodes, labels, placesLayer, labelsLayer, empty, stage, markLayer, road, legend, legendCard, placeAt, hereRing,
    });

    // The zoom the stage is drawn at (Story Block's roots are zoomed): the browser's currentCSSZoom, else drawn over own width.
    function zoomOf() {
        const own = Number(stage.currentCSSZoom);
        if (Number.isFinite(own) && own > 0) return own;
        const width = Number(stage.offsetWidth);
        const drawn = Number(stage.getBoundingClientRect?.()?.width);
        return width > 0 && drawn > 0 ? drawn / width : 1;
    }

    function measure() {
        const rect = stage.getBoundingClientRect?.();
        const z = zoomOf();
        if (rect && rect.width > 0 && rect.height > 0) s.size = { width: rect.width / z, height: rect.height / z };
        return s.size;
    }

    function computePoints() {
        const list = s.data.places.map(place => ({ id: place.id, point: mapPoint(place, s.data.orient) }));
        s.points = placeUnplaced(list, s.data.routes.map(route => [route.from, route.to]));
    }

    function remember() {
        views.set(`${viewKey}|${s.layer}`, { cx: s.view.cx, cy: s.view.cy, zoom: zoomLevel(s.view, s.fitK) });
    }

    function setView(next, { keep = true } = {}) {
        s.view = clampView(next, box, limits);
        if (keep) remember();
        paint();
    }

    function stopAnimation() {
        if (anim !== null) win?.cancelAnimationFrame?.(anim);
        anim = null;
    }

    const reducedMotion = () => {
        try {
            return Boolean(win?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);
        } catch {
            return false;
        }
    };

    // An eased move, or a jump under reduced motion (or where there are no animation frames).
    function moveTo(target) {
        stopAnimation();
        const goal = clampView(target, box, limits);
        if (reducedMotion() || typeof win?.requestAnimationFrame !== 'function') return setView(goal);
        const from = s.view;
        let start = null;
        const step = time => {
            start ??= time;
            const t = Math.min(1, (time - start) / EASE_MS);
            setView(between(from, goal, t), { keep: t >= 1 });
            anim = t < 1 ? win.requestAnimationFrame(step) : null;
        };
        anim = win.requestAnimationFrame(step);
        return undefined;
    }

    function fitNow() {
        measure();
        return fitView(box, s.size.width, s.size.height);
    }

    // The zoom that sets a place apart from its nearest neighbour on the layer (for search and "Me").
    function closeEnough(id) {
        const at = s.points.get(id);
        let nearest = Infinity;
        for (const place of s.shown) {
            if (place.id === id) continue;
            const other = s.points.get(place.id);
            const d = Math.hypot(other.x - at.x, other.y - at.y);
            if (d > 0 && d < nearest) nearest = d;
        }
        const k = Number.isFinite(nearest) ? (NEAR_PX * 1.6) / nearest : s.fitK * 4;
        return Math.min(limits.max, Math.max(s.fitK * 2, k));
    }

    function setLayer(id, { refit = false } = {}) {
        s.layer = s.data.layers.some(item => item.id === id) ? id : ALL;
        s.shown = s.data.places.filter(place => onLayer(place, s.layer));
        box = boundsOf(s.shown.map(place => s.points.get(place.id)));
        const fit = fitNow();
        s.fitK = fit.k;
        limits = zoomLimits(s.fitK, nearestGap(s.shown.map(place => s.points.get(place.id))));
        const saved = refit ? null : views.get(`${viewKey}|${s.layer}`);
        s.view = clampView(saved ? { cx: saved.cx, cy: saved.cy, k: saved.zoom * s.fitK } : fit, box, limits);
        drawLayers();
        drawShown();
        paint();
    }

    // The view fitted to the trip's stops that are on this layer (two or more), inside the zoom limits.
    function fitTrip() {
        const stops = new Set(s.trip.legs.flatMap(leg => [leg.fromId, leg.toId]));
        const at = s.shown.filter(place => stops.has(place.id)).map(place => s.points.get(place.id)).filter(Boolean);
        if (at.length < 2) return;
        measure();
        s.view = clampView(fitView(boundsOf(at), s.size.width, s.size.height), box, limits);
        paint();
    }

    // ---- details --------------------------------------------------------------------------------
    let asked = 0;
    function showDetails(id) {
        const place = byId(id);
        s.picked = place ? id : '';
        if (!place) {
            details.hidden = true;
            details.replaceChildren();
            paint();
            return;
        }
        const close = button(doc, 'sd-map-btn sd-map-close', '×', 'Close');
        const about = [place.kind && humanize(place.kind), place.region].filter(Boolean).join(' · ');
        const status = place.id === s.data.current ? 'You are here.' : place.visited ? 'Visited.' : 'Not visited yet.';
        const trip = h(doc, 'p', 'sd-map-trip');
        details.replaceChildren(h(doc, 'h3', 'sd-map-name', place.name), ...(about ? [h(doc, 'p', 'sd-map-about', about)] : []), h(doc, 'p', 'sd-map-status', status), trip, close);
        details.setAttribute('data-id', place.id);
        details.hidden = false;
        paint();
        if (place.id === s.data.current) return;
        // The trip from the current place, by known routes: code's figures (travel.js), not the story's.
        const ticket = ++asked;
        let detail = null;
        try {
            detail = typeof api?.query === 'function' ? api.query('atlas.place', { id: place.id }) : null;
        } catch {
            detail = null;
        }
        const fill = out => {
            if (ticket !== asked) return;
            const route = out?.trip;
            if (route) {
                const by = route.by?.length ? ` by ${route.by.join(', ')}` : '';
                trip.textContent = `From ${route.fromName}: ${route.km ? `${route.km} km, ` : ''}${route.text}${by}.`;
                trip.className = 'sd-map-trip';
            } else if (s.data.current) {
                trip.textContent = 'No known route from where you are.';
                trip.className = 'sd-map-trip sd-map-none';
            }
        };
        if (detail && typeof detail.then === 'function') detail.then(fill, () => fill(null));
        else fill(detail);
    }

    function pick(id) {
        showDetails(id);
        if (onSelect && typeof api?.command === 'function') {
            try {
                const out = api.command(onSelect, { node: id });
                if (out && typeof out.catch === 'function') out.catch(() => {});
            } catch { /* a click never breaks the map */ }
        }
    }

    // Moves the map to a place (switching layer when it is not on this one), picks it.
    function goTo(id) {
        const place = byId(id);
        if (!place) return;
        if (!onLayer(place, s.layer)) setLayer(layerFor(place, s.layer));
        measure();
        moveTo(centreOn(s.view, s.points.get(id), box, limits, closeEnough(id)));
        pick(id);
    }

    // ---- search ---------------------------------------------------------------------------------
    let hits = [];
    function runSearch() {
        hits = searchPlaces(s.data.places, input.value);
        const items = hits.map(hit => {
            const place = byId(hit.id);
            const li = h(doc, 'li');
            const choose = button(doc, 'sd-map-result');
            choose.setAttribute('data-id', place.id);
            const about = [place.region, place.id === s.data.current ? 'you are here' : place.visited ? '' : 'not visited'].filter(Boolean).join(' · ');
            choose.append(h(doc, 'span', 'sd-map-result-name', place.name), h(doc, 'span', 'sd-map-result-about', about));
            li.append(choose);
            return li;
        });
        if (input.value.trim() && !items.length) items.push(h(doc, 'li', 'sd-map-none', 'No place by that name.'));
        results.replaceChildren(...items);
        results.hidden = !input.value.trim();
    }
    function chooseHit(id) {
        results.hidden = true;
        goTo(id);
    }
    // The Region list, and clicks on the results and the details' Close button (delegated: they are redrawn).
    const closestWith = (target, stop, test) => {
        for (let node = target; node && node !== stop; node = node.parentNode) if (test(node)) return node;
        return null;
    };
    listen(regions, 'change', () => {
        const id = regions.value === 'all' ? ALL : regions.value;
        if (id !== s.layer) setLayer(id);
    });
    listen(results, 'click', event => {
        const choose = closestWith(event.target, results, node => node.getAttribute?.('data-id'));
        if (choose) chooseHit(choose.getAttribute('data-id'));
    });
    listen(details, 'click', event => {
        if (closestWith(event.target, details, node => node.classList?.contains('sd-map-close'))) showDetails('');
    });
    listen(input, 'input', runSearch);
    listen(input, 'keydown', event => {
        if (event.key === 'Enter' && hits.length) {
            event.preventDefault?.();
            chooseHit(hits[0].id);
        } else if (event.key === 'Escape') {
            input.value = '';
            runSearch();
        } else if (event.key === 'ArrowDown' && hits.length) {
            event.preventDefault?.();
            results.querySelector('.sd-map-result')?.focus?.();
        }
    });

    // ---- controls -------------------------------------------------------------------------------
    const zoomCentre = factor => {
        stopAnimation();
        measure();
        setView(zoomAt(s.view, factor, s.size.width / 2, s.size.height / 2, s.size.width, s.size.height, box, limits));
    };
    const fit = () => {
        stopAnimation();
        setView(fitNow());
    };
    const toMe = () => {
        if (s.data.current) goTo(s.data.current);
    };
    listen(zoomIn, 'click', () => zoomCentre(BUTTON_ZOOM));
    listen(zoomOut, 'click', () => zoomCentre(1 / BUTTON_ZOOM));
    listen(fitAll, 'click', fit);
    listen(centreMe, 'click', toMe);

    listen(stage, 'keydown', event => {
        const step = { ArrowLeft: [1, 0], ArrowRight: [-1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[event.key];
        if (step) {
            stopAnimation();
            measure();
            setView(panBy(s.view, step[0] * s.size.width * KEY_PAN, step[1] * s.size.height * KEY_PAN, box, limits));
        } else if (event.key === '+' || event.key === '=') zoomCentre(BUTTON_ZOOM);
        else if (event.key === '-' || event.key === '_') zoomCentre(1 / BUTTON_ZOOM);
        else if (event.key === '0' || event.key === 'Home') fit();
        else if (event.key === 'Escape' && s.picked) showDetails('');
        else return;
        event.preventDefault?.();
    });

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
            if (moved > DRAG_THRESHOLD) setView(panBy(s.view, now.x - before.x, now.y - before.y, box, limits));
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
        let next = oldDistance > 0 && newDistance > 0 ? zoomAt(s.view, newDistance / oldDistance, oldMid.x, oldMid.y, s.size.width, s.size.height, box, limits) : s.view;
        next = panBy(next, newMid.x - oldMid.x, newMid.y - oldMid.y, box, limits);
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
        setView(zoomAt(s.view, Math.exp(-(Number(delta) || 0) * WHEEL_RATE), at.x, at.y, s.size.width, s.size.height, box, limits));
    }, { passive: false });

    // A click elsewhere closes the results list.
    if (typeof doc.addEventListener === 'function') {
        listen(doc, 'click', event => {
            if (!results.hidden && !searchBox.contains?.(event.target)) results.hidden = true;
        });
    }

    const Observer = win?.ResizeObserver ?? globalThis.ResizeObserver;
    let observer = null;
    if (typeof Observer === 'function') {
        observer = new Observer(() => {
            const before = s.size;
            measure();
            if (before.width === s.size.width && before.height === s.size.height) return;
            const zoom = zoomLevel(s.view, s.fitK);
            s.fitK = fitNow().k;
            limits = zoomLimits(s.fitK, nearestGap(s.shown.map(place => s.points.get(place.id))));
            s.view = clampView({ ...s.view, k: zoom * s.fitK }, box, limits);
            paint();
        });
        observer.observe(stage);
    }

    function load(next, first) {
        s.data = readView(next);
        s.trip = readTrip(next?.trip ?? next?.value?.trip);
        // The map opens on the layer of the place {{user}} is at; with a trip on whose stages do not all lie there (the road runs on into
        // another region), it opens on All, where the whole route can be seen.
        if (first && s.trip?.on && s.data.layer !== ALL) {
            const here = new Set(s.data.places.filter(place => onLayer(place, s.data.layer)).map(place => place.id));
            if (!s.trip.legs.every(leg => here.has(leg.fromId) && here.has(leg.toId))) s.data.layer = ALL;
        }
        viewKey = text(next?.viewKey) || 'map';
        onSelect = text(next?.onSelect);
        root.setAttribute('aria-label', text(next?.label) || 'Map');
        // "Centre on where you are" works once a place is known (breaker a3-2): until then it is off and says why.
        centreMe.disabled = !s.data.current;
        centreMe.setAttribute('title', s.data.current ? 'Centre on where you are' : 'Centre on where you are (once the story names where you are)');
        computePoints();
        const keep = !first && (s.layer === ALL || s.data.layers.some(item => item.id === s.layer));
        if (keep) {
            // A state update keeps the reader's layer, pan and zoom.
            const zoom = zoomLevel(s.view, s.fitK);
            const centre = { cx: s.view.cx, cy: s.view.cy };
            setLayer(s.layer, { refit: true });
            s.view = clampView({ ...centre, k: zoom * s.fitK }, box, limits);
            paint();
        } else {
            setLayer(s.data.layer);
            // The first time the map is drawn with a trip on, it shows the trip: the view fitted to the stops the trip runs through.
            if (s.trip?.on && !views.has(`${viewKey}|${s.layer}`)) fitTrip();
        }
        drawRoad();
        if (s.picked && !byId(s.picked)) showDetails('');
        else if (s.picked) showDetails(s.picked);
        if (input.value) runSearch();
    }

    measure();
    load(props, true);
    return {
        update: next => load(next, false),
        destroy() {
            stopAnimation();
            observer?.disconnect?.();
            for (const [node, type, fn, options] of listeners) node.removeEventListener(type, fn, options);
            listeners.length = 0;
            root.remove();
        },
        // For tests and the preview: the view as the widget holds it.
        get state() {
            return { layer: s.layer, view: { ...s.view }, fitK: s.fitK, limits: { ...limits }, picked: s.picked, size: { ...s.size } };
        },
    };
}

/** Prop problems (wrong types only, as Story Block's widgets report them). */
function validate(props = {}) {
    const problems = [];
    for (const name of ['onSelect', 'label', 'viewKey']) if (props[name] !== undefined && typeof props[name] !== 'string') problems.push(`${name} must be text.`);
    if (props.value !== undefined && (props.value === null || typeof props.value !== 'object')) problems.push('value must be the atlas.view data.');
    return problems;
}

/** The widget definition the module registers (module.js merges every part's `widgets`). */
export const atlasMapWidget = Object.freeze({
    props: Object.freeze({
        places: Object.freeze({ type: 'array', default: Object.freeze([]) }),
        routes: Object.freeze({ type: 'array', default: Object.freeze([]) }),
        layers: Object.freeze({ type: 'array', default: Object.freeze([]) }),
        layer: Object.freeze({ type: 'string', default: '' }),
        current: Object.freeze({ type: 'string', default: '' }),
        kinds: Object.freeze({ type: 'object', default: null }),
        orient: Object.freeze({ type: 'object', default: null }),
        trip: Object.freeze({ type: 'object', default: null }),
        onSelect: Object.freeze({ type: 'string', default: '' }),
        label: Object.freeze({ type: 'string', default: 'Map' }),
        viewKey: Object.freeze({ type: 'string', default: 'map' }),
    }),
    primary: 'places',
    validate,
    render,
});
