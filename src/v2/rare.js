// Story Director v2: which rare kinds the story uses (pure). The lean diet (3 Nov): the grammar of the world and faction
// lines, of the landmark and route lines and of the trip line is taught only while the story has some of them, so a quiet
// story does not pay for kinds it never writes. What the story "uses":
//   chronicle: a world event or a faction is kept (written by the story, set by the reader, or made by a pack's event);
//   routes:    a route is kept, or an enabled pack gives one (the trip line plans a trip by the known routes);
//   map:       routes, or a landmark the story named (a place of kind `landmark`), or any place the story made (`place.made`:
//              `+ landmark Old Weir | kind: ruin` is a place of kind ruin).
// Everything is read from the state and Story Block's `packs.content` query when that is there; nothing is written.

import { packWorld } from './atlas/world.js';

const filled = value => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0;

/** `{ chronicle, map, routes }` (booleans) from a view (`state`, `query`). */
export function rareKindsUsed(view) {
    const domains = view?.state?.domains ?? {};
    const chronicle = filled(domains.chronicle?.events) || filled(domains.chronicle?.factions);
    const atlas = domains.atlas ?? {};
    let routes = filled(atlas.routes);
    const landmark = Object.values(atlas.places ?? {}).some(place => place?.kind === 'landmark' || Boolean(place?.made));
    if (!routes && typeof view?.query === 'function') {
        try { routes = packWorld(view.query).routes.length > 0; } catch { routes = false; }
    }
    return { chronicle, map: routes || landmark, routes };
}
