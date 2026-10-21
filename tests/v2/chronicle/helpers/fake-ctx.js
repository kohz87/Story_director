// A fake command context (SPEC §3.2) for the chronicle part's tests. Commit works as Story Block's
// does in outline: the handler runs on drafts, the drafts are diffed into ops with Story Block's
// own ops.js (vendored in tests/vendor/story-block), the generic op rules and the chronicle's
// validator run, and a throw or a problem keeps the state as it was. Change lines are read by
// Story Block's own parser (capture.js parseChanges).

import { part } from '../../../../src/v2/chronicle/index.js';
import { apply, checkOps, diff } from '../../../vendor/story-block/src/v2/ops.js';
import { parseChanges } from '../../../vendor/story-block/src/v2/capture.js';

export function deepFreeze(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
        Object.freeze(value);
        for (const child of Object.values(value)) deepFreeze(child);
    }
    return value;
}

// sfc32, as SPEC §3.2 names it: the handler's only randomness.
export function sfc32(seed) {
    let a = 0x9e3779b9;
    let b = 0x243f6a88;
    let c = 0xb7e15162;
    let d = seed >>> 0;
    return () => {
        a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
        const t = (a + b | 0) + d | 0;
        d = d + 1 | 0;
        a = b ^ b >>> 9;
        b = c + (c << 3) | 0;
        c = c << 21 | c >>> 11;
        c = c + t | 0;
        return (t >>> 0) / 4294967296;
    };
}

/** A state with the chronicle, a story clock (`minutes`, null: not set) and a scene. */
export function makeState({ minutes = null, place = '' } = {}) {
    return deepFreeze({
        v: 2,
        meta: { rev: 0, claims: {} },
        domains: {
            chronicle: part.domains.chronicle.initial(),
            director: { time: { minutes } },
            scene: { place: { name: place, kind: '', region: '' }, present: [] },
        },
    });
}

/** The state with the clock at `minutes` (the tracker's domain, not the chronicle's to write). */
export function clockAt(state, minutes) {
    return deepFreeze({ ...state, domains: { ...state.domains, director: { time: { minutes } } } });
}

/** The state with the scene somewhere else. */
export function sceneAt(state, place) {
    return deepFreeze({ ...state, domains: { ...state.domains, scene: { place: { name: place, kind: '', region: '' }, present: [] } } });
}

export class Rejected extends Error {
    constructor(code, message) {
        super(message);
        this.code = code;
    }
}

/**
 * The queries a test host answers: the chronicle's own, `director.time`, `scene.place`, and the
 * atlas's `atlas.routes` / `atlas.place` from `atlas` `{ routes: { place: [names] }, regions: { place: region } }`
 * when given (else those are missing, as without the atlas part).
 */
export function queryFor({ atlas = null } = {}) {
    const run = (state, name, args = {}) => {
        if (name === 'director.time') return { minutes: state.domains.director?.time?.minutes ?? null, text: '' };
        if (name === 'scene.place') return { ...state.domains.scene.place };
        if (name === 'atlas.routes' || name === 'atlas.place') {
            if (!atlas) throw new Rejected('NOT_FOUND', `There is no query called "${name}".`);
            if (name === 'atlas.routes') return (atlas.routes?.[args.place] ?? []).map(otherName => ({ otherName }));
            return Object.hasOwn(atlas.regions ?? {}, args.name) ? { name: args.name, region: atlas.regions[args.name] } : null;
        }
        const fn = part.queries[name];
        if (!fn) throw new Rejected('NOT_FOUND', `There is no query called "${name}".`);
        return structuredClone(fn(state, structuredClone(args), { query: (other, otherArgs) => run(state, other, otherArgs) }));
    };
    return run;
}

/** A query against `state`, as Story Block's runQuery calls it (with `tools.query`). */
export function query(state, name, args, options = {}) {
    return queryFor(options)(state, name, args);
}

/**
 * Runs `handler(ctx, payload)` as a command on `state`: `{ ok, state, result, ops }`, or
 * `{ ok: false, code, message, state }` with the state untouched. `time`: what `ctx.time()`
 * answers (a function of the state; default: none, so the clock is read through `director.time`).
 */
