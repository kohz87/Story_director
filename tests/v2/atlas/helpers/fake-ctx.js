// A fake command context (SPEC §3.2) and a change-line reader (SPEC §4.4) for the atlas part's
// tests. Commit works as Story Block's does in outline: the handler runs on drafts, the drafts
// are diffed into ops with Story Block's own ops.js (vendored), the generic op rules and the
// touched domains' validators run, and a throw or a problem keeps the state as it was.

import { part } from '../../../../src/v2/atlas/index.js';
import { apply, checkOps, diff } from '../../../vendor/story-block/src/v2/ops.js';

export function deepFreeze(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
        Object.freeze(value);
        for (const child of Object.values(value)) deepFreeze(child);
    }
    return value;
}

// sfc32, as SPEC §3.2 names it: the handler's only randomness.
function sfc32(seed) {
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

/** A state with the atlas and a scene. */
export function makeState({ place = '', kind = '', region = '' } = {}) {
    return deepFreeze({
        v: 2,
        meta: { rev: 0, claims: {} },
        domains: {
            atlas: part.domains.atlas.initial(),
            scene: { place: { name: place, kind, region }, present: [] },
        },
    });
}

/** The state with the scene somewhere else (Story Block's scene domain is not the atlas's to write). */
export function at(state, place, { kind = '', region = '' } = {}) {
    return deepFreeze({ ...state, domains: { ...state.domains, scene: { place: { name: place, kind, region }, present: [] } } });
}

export class Rejected extends Error {
    constructor(code, message) {
        super(message);
        this.code = code;
    }
}

/**
 * The queries a test host answers: the atlas's own, `scene.place`, and `packs.content` when a
 * `pack` `{ places, routes }` is given (else that query is missing, as without Story Block's packs).
 * `extra`: other hosts' queries `{ name: (state, args) => answer }` (a test's stand-in for another module).
 */
export function queryFor(pack = null, extra = {}) {
    const run = (state, name, args) => {
        if (Object.hasOwn(extra, name)) return structuredClone(extra[name](state, args));
        if (name === 'scene.place') return { ...state.domains.scene.place };
        if (name === 'packs.content') {
            if (!pack) throw new Rejected('NOT_FOUND', 'There is no query called "packs.content".');
            return structuredClone(pack[args?.kind] ?? []);
        }
        const fn = part.queries[name];
        if (!fn) throw new Rejected('NOT_FOUND', `There is no query called "${name}".`);
        return structuredClone(fn(state, structuredClone(args), { query: (other, otherArgs) => run(state, other, otherArgs) }));
    };
    return run;
}

/** A query against `state`, as Story Block's runQuery calls it (with `tools.query`). */
export function query(state, name, args, { pack = null, extra = {} } = {}) {
    return queryFor(pack, extra)(state, name, args);
}

/**
 * Runs `handler(ctx, payload)` as a command on `state`: `{ ok, state, result, ops }`, or
 * `{ ok: false, code, message, state }` with the state untouched.
 */
export function runCommand(state, handler, payload, { settings = {}, seed = 7, pack = null, owned = ['atlas'], cause = 'ui', caller = null, time = null, extra = {} } = {}) {
    const rev = state.meta.rev + 1;
    const drafts = {};
    const random = sfc32(seed);
    const current = () => ({ ...state, domains: { ...state.domains, ...drafts } });
    const ask = queryFor(pack, extra);
    const ctx = {
        rev,
        cause,
        caller,
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
        roll: () => ({ total: 0, dice: [] }),
        settings: () => structuredClone(settings),
        time: () => time,
        fail: (code, message) => { throw new Rejected(code, message); },
        query: (name, args) => deepFreeze(ask(current(), name, args)),
    };
    let result;
    try {
        result = handler(ctx, deepFreeze(structuredClone(payload)));
    } catch (error) {
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

/** One change line read as SPEC §4.4 says: `op kind Name[ — text][ | label: value]*`. */
export function readLine(raw, index = 0) {
    const match = String(raw).trim().match(/^([+\-~!?])\s+(\S+)\s+(.*)$/s);
    if (!match) throw new Error(`not a change line: ${raw}`);
    const [head, ...rest] = match[3].split(/\s*\|\s*/);
    const dash = head.match(/\s+[—–]\s+|\s+-\s+/);
    const name = (dash ? head.slice(0, dash.index) : head).trim();
    const text = dash ? head.slice(dash.index + dash[0].length).trim() : '';
    const labels = {};
    for (const piece of rest) {
        const colon = piece.indexOf(':');
        if (colon > 0) labels[piece.slice(0, colon).trim().toLowerCase()] = piece.slice(colon + 1).trim();
    }
    return { op: match[1], kind: match[2].toLowerCase(), name, text, labels, raw: String(raw).trim(), index };
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

/** Runs a command by type. */
export function command(state, type, payload, options = {}) {
    return runCommand(state, part.commands[type], payload, options);
}

/** Rebuilds a state from `initial` by replaying every run's ops (SPEC §2.2). */
export function replay(initial, runs) {
    return runs.reduce((state, run) => apply(state, run.ops), initial);
}

/** The atlas place a name or alias means. */
export function placeNamed(state, name) {
    const atlas = state.domains.atlas;
    const id = atlas.keys[name.toLowerCase()];
    return id ? atlas.places[id] : null;
}
