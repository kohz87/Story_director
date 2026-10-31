// Story Director v2, part **atlas**: the `atlas` domain (places, routes, the names they go by),
// the `route` and `landmark` change lines, the places the story visits, the reader's
// corrections, travel times by v1's maths, the map as Story Block's `ss.map` widget draws it,
// the atlas's own Map widget `story-director.map` (pan, zoom, search, details) and the Map screen. The coordinator's src/v2/module.js merges this part with the others into
// module `story-director`. The enabled packs' places and routes (Story Block's optional query
// `packs.content`) are read live and joined in; without them the atlas is the story's alone. It also answers for other modules (policy.js,
// canonical.js): the canonical place, regions, danger and `world.areaTier` (docs/dev/checks-and-danger.md).

import { applyLandmarkLine, applyRouteLine, edit, focus, visit } from './capture.js';
import { initialAtlas, validateAtlas } from './domain.js';
import { GRAMMAR, STATIC_TEXT, TAIL_BUDGET, TRIP_TAIL_BUDGET, atlasTail, tripTail } from './note.js';
import { beforeGenerate, queries as atlasQueries } from './queries.js';
import { commands as policyCommands, queries as policyQueries } from './policy.js';
import { mapScreen } from './screen.js';
import { TRIP_FEATURE } from './trip.js';
import { applyTripLine } from './trip-capture.js';
import { tripQuery } from './trip-query.js';
import { MAP_WIDGET, atlasMapWidget } from './widget.js';
import { DEFAULT_MAP } from '../../places.js';

/** The atlas's optional mechanics (MODULES §F100): trips and the map's road. */
export const features = Object.freeze([
    Object.freeze({
        id: TRIP_FEATURE,
        label: 'Trips',
        describe: 'The story sets out with ~ trip: code plans the way along the known routes, tells the narrator where the party is on the road, and the Map draws it.',
        default: true,
    }),
]);

export const part = {
    features,
    domains: {
        // `trips` is per-reply bookkeeping (SPEC §2.2 scratch): a record per line, made and removed by later replies without touching another's.
        atlas: { initial: initialAtlas, validate: validateAtlas, scratch: ['trips'] },
    },
    commands: {
        'atlas.visit': visit,
        'atlas.edit': edit,
        'atlas.focus': focus,
        ...policyCommands,
    },
    queries: { ...atlasQueries, ...policyQueries, 'atlas.trip': Object.assign((state, args, tools) => tripQuery(state, args, tools), { feature: TRIP_FEATURE }) },
    kinds: {
        route: { grammar: GRAMMAR.route, apply: applyRouteLine },
        landmark: { grammar: GRAMMAR.landmark, apply: applyLandmarkLine },
        trip: { grammar: GRAMMAR.trip, apply: applyTripLine, feature: TRIP_FEATURE },
    },
    context: {
        static: () => STATIC_TEXT,
        tail: view => atlasTail(view),
        budget: TAIL_BUDGET + TRIP_TAIL_BUDGET,
        parts: [{ feature: TRIP_FEATURE, tail: tripTail }],
    },
    hooks: { beforeGenerate },
    settings: {
        section: 'Map',
        // v1's map settings: how to read coordinates and how much roads wind (places.js mapSettings).
        defaults: { map: { north: DEFAULT_MAP.north, east: DEFAULT_MAP.east, kmPerUnit: String(DEFAULT_MAP.kmPerUnit), roadFactor: String(DEFAULT_MAP.roadFactor), era: DEFAULT_MAP.era } },
        schema: {
            map: {
                type: 'group',
                label: 'Map',
                fields: {
                    north: { type: 'choice', label: 'North is', choices: ['up', 'down'] },
                    east: { type: 'choice', label: 'East is', choices: ['right', 'left'] },
                    kmPerUnit: { type: 'text', label: 'Km per map unit' },
                    roadFactor: { type: 'text', label: 'Roads wind (× the straight line)' },
                    era: { type: 'choice', label: 'Travel', choices: ['pre-modern', 'modern'] },
                },
            },
        },
    },
    tabs: [],
    screens: [mapScreen],
    widgets: { [MAP_WIDGET]: atlasMapWidget },
};