export function runCommand(state, handler, payload, { seed = 7, cause = 'story', atlas = null, time = undefined, owned = ['chronicle'] } = {}) {
    const rev = state.meta.rev + 1;
    const drafts = {};
    const random = sfc32(seed);
    const current = () => ({ ...state, domains: { ...state.domains, ...drafts } });
    const ask = queryFor({ atlas });
    const ctx = {
        rev,
        cause,
        receiptId: `rc_test${String(rev).padStart(4, '0')}`,
        read: domain => deepFreeze(structuredClone(drafts[domain] ?? state.domains[domain])),
        draft: domain => {
            if (!owned.includes(domain)) throw new Rejected('NOT_OWNER', `This module does not own ${domain}.`);
            drafts[domain] ??= structuredClone(state.domains[domain]);
            return drafts[domain];
        },
        call: type => { throw new Rejected('UNKNOWN_COMMAND', `No command ${type} in this test.`); },
        claim: () => true,
        rng: random,
        fail: (code, message) => { throw new Rejected(code, message); },
        query: (name, args) => deepFreeze(ask(current(), name, args)),
    };
    if (time !== undefined) ctx.time = () => time(current());
    let result;
    try {
        result = handler(ctx, deepFreeze(structuredClone(payload)));
    } catch (error) {
        if (!(error instanceof Rejected)) throw error;
        return { ok: false, code: error.code ?? 'FAILED', message: error.message, state };
    }
    for (const [domain, draft] of Object.entries(drafts)) {
        const errors = part.domains[domain]?.validate(draft, state) ?? [];
        if (errors.length) return { ok: false, code: 'INVALID', message: errors.join(' '), state };
    }
    const next = { ...state, meta: { rev, claims: state.meta.claims }, domains: { ...state.domains, ...structuredClone(drafts) } };
    const ops = diff(state, next);
    const problems = checkOps(ops, state);
    if (problems.length) return { ok: false, code: 'INVALID', message: problems.join(' '), state };
    return { ok: true, state: deepFreeze(next), result, ops };
}

/** One change line, read by Story Block's parser. */
export function readLine(raw) {
    const { lines, problems } = parseChanges(raw);
    if (problems.length || lines.length !== 1) throw new Error(`not one change line: ${raw} (${problems.join(' ')})`);
    return lines[0];
}

/** Runs one change line as its kind's story command. */
export function line(state, raw, options = {}) {
    const parsed = readLine(raw);
    const kind = part.kinds[parsed.kind];
    if (!kind) throw new Error(`unknown kind ${parsed.kind}`);
    return runCommand(state, kind.apply, parsed, options);
}

/** Lines in order, each its own story command; throws on a rejected line. Returns the state and every run. */
export function lines(state, block, options = {}) {
    const runs = [];
    for (const raw of String(block).split('\n').map(text => text.trim()).filter(Boolean)) {
        const run = line(state, raw, { seed: 7 + runs.length, ...options });
        if (!run.ok) throw new Error(`${raw}: ${run.code} ${run.message}`);
        runs.push(run);
        state = run.state;
    }
    return { state, runs };
}

/** Runs a command by type (cause `ui` unless given). */
export function command(state, type, payload, options = {}) {
    return runCommand(state, part.commands[type], payload, { cause: 'ui', ...options });
}

/** Rebuilds a state from `initial` by replaying every run's ops (SPEC §2.2). */
export function replay(initial, runs) {
    return runs.reduce((state, run) => apply(state, run.ops), initial);
}

/** The event a name means, or undefined. */
export const eventNamed = (state, name) => Object.values(state.domains.chronicle.events).find(event => event.name === name);
export const factionNamed = (state, name) => Object.values(state.domains.chronicle.factions).find(faction => faction.name === name);

/** The view a tail or hook sees. */
export function viewOf(state, { at = 10, atlas = null } = {}) {
    const ask = queryFor({ atlas });
    return { state, query: (name, args) => ask(state, name, args), settings: () => ({}), chat: { length: at, lastUser: '' } };
}
