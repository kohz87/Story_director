// A fake Story Block for the time part's tests (SPEC §3.2 ctx plus query and `rev`, MODULES §A).
// Commit works as Story Block's does in outline: the handler runs on drafts, the director is
// validated with the tracker part's validator, and a throw or a validation error keeps the state
// as it was. The story's own lines go through the tracker part's kinds, so threads have the
// shape the real module gives them. `Chat` keeps the state per carrier, so a swipe or a delete
// takes back what was written to that reply, as the store does.

import { part as tracker } from '../../../../src/v2/tracker/index.js';
import { part as time } from '../../../../src/v2/time/index.js';

function deepFreeze(value) {
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

/** A custom calendar of three 30-day months (v1's tests' world). */
export const CALENDAR = Object.freeze({ preset: 'custom', months: ['Haywane', 'Goldwane', 'Reapwane'].map(name => ({ name, days: 30 })) });
/** The settings both parts read here: the reader's calendar and this part's defaults. */
export const SETTINGS = Object.freeze({ calendar: CALENDAR, recapHours: 6, lapses: true });

export class Rejected extends Error {
    constructor(code, message) {
        super(message);
        this.code = code;
    }
}

/** A state with the director domain and a scene. */
export function makeState() {
    return deepFreeze({
        v: 2,
        meta: { rev: 0, claims: {} },
        domains: {
            director: tracker.domains.director.initial(),
            scene: { place: { name: '', kind: '', region: '' }, present: [] },
        },
    });
}

const queries = { ...tracker.queries, ...time.queries };

/**
 * Runs `handler(ctx, payload)` as a command on `state`: `{ ok, state, result }`, or
 * `{ ok: false, code, message, state }` with the state untouched. `extraQueries` add other
 * modules' queries (`quest.progress`). `rev: false` leaves `ctx.rev` out, as the host does today.
 */
export function runCommand(state, handler, payload, { said = null, settings = SETTINGS, seed = 7, extraQueries = {}, rev: withRev = true } = {}) {
    const rev = state.meta.rev + 1;
    const drafts = {};
    const claims = { ...state.meta.claims };
    const all = { ...queries, ...extraQueries };
    const current = () => ({ ...state, domains: { ...state.domains, ...drafts } });
    const ctx = {
        ...(withRev ? { rev } : {}),
        receiptId: `rc_test${String(rev).padStart(4, '0')}`,
        chat: { length: 0, lastUser: said },
        read: domain => deepFreeze(structuredClone(drafts[domain] ?? state.domains[domain])),
        draft: domain => {
            if (domain !== 'director') throw new Rejected('NOT_OWNER', `This module does not own ${domain}.`);
            drafts[domain] ??= structuredClone(state.domains[domain]);
            return drafts[domain];
        },
        call: type => { throw new Rejected('UNKNOWN_COMMAND', `No command ${type} in this test.`); },
        claim: key => (claims[key] ? false : (claims[key] = true)),
        rng: sfc32(seed),
        roll: () => ({ total: 0, dice: [] }),
        settings: () => structuredClone(settings),
        time: () => current().domains.director.time.minutes,
        fail: (code, message) => { throw new Rejected(code, message); },
        query: (name, args) => {
            if (!Object.hasOwn(all, name)) throw new Rejected('NOT_FOUND', `No query ${name}.`);
            return all[name](current(), args);
        },
    };
    let result;
    try {
        result = handler(deepFreeze(ctx), deepFreeze(structuredClone(payload ?? {})));
    } catch (error) {
        return { ok: false, code: error.code ?? 'FAILED', message: error.message, state };
    }
    for (const [domain, draft] of Object.entries(drafts)) {
        const errors = domain === 'director' ? tracker.domains.director.validate(draft, state) : [];
        if (errors.length) return { ok: false, code: 'INVALID', message: errors.join(' '), state };
    }
    JSON.parse(JSON.stringify(result.data ?? {}));
    const next = deepFreeze({ ...state, meta: { rev, claims }, domains: { ...state.domains, ...structuredClone(drafts) } });
    return { ok: true, state: next, result };
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

/** A reply's Director lines, each run as its own story command through the tracker part. */
export function reply(state, block, options = {}) {
    const lines = String(block).split('\n').map(line => line.trim()).filter(Boolean).map(readLine);
    for (const line of lines) {
        const run = runCommand(state, tracker.kinds[line.kind].apply, line, options);
        if (!run.ok) throw new Error(`${line.raw}: ${run.code} ${run.message}`);
        state = run.state;
    }
    return state;
}

/**
 * A chat in outline: carriers (the greeting and replies), each holding the state after it; a
 * user message between them. `view()` is what a hook or a tail sees for the next generation;
 * `generate()` runs the beforeGenerate hook, commits its commands on the head carrier (cause
 * system), and builds the tail; `answer(lines)` adds the reply with its Director lines.
 */
export class Chat {
    constructor({ settings = SETTINGS, extraQueries = {}, rev = true } = {}) {
        this.settings = settings;
        this.extraQueries = extraQueries;
        this.withRev = rev;
        this.messages = [{ carrier: true, state: makeState() }];
        this.receipts = [];
    }

    head() {
        return this.messages.findLast(message => message.carrier).state;
    }

    setHead(state) {
        this.messages.findLast(message => message.carrier).state = state;
    }

    view(length = this.messages.length) {
        const state = this.head();
        const settings = this.settings;
        return { state, query: (name, args) => ({ ...queries, ...this.extraQueries })[name](state, args), settings: () => structuredClone(settings), chat: { length, lastUser: '' } };
    }

    /** The reader writes; the reply is generated (hook, commits, tail) but not added yet. */
    send() {
        this.messages.push({ carrier: false });
        return this.generate();
    }

    /** The hook's commands committed, then the tail for this generation. `length`: the chat's length the host sees. */
    generate(length = this.messages.length) {
        const out = time.hooks.beforeGenerate(this.view(length));
        const committed = [];
        for (const command of out?.commands ?? []) {
            const run = runCommand(this.head(), time.commands[command.type], command.payload, { settings: this.settings, extraQueries: this.extraQueries, rev: this.withRev });
            if (!run.ok) throw new Error(`${command.type}: ${run.code} ${run.message}`);
            this.setHead(run.state);
            committed.push(run.result);
            this.receipts.push(run.result);
        }
        return { committed, tail: time.context.tail(this.view(length)), lines: out?.lines ?? [] };
    }

    /** The reply arrives with its Director lines (captured on the new carrier, or the swipe being written). */
    answer(lines = '', { said = null } = {}) {
        const last = this.messages.at(-1);
        const pending = last?.carrier && last.pending;
        const state = lines ? reply(this.head(), lines, { settings: this.settings, said }) : this.head();
        if (pending) {
            last.state = state;
            delete last.pending;
        } else this.messages.push({ carrier: true, state });
        return state;
    }

    /**
     * A swipe of the last reply: what it held goes, and the new swipe (an empty carrier, so the
     * state is the one before it) is generated; what the hook commits lands on that swipe.
     */
    swipe() {
        const last = this.messages.at(-1);
        if (!last?.carrier || this.messages.length < 2) throw new Error('nothing to swipe');
        this.messages.pop();
        this.messages.push({ carrier: true, pending: true, state: this.head() });
        return this.generate(this.messages.length);
    }

    /** The last reply deleted (with what it held). */
    deleteLast() {
        if (!this.messages.at(-1)?.carrier || this.messages.length < 2) throw new Error('nothing to delete');
        this.messages.pop();
    }
}

/** The thread with this key, as the tracker's query gives it. */
export function thread(state, key) {
    return tracker.queries['director.thread'](state, { key });
}
