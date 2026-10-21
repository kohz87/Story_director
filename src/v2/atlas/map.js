// Story Director v2, atlas part: the map as Story Block's `ss.map` widget draws it (pure).
//
// `mapProps(world, current)` gives exactly the widget's props (docs/v2/WIDGETS.md): nodes with an
// icon for their kind, edges for the routes, layers by plane or region, the scene's place as
// `current`, the places the story has reached as `discovered` (pack places it has not are under
// the fog), and a legend of the kinds on show. The screen adds `onSelect`, `fog` and `label`.

import { keyOf } from './domain.js';

// Font Awesome icons (SillyTavern ships Font Awesome) by the words a kind is written with.
const ICONS = Object.freeze([
    [/\b(?:city|capital)\b/, 'fa-city'],
    [/\b(?:town|village|hamlet|settlement|farm|homestead)\b/, 'fa-house'],
    [/\b(?:castle|fort|fortress|keep|citadel|bastion|stronghold|watch)\b/, 'fa-chess-rook'],
    [/\b(?:ruin|ruins)\b/, 'fa-landmark'],
    [/\b(?:dungeon|crypt|tomb|catacomb|lair)\b/, 'fa-dungeon'],
    [/\b(?:cave|cavern|mine|grotto)\b/, 'fa-mountain-sun'],
    [/\b(?:temple|shrine|church|chapel|monastery|abbey)\b/, 'fa-place-of-worship'],
    [/\b(?:inn|tavern|alehouse)\b/, 'fa-beer-mug-empty'],
    [/\b(?:port|harbou?r|dock|docks|wharf)\b/, 'fa-anchor'],
    [/\b(?:camp|encampment|outpost)\b/, 'fa-campground'],
    [/\b(?:tower|spire|lighthouse)\b/, 'fa-tower-observation'],
    [/\b(?:bridge|ford|crossing|weir)\b/, 'fa-bridge'],
    [/\b(?:forest|wood|woods|grove|wild|wilds)\b/, 'fa-tree'],
    [/\b(?:mountain|peak|pass|hill|hills|ridge)\b/, 'fa-mountain'],
    [/\b(?:lake|river|sea|coast|shore|marsh|swamp|spring)\b/, 'fa-water'],
    [/\b(?:market|shop|bazaar)\b/, 'fa-shop'],
    [/\b(?:landmark|monument|statue|stone|stones)\b/, 'fa-monument'],
]);
export const DEFAULT_ICON = 'fa-location-dot';

/** The icon for a place kind: a Font Awesome class name. */
export function iconFor(kind) {
    const word = String(kind ?? '').toLowerCase();
    return ICONS.find(([pattern]) => pattern.test(word))?.[1] ?? DEFAULT_ICON;
}

const label = word => word.charAt(0).toUpperCase() + word.slice(1);

/** The map layer a place is on: its plane, else its region, else none (shown on every layer). */
export const layerOf = place => place.layer || place.region || '';

/** `{ nodes, edges, layers, current, discovered, kinds }` for `ss.map`. */
export function mapProps(world, current = '') {
    const layers = [];
    const layerIds = new Map();
    const layerId = text => {
        const key = keyOf(text);
        if (!key) return '';
        if (!layerIds.has(key)) {
            layerIds.set(key, key);
            layers.push({ id: key, name: text });
        }
        return key;
    };
    const kinds = {};
    const nodes = world.places.map(place => {
        const node = { id: place.id, name: place.name, icon: iconFor(place.kind), layer: layerId(layerOf(place)), kind: place.kind };
        if (place.x !== null && place.y !== null) Object.assign(node, { x: place.x, y: place.y });
        if (place.kind && !kinds[place.kind]) kinds[place.kind] = { label: label(place.kind), icon: node.icon };
        return node;
    });
    const edges = world.routes.map(route => {
        if (route.kind && !kinds[route.kind]) kinds[route.kind] = { label: label(route.kind) };
        return { from: route.from, to: route.to, kind: route.kind };
    });
    const here = current ? world.find(current) : null;
    return {
        nodes,
        edges,
        layers: layers.sort((a, b) => a.id.localeCompare(b.id)),
        current: here?.id ?? '',
        discovered: world.places.filter(place => place.discovered).map(place => place.id),
        kinds,
    };
}
