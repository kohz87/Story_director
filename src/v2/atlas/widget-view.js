// Story Director v2, atlas part: the Map widget's prop readers and small helpers.
//
// `readView` and `readTrip` clean the widget's props, `onLayer` and `layerFor` say which layer a place is on,
// and the value and DOM helpers (`text`, `num`, `px`, `fmt`, `humanize`, `h`, `button`, `icon`) are what widget.js
// draws with. Split out of widget.js; widget.js still exports `readView`, `readTrip` and `onLayer`.

export const ALL = '';

export function h(doc, tag, cls = '', text = '') {
    const node = doc.createElement(tag);
    if (cls) node.className = cls;
    if (text) node.textContent = text;
    return node;
}

export function button(doc, cls, text, title) {
    const node = h(doc, 'button', cls, text);
    node.setAttribute('type', 'button');
    if (title) {
        node.setAttribute('title', title);
        node.setAttribute('aria-label', title);
    }
    return node;
}

const FA = /^fa(?:-[a-z0-9]+)+$/;
export function icon(doc, name) {
    const node = h(doc, 'i', `fa-solid ${FA.test(String(name)) ? name : 'fa-location-dot'}`);
    node.setAttribute('aria-hidden', 'true');
    return node;
}

export const text = value => (typeof value === 'string' ? value : '');
const num = value => (typeof value === 'number' && Number.isFinite(value) ? value : null);
export const px = value => `${Math.round(value * 10) / 10}px`;
export const fmt = value => String(Math.round(value * 100) / 100);
export const humanize = word => (word ? word.charAt(0).toUpperCase() + word.slice(1) : '');

/** The widget's data from its props (a bound `atlas.view` arrives as `props.value`), cleaned. */
export function readView(props) {
    const given = props?.value && typeof props.value === 'object' && !Array.isArray(props.value) ? props.value : props ?? {};
    const seen = new Set();
    const places = [];
    for (const place of Array.isArray(given.places) ? given.places : []) {
        const id = text(place?.id);
        if (!id || seen.has(id)) continue;
        seen.add(id);
        places.push({
            id, name: text(place.name) || id, aliases: (Array.isArray(place.aliases) ? place.aliases : []).map(text).filter(Boolean),
            region: text(place.region), kind: text(place.kind), icon: text(place.icon), plane: text(place.plane), layer: text(place.layer),
            x: num(place.x), y: num(place.y), line: text(place.line) || text(place.name) || id, parent: text(place.parent), inside: Math.max(0, num(place.inside) ?? 0), visited: place.visited === true, here: place.here === true,
        });
    }
    const routes = (Array.isArray(given.routes) ? given.routes : [])
        .filter(route => seen.has(text(route?.from)) && seen.has(text(route?.to)) && route.from !== route.to)
        .map(route => ({ from: route.from, to: route.to, kind: text(route.kind), known: route.known === true }));
    const layers = (Array.isArray(given.layers) ? given.layers : [])
        .filter(layer => text(layer?.id) && places.some(place => place.layer === layer.id))
        .map(layer => ({ id: layer.id, name: text(layer.name) || layer.id, type: layer.type === 'plane' ? 'plane' : 'region' }));
    const current = seen.has(text(given.current)) ? given.current : '';
    const orient = { north: given.orient?.north === 'down' ? 'down' : 'up', east: given.orient?.east === 'left' ? 'left' : 'right' };
    const kinds = given.kinds && typeof given.kinds === 'object' ? given.kinds : {};
    const layer = layers.some(item => item.id === given.layer) ? given.layer : ALL;
    return { places, routes, layers, current, orient, kinds, layer, tidy: Math.max(0, num(given.tidy) ?? 0) };
}

/**
 * The trip prop (query `atlas.trip`), cleaned: `{ on, phase, to, pace, setOut, arrive, legs, you, movers, delays }`. A leg is `{ index, from, to,
 * km, time, arrive, state, along, fromId, toId }`; `you` `{ fromId, toId, t, along, of }` or null; a mover `{ id, name, summary, from, to, fromId,
 * toId, arrive, t }`. Nothing (no trip, no mover) reads as `null`.
 */
export function readTrip(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const share = value => Math.min(1, Math.max(0, num(value) ?? 0));
    const legs = (Array.isArray(raw.legs) ? raw.legs : []).filter(leg => leg && typeof leg === 'object').slice(0, 64).map((leg, i) => ({
        index: num(leg.index) ?? i + 1, from: text(leg.from), to: text(leg.to), km: num(leg.km), time: text(leg.time), arrive: text(leg.arrive),
        state: ['done', 'now', 'next'].includes(leg.state) ? leg.state : 'next', along: num(leg.along), fromId: text(leg.fromId), toId: text(leg.toId),
    }));
    const movers = (Array.isArray(raw.movers) ? raw.movers : []).filter(item => item && typeof item === 'object' && text(item.fromId) && text(item.toId)).slice(0, 12).map(item => ({
        id: text(item.id), name: text(item.name), summary: text(item.summary), from: text(item.from), to: text(item.to), fromId: text(item.fromId), toId: text(item.toId),
        arrive: text(item.arrive), t: share(item.t),
    }));
    const you = raw.you && typeof raw.you === 'object' && text(raw.you.fromId) && text(raw.you.toId)
        ? { fromId: text(raw.you.fromId), toId: text(raw.you.toId), t: share(raw.you.t), along: num(raw.you.along), of: num(raw.you.of) } : null;
    const on = raw.on === true && legs.length > 0;
    if (!on && !movers.length) return null;
    return {
        on, phase: raw.phase === 'arrived' ? 'arrived' : 'road', to: text(raw.to), pace: text(raw.pace), setOut: text(raw.setOut), arrive: text(raw.arrive),
        legs: on ? legs : [], you: on ? you : null, movers,
        delays: (Array.isArray(raw.delays) ? raw.delays : []).map(item => text(item?.text)).filter(Boolean).slice(0, 8),
    };
}

/** Whether a place shows on a layer: "All" shows every place off the planes; a layer its own places. */
export const onLayer = (place, layer) => (layer === ALL ? !place.plane : place.layer === layer);

/** The layer a place is found on: its own when it has one and the reader is not on "All", else "All". */
export const layerFor = (place, layer) => (place.plane ? place.layer : layer === ALL || !place.layer ? ALL : place.layer);
