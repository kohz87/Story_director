// Story Director v2, atlas part: the drawing of the Map widget (widget.js `render`).
//
// `createDraw(s, dom)` returns the functions that put the widget's state on the page: the Region list (drawLayers), the routes, places and
// labels of the layer (drawShown, with the trip's marks and the legend), the "On the road" panel (drawRoad), and everything that follows
// the view (paint, cheap enough for every pointer move). `s` is render's state object (data, layer, shown, lines, trip, marks, points, size,
// view, fitK, picked, hovered; render reassigns them, so they are read and written as properties of it); `dom` holds the nodes and the maps
// of nodes that render built and the drawing fills. The bodies are the ones that were closures inside render, unchanged.

import { KNOWN_ICON_ZOOM, KNOWN_LABEL_ZOOM, clipSegment, placeLabels, toScreen, zoomLevel } from './view.js';
import { ALL, button, fmt, h, humanize, icon, px, text } from './widget-view.js';

export const SVG_NS = 'http://www.w3.org/2000/svg';
const R_VISITED = 12;
const R_KNOWN_FAR = 4;
const R_KNOWN = 9;

export function createDraw(s, dom) {
    const { doc, regions, regionBox, worldGroup, nodes, labels, placesLayer, labelsLayer, empty, stage, markLayer, road, legend, legendCard, placeAt, hereRing } = dom;

    function drawLayers() {
        const options = [{ id: ALL, name: 'All' }, ...s.data.layers].map(item => {
            const option = h(doc, 'option', '', item.name);
            option.setAttribute('value', item.id || 'all');
            if (item.id === s.layer) option.setAttribute('selected', '');
            option.selected = item.id === s.layer;
            return option;
        });
        regions.replaceChildren(...options);
        regions.value = s.layer || 'all';
        regionBox.hidden = s.data.layers.length === 0;
    }

    function drawShown() {
        const ids = new Set(s.shown.map(place => place.id));
        s.lines = s.data.routes.filter(route => ids.has(route.from) && ids.has(route.to)).map(route => {
            const line = doc.createElementNS(SVG_NS, 'line');
            line.setAttribute('class', 'sd-map-route');
            line.setAttribute('data-from', route.from);
            line.setAttribute('data-to', route.to);
            line.setAttribute('data-known', String(route.known));
            if (route.kind) line.setAttribute('data-kind', route.kind.slice(0, 64));
            return { line, route };
        });
        // The trip's legs over the known routes (both ends on this layer), thick and in the accent.
        for (const leg of s.trip?.legs ?? []) {
            if (!ids.has(leg.fromId) || !ids.has(leg.toId) || leg.fromId === leg.toId) continue;
            const line = doc.createElementNS(SVG_NS, 'line');
            line.setAttribute('class', 'sd-map-trip-leg');
            line.setAttribute('data-from', leg.fromId);
            line.setAttribute('data-to', leg.toId);
            line.setAttribute('data-state', leg.state);
            s.lines.push({ line, route: { from: leg.fromId, to: leg.toId } });
        }
        worldGroup.replaceChildren(...s.lines.map(entry => entry.line));
        drawMarks(ids);

        nodes.clear();
        labels.clear();
        const items = s.shown.map(place => {
            const node = button(doc, 'sd-map-place');
            // the dot draws its own tap area: Story Block's phone rule (44px controls) leaves it its size
            node.setAttribute('data-ss-hit', '');
            node.setAttribute('data-id', place.id);
            node.setAttribute('data-visited', String(place.visited));
            if (place.kind) node.setAttribute('data-kind', place.kind.slice(0, 64));
            const about = [place.kind && humanize(place.kind), place.region, place.visited ? '' : 'not visited', place.id === s.data.current ? 'you are here' : ''].filter(Boolean).join(', ');
            node.setAttribute('aria-label', about ? `${place.name} (${about})` : place.name);
            node.setAttribute('title', place.name);
            if (place.id === s.data.current) node.setAttribute('aria-current', 'location');
            node.append(icon(doc, place.icon));
            nodes.set(place.id, node);
            const label = h(doc, 'span', 'sd-map-label', place.name);
            label.setAttribute('data-id', place.id);
            label.setAttribute('data-visited', String(place.visited));
            label.hidden = true;
            labels.set(place.id, label);
            return node;
        });
        placesLayer.replaceChildren(...items);
        labelsLayer.replaceChildren(...labels.values());
        empty.hidden = s.shown.length > 0;
        stage.hidden = s.shown.length === 0;
        drawLegend();
    }

    // "You" and the movers: a mark and a pin each, where both ends of their leg are on this layer.
    function drawMarks(ids) {
        s.marks = [];
        const nodesOut = [];
        const add = (kind, ids2, t, label, title) => {
            if (!ids2.every(id => ids.has(id) && s.points.get(id))) return;
            const mark = h(doc, 'span', `sd-map-${kind}`);
            mark.setAttribute('data-kind', kind);
            const pin = h(doc, 'span', `sd-map-pin sd-map-pin-${kind}`, label);
            if (title) pin.setAttribute('title', title);
            nodesOut.push(mark, pin);
            s.marks.push({ mark, pin, ids: ids2, t });
        };
        if (s.trip?.you && s.trip.phase === 'road') {
            const along = s.trip.you.of ? `${s.trip.you.along ?? 0} of ${s.trip.you.of} km` : '';
            add('you', [s.trip.you.fromId, s.trip.you.toId], s.trip.you.t, `You${along ? ` · ${along}` : ''}`, 'Where you are on the road');
        }
        for (const mover of s.trip?.movers ?? []) add('mover', [mover.fromId, mover.toId], mover.t, `${mover.name}${mover.arrive ? ` · ${mover.arrive}` : ''}`, `${mover.name}: ${mover.from} → ${mover.to}${mover.arrive ? `, arrives ${mover.arrive}` : ''}`);
        markLayer.replaceChildren(...nodesOut);
    }

    // The "On the road" panel: the trip's stages (a progress bar on the current one) and the movers {{user}} knows of.
    function drawRoad() {
        road.hidden = !s.trip;
        if (!s.trip) {
            road.replaceChildren();
            return;
        }
        const parts = [h(doc, 'h4', '', 'On the road')];
        if (s.trip.on) {
            const first = s.trip.legs[0];
            parts.push(h(doc, 'p', 'sd-map-road-to', `${first?.from ?? ''} → ${s.trip.to}`));
            parts.push(h(doc, 'p', 'sd-map-road-by', s.trip.phase === 'arrived' ? `Arrived at ${s.trip.to}${s.trip.arrive ? `, ${s.trip.arrive}` : ''}` : [s.trip.pace, s.trip.setOut && `set out ${s.trip.setOut}`].filter(Boolean).join(' · ')));
            const list = h(doc, 'ol', 'sd-map-road-legs');
            for (const leg of s.trip.legs) {
                const item = h(doc, 'li');
                item.setAttribute('data-state', leg.state);
                item.append(h(doc, 'span', 'sd-map-road-name', `${leg.index} · ${leg.from} → ${leg.to}`), h(doc, 'span', 'sd-map-road-when', [leg.km !== null && `${leg.km} km`, leg.time, leg.arrive].filter(value => value !== null && value !== false && value !== '').join(' · ')));
                if (leg.state === 'now' && s.trip.you?.of) {
                    const pct = Math.round(Math.min(1, Math.max(0, (s.trip.you.along ?? 0) / s.trip.you.of)) * 100);
                    const bar = h(doc, 'div', 'sd-map-road-bar');
                    bar.setAttribute('role', 'progressbar');
                    bar.setAttribute('aria-label', `Stage ${leg.index}: ${s.trip.you.along ?? 0} of ${s.trip.you.of} km`);
                    bar.setAttribute('aria-valuemin', '0');
                    bar.setAttribute('aria-valuemax', '100');
                    bar.setAttribute('aria-valuenow', String(pct));
                    const fill = h(doc, 'span');
                    fill.style.width = `${pct}%`;
                    bar.append(fill);
                    item.append(bar);
                }
                list.append(item);
            }
            parts.push(list);
            for (const delay of s.trip.delays) parts.push(h(doc, 'p', 'sd-map-road-note', `Delayed ${delay}`));
        }
        if (s.trip.movers.length) {
            parts.push(h(doc, 'h5', '', 'Moving that you know of'));
            const list = h(doc, 'ul', 'sd-map-road-movers');
            for (const mover of s.trip.movers) {
                const item = h(doc, 'li');
                item.setAttribute('data-kind', 'mover');
                item.append(h(doc, 'span', 'sd-map-road-name', `${mover.name}${mover.summary ? `: ${mover.summary}` : ''}`), h(doc, 'span', 'sd-map-road-when', [`${mover.from} → ${mover.to}`, mover.arrive && `arrive ${mover.arrive}`].filter(Boolean).join(' · ')));
                list.append(item);
            }
            parts.push(list);
        }
        road.replaceChildren(...parts);
    }

    function drawLegend() {
        const entries = [];
        // A legend row is a list-card row: the sample, then its words.
        const entry = (sample, words) => {
            const li = h(doc, 'li', 'ss-listcard-row');
            const item = h(doc, 'div', 'ss-listcard-item');
            const main = h(doc, 'span', 'ss-listcard-main');
            main.append(h(doc, 'span', 'ss-listcard-title', words));
            item.append(sample, main);
            li.append(item);
            entries.push(li);
        };
        const kinds = [];
        for (const place of s.shown) if (place.kind && !kinds.includes(place.kind)) kinds.push(place.kind);
        for (const kind of kinds.slice(0, 12)) {
            const sample = h(doc, 'span', 'sd-map-sample');
            sample.append(icon(doc, text(s.data.kinds[kind]?.icon) || s.shown.find(place => place.kind === kind)?.icon));
            entry(sample, text(s.data.kinds[kind]?.label) || humanize(kind));
        }
        if (s.shown.some(place => !place.visited)) entry(h(doc, 'span', 'sd-map-sample sd-map-sample-known'), 'Not visited yet');
        if (s.shown.some(place => place.id === s.data.current)) entry(h(doc, 'span', 'sd-map-sample sd-map-sample-here'), 'You are here');
        if (s.lines.some(({ line }) => line.getAttribute('class') === 'sd-map-trip-leg')) entry(h(doc, 'span', 'sd-map-sample sd-map-sample-trip'), 'Your trip');
        if (s.marks.some(item => item.mark.getAttribute('data-kind') === 'mover')) entry(h(doc, 'span', 'sd-map-sample sd-map-sample-mover'), 'Moving that you know of');
        legend.replaceChildren(...entries);
        legendCard.hidden = entries.length === 0;
    }

    // Everything that follows the view: cheap enough for every pointer move.
    function paint() {
        const { width, height } = s.size;
        const frame = { x: -8, y: -8, w: width + 16, h: height + 16 };
        for (const { line, route } of s.lines) {
            const cut = clipSegment(toScreen(s.view, width, height, s.points.get(route.from)), toScreen(s.view, width, height, s.points.get(route.to)), frame);
            line.style.display = cut ? '' : 'none';
            if (!cut) continue;
            for (const [name, value] of [['x1', cut.a.x], ['y1', cut.a.y], ['x2', cut.b.x], ['y2', cut.b.y]]) line.setAttribute(name, fmt(value));
        }
        const zoom = zoomLevel(s.view, s.fitK);
        stage.setAttribute('data-zoom', String(Math.round(zoom * 100) / 100));
        const far = zoom < KNOWN_ICON_ZOOM;
        const markers = [];
        const at = placeAt;
        at.clear();
        for (const place of s.shown) {
            const node = nodes.get(place.id);
            const p = toScreen(s.view, width, height, s.points.get(place.id));
            at.set(place.id, p);
            node.style.left = px(p.x);
            node.style.top = px(p.y);
            const isFar = !place.visited && far && place.id !== s.picked && place.id !== s.hovered;
            node.classList.toggle('sd-map-far', isFar);
            node.classList.toggle('sd-map-picked', place.id === s.picked);
            const onScreen = p.x > -40 && p.y > -40 && p.x < width + 40 && p.y < height + 40;
            if (onScreen) markers.push({ id: place.id, x: p.x, y: p.y, r: place.visited ? R_VISITED : isFar ? R_KNOWN_FAR : R_KNOWN });
        }
        // Names by priority: the one under the pointer or focus, the picked one, where you are, the
        // visited places, then (closer in) the unvisited ones.
        const visible = new Set(markers.map(marker => marker.id));
        const rank = place => (place.id === s.hovered ? 0 : place.id === s.picked ? 1 : place.id === s.data.current ? 2 : place.visited ? 3 : 4);
        const items = s.shown
            .filter(place => visible.has(place.id) && (place.visited || zoom >= KNOWN_LABEL_ZOOM || place.id === s.hovered || place.id === s.picked))
            .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name) || (a.id < b.id ? -1 : 1))
            .map(place => ({ id: place.id, x: at.get(place.id).x, y: at.get(place.id).y, r: markers.find(marker => marker.id === place.id).r, text: place.name }));
        const placed = new Map(placeLabels(items, markers, width, height).map(entry => [entry.id, entry]));
        for (const [id, label] of labels) {
            const spot = placed.get(id);
            label.hidden = !spot;
            if (!spot) continue;
            if (label.textContent !== spot.text) label.textContent = spot.text;
            label.style.left = px(spot.x);
            label.style.top = px(spot.y);
            label.setAttribute('data-slot', spot.slot);
            label.classList.toggle('sd-map-picked', id === s.picked);
        }
        for (const item of s.marks) {
            const [a, b] = item.ids.map(id => toScreen(s.view, width, height, s.points.get(id)));
            const x = a.x + (b.x - a.x) * item.t;
            const y = a.y + (b.y - a.y) * item.t;
            for (const node of [item.mark, item.pin]) {
                node.style.left = px(x);
                node.style.top = px(y);
            }
            // A pin near the right edge goes to the left of its mark, so it is not cut off.
            item.pin.classList.toggle('sd-map-pin-left', x > width - 130);
        }
        const here = s.data.current && at.get(s.data.current);
        hereRing.hidden = !here;
        if (here) {
            hereRing.style.left = px(here.x);
            hereRing.style.top = px(here.y);
        }
    }

    return { drawLayers, drawShown, drawRoad, paint };
}
