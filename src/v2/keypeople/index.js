// Story Director v2, part **keypeople** (USER, 1 Nov): the people {{user}} follows. Story Director owns the list.
//
// * Feature `story-director.key-people` (on by default, no preset turns it off: Lean keeps it; not part of the World-building
//   threads feature). Off means fully off: no kind, line, command, query or screen, nothing in the prompt; what is stored stays.
// * State: the `keypeople` domain (domain.js): who is pinned, each pinned person's away record (what they do, since when, due
//   back when, the steps of their timeline), who was taken off the list and why. Replay-safe like every domain here.
// * Narrator: kinds `away` and `key` (capture.js): `+ away Ren — scouting the north road | back: <date>`, `! away Ren — reached
//   Wolfmere Outpost`, `- away Ren` (back), `- key Ren | died`. Only a pinned person may be away. The tail (note.js) tells one
//   line per away key person within the token budget; a back date that passes moves nobody ("due back").
// * Removal: a pinned person NPC State Delta has archived or lost (a death) leaves the list before the next reply, with the
//   reason (nsd.js, the hook below); the story's `- key Name | died` and the reader's Unpin do the same. Never written to NSD. NSD's
//   removal is stored on the reply before the one being written, but its card line goes on the reply that followed (`keypeople.tell`).
// * Reader: World → Now's Key people section (widget.js, the world part's screen) pins and unpins (cause `ui`).
// * Interface for other modules: the query `director.keyPeople` (queries.js). Settings: how many key people (10) and the
//   narrator budget for them (300 tokens, no upper limit).
// Works without NPC State Delta (a death is the story's line, or Unpin).

import { pin, sync, tell, unpin, applyAwayLine, applyKeyLine, capOf } from './capture.js';
import { DEFAULT_CAP, DEFAULT_TOKENS, FEATURE, MAX_CAP, initialKeyPeople, validateKeyPeople } from './domain.js';
import { GRAMMAR, STATIC_TEXT, keyPeopleOn, tail, tokensOf } from './note.js';
import { nsdVerdicts } from './nsd.js';
import { queries } from './queries.js';
import { KEY_PEOPLE_WIDGET, keyPeopleWidget } from './widget.js';

export { FEATURE, KEY_PEOPLE_WIDGET, capOf, tokensOf };

const tagged = fn => Object.assign(fn, { feature: FEATURE });

/** `beforeGenerate(view)`: one `keypeople.sync` step when NPC State Delta says a pinned person is archived or dead (or newly known). */
export function beforeGenerate(view) {
    if (!keyPeopleOn(view)) return undefined;
    const slice = view?.state?.domains?.keypeople;
    if (!slice || !Object.keys(slice.pins ?? {}).length) return undefined;
    const { released, known } = nsdVerdicts(slice, { query: typeof view.query === 'function' ? (name, args) => view.query(name, args) : null });
    if (!released.length && !known.length) return undefined;
    return { commands: [{ type: 'keypeople.sync', payload: { ...(released.length ? { who: released } : {}), ...(known.length ? { known } : {}) } }] };
}

/**
 * `afterCapture(view)`: one `keypeople.tell` step on the reply just read when NPC State Delta's removals of the step before it are not told
 * on a card yet. The removal itself was stored on the reply before (it ran before the reply was written, so the narrator is not told of
 * the person); its card line belongs to the reply that followed. A swipe, a Re-read or a delete of this reply takes the line back and
 * the next one says it again.
 */
export function afterCapture(view) {
    if (!keyPeopleOn(view)) return undefined;
    const gone = view?.state?.domains?.keypeople?.gone;
    const who = Object.entries(gone && typeof gone === 'object' ? gone : {}).filter(([, entry]) => entry?.owed === true).map(([key]) => key).slice(0, 24);
    return who.length ? { commands: [{ type: 'keypeople.tell', payload: { who } }] } : undefined;
}

/** The most the narrator is told of key people, in tokens, for a part's own settings: the module's budget follows it (module.js). */
const budgetOf = settings => tokensOf(settings);

export const part = {
    // No `presets`: Lean keeps it (the reader's own switch is the only one).
    features: [{
        id: FEATURE,
        label: 'Key people',
        describe: 'People you pin stay in the story while they are away: what they are doing, when they are due back and the news on the way, told to the narrator each reply. Their return or death takes them off the list. World → Now shows and edits the list.',
        default: true,
    }],
    domains: { keypeople: { initial: initialKeyPeople, validate: validateKeyPeople } },
    commands: {
        'keypeople.pin': tagged((ctx, payload) => pin(ctx, payload)),
        'keypeople.unpin': tagged((ctx, payload) => unpin(ctx, payload)),
        'keypeople.sync': tagged((ctx, payload) => sync(ctx, payload)),
        'keypeople.tell': tagged((ctx, payload) => tell(ctx, payload)),
    },
    queries,
    kinds: {
        // Taught only while someone is pinned (module.js tells the parts `keyPeople`).
        away: { grammar: env => (env?.keyPeople ? GRAMMAR.away : ''), apply: applyAwayLine, feature: FEATURE },
        key: { grammar: env => (env?.keyPeople ? GRAMMAR.key : ''), apply: applyKeyLine, feature: FEATURE },
    },
    context: {
        static: env => (env?.keyPeople ? STATIC_TEXT : ''),
        staticFeature: FEATURE,
        tail: view => tail(view),
        // The tokens the tail may spend: the setting (module.js follows it, so a larger budget is not cut by the module's).
        budget: DEFAULT_TOKENS,
        budgetOf,
    },
    hooks: { beforeGenerate: tagged(beforeGenerate), afterCapture: tagged(afterCapture) },
    settings: {
        section: 'Key people',
        defaults: { cap: DEFAULT_CAP, tokens: DEFAULT_TOKENS },
        schema: {
            cap: {
                type: 'int', label: 'How many key people', group: 'Key people', min: 0, max: MAX_CAP, feature: FEATURE,
                help: 'Pinned people whose off-screen story keeps going, in Lean too. Archiving a dossier or a death unpins them.',
            },
            tokens: {
                type: 'int', label: 'Narrator budget for key people (tokens)', group: 'Key people', min: 0, feature: FEATURE,
                help: 'No upper limit. When those away need more, the ones returning soonest or whose story just moved are told first. Story Suite\'s overall budget (Settings → Tabs & Packs) still caps everything sent each reply.',
            },
        },
    },
    tabs: [],
    widgets: { [KEY_PEOPLE_WIDGET]: keyPeopleWidget },
};
