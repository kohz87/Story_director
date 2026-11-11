// Story Director v2, part **world**: the World screen's Leads data and the fold every World section shares.
//
// * `leadsOf(state, tools)` → `[{ id, name, heard, heardAgo, where }]`: the hooks the player has heard of, newest first.
//   The same filter as World's known list (known.js): active, not ended, no planner offer, no arc thread, no hidden name
//   or hidden phrase. `heard`: the hook's summary; `heardAgo`: when it was first heard; `where`: its place when the hook
//   names one (fields `where` or `place`), else ''. Never its Next line. Query `director.world.leads` (index.js).
// * `foldMemory(storage?)`: which World sections the reader folded, per chat, on this device (one JSON object under
//   FOLD_STORE; every storage access is guarded and the page keeps its own copy).
// * Widget `story-director.fold` (`foldWidget`): the head of a folding section: a centred chevron, the title and the count.
//   It sits in a template section marked `data-fold="<id>"` (its body is the section's `.sd-fold-body`); a click folds or opens
//   the section and remembers that for this chat. Open by default.
//
// Text only ever goes in as text (textContent), never as markup (WAVE rule 7). The only write is the fold's remembered
// state; a blocked or full storage keeps it for the page, and the page's own copy is read first.

import { lineKey } from '../../changes.js';
import { maker, spaced } from '../screens/dom.js';
import { stChatId } from '../screens/reveal.js';
import { agoText, cut, hiddenNames, namesHidden, nowFrom, queryOf } from './known.js';

export const FOLD_STORE = 'story-director.world.folds';
const SUMMARY_CHARS = 160;
const DAY = 1440;

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isInt = value => Number.isSafeInteger(value);
const dayOf = minutes => Math.floor(minutes / DAY);

/** How many story days ago `minutes` was, as text ("today", "yesterday", "3 days ago"), or '' when unknown or in the future. */
const ageOf = (now, minutes) => (isInt(now) && isInt(minutes) && now >= minutes ? agoText(dayOf(now) - dayOf(minutes)) : '');

/** The hooks the player has heard of, newest first (`heard` is the hook's summary; see the header for the filter). */
export function leadsOf(state, tools) {
    const query = queryOf(tools);
    const now = nowFrom(query, state);
    const hidden = hiddenNames(state);
    const threads = isRecord(state?.domains?.director?.threads) ? Object.values(state.domains.director.threads).filter(isRecord) : [];
    const out = [];
    for (const thread of threads) {
        if (thread.kind !== 'hook' || thread.status !== 'active' || thread.ended || thread.offer || thread.track?.arc) continue;
        const name = cut(thread.key, 80);
        const heard = cut(thread.summary, SUMMARY_CHARS);
        if (!name || hidden.behind.has(lineKey(name)) || namesHidden(heard, hidden.words)) continue;
        const at = isInt(thread.track?.created?.time) ? thread.track.created.time : null;
        out.push({
            id: cut(thread.id, 80),
            name,
            heard,
            heardAgo: ageOf(now, at),
            where: cut(thread.fields?.where ?? thread.fields?.place, 80),
            at,
        });
    }
    return out
        .sort((a, b) => (b.at ?? -Infinity) - (a.at ?? -Infinity) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        .map(({ at, ...item }) => item);
}

/**
 * The remembered folds on `storage` (default: the page's localStorage), as `get(key)` → true | false | null and
 * `set(key, open)`. Stored as one JSON object under FOLD_STORE. Every access is guarded: a blocked storage, or a
 * damaged value, falls back to the page's own copy.
 */
export function foldMemory(storage = defaultStorage()) {
    const page = new Map();
    const read = () => {
        try {
            const raw = storage?.getItem?.(FOLD_STORE);
            const got = typeof raw === 'string' ? JSON.parse(raw) : null;
            return isRecord(got) ? got : {};
        } catch {
            return {};
        }
    };
    return {
        get(key) {
            if (page.has(key)) return page.get(key);
            const got = read()[key];
            return typeof got === 'boolean' ? got : null;
        },
        set(key, open) {
            page.set(key, open === true);
            try {
                const all = read();
                all[key] = open === true;
                storage?.setItem?.(FOLD_STORE, JSON.stringify(all));
            } catch { /* storage blocked or full: the page keeps it */ }
        },
    };
}

function defaultStorage() {
    try {
        return globalThis.localStorage ?? null;
    } catch {
        return null;
    }
}

export const FOLD_WIDGET = 'story-director.fold';

/** Shows or folds `section` (a `[data-fold]` node): its class, its body and the head's aria state. */
function applyFold(section, head, open) {
    section.classList?.toggle('sd-fold-shut', !open);
    for (const child of Array.from(section.children ?? [])) if (child.classList?.contains('sd-fold-body')) child.hidden = !open;
    head.setAttribute('aria-expanded', String(open));
}

function renderFold(el, props, memory) {
    const make = maker(el.ownerDocument ?? globalThis.document);
    let value = props ?? {};
    const head = make('button', 'sd-fold-head', undefined, { type: 'button', 'aria-expanded': 'true' });
    el.replaceChildren(head);
    const section = () => el.closest?.('[data-fold]') ?? null;
    const keyOf = () => `${stChatId()}/${section()?.getAttribute('data-fold') || value.id || ''}`;
    const draw = () => {
        const chevron = make('span', 'sd-fold-chev', undefined, { 'aria-hidden': 'true' });
        chevron.append(make('i', 'fa-solid fa-chevron-down'));
        head.replaceChildren(...spaced([chevron, make('span', 'sd-fold-title', value.title ?? ''), ...(value.count ? [make('small', 'sd-fold-count', value.count)] : [])]));
        const node = section();
        if (node) applyFold(node, head, memory.get(keyOf()) !== false);
    };
    head.addEventListener('click', event => {
        event?.stopPropagation?.();
        const node = section();
        if (!node) return;
        const open = node.classList?.contains('sd-fold-shut') === true;
        applyFold(node, head, open);
        memory.set(keyOf(), open);
    });
    draw();
    return { update(next) { value = next ?? {}; draw(); }, destroy() { head.remove(); } };
}

/** The fold head widget; `memory` (tests): the remembered folds (the page's by default). */
export function createFoldWidget({ memory = foldMemory() } = {}) {
    return Object.freeze({
        props: Object.freeze({
            id: Object.freeze({ type: 'string', default: '' }),
            title: Object.freeze({ type: 'string', default: '' }),
            count: Object.freeze({ type: 'string', default: '' }),
        }),
        primary: 'title',
        validate: () => [],
        render: (el, props) => renderFold(el, props, memory),
    });
}

export const foldWidget = createFoldWidget();
