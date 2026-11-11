// Story Director v2, part screens: behind the scenes on the Director screen, widget
// `story-director.behind` (bound to `director.behind`).
//
// The Director screen has no Reveal step: its cards are the widget `story-director.plan` (below, bound to `director.plan`), which
// shows the plan whole: Beats, the hooks the story is planning (with Next), Off-screen, Secrets and Problems, each a short card with
// its first few rows and "+N more" that opens it (no inner scroll box). The widget above is the older lock, kept for older layouts.
//
// Hidden (reveal.js: the setting on and this chat not revealed): a count and Reveal, and nothing of the
// agendas, planned beats, clocks or secrets is put into the page. Revealed: a Hide bar, then each kind
// as the Director screen draws the others (open threads, the closed ones folded), secrets by name only,
// and the problems about them. With the setting off it is shown as part of the screen, with no bar.

import { BEHIND_KINDS, reveal as pageReveal } from './reveal.js';
import { button, maker, plural, spaced } from './dom.js';
import { THREADS_FEATURE } from '../threads.js';

export const BEHIND_WIDGET = 'story-director.behind';

const META = [['now', 'At'], ['then', 'Next'], ['on', 'On'], ['due', 'Due'], ['place', 'Where'], ['reach', 'Reaches you']];

function render(el, props, _api, reveal) {
    const doc = el.ownerDocument ?? globalThis.document;
    const make = maker(doc);
    const root = make('div', 'sd-behind');
    el.replaceChildren(root);
    let value = props?.value ?? null;

    const threadItem = (thread, kind) => {
        const item = make('li', 'sd-thread', undefined, { 'data-thread': thread.id });
        item.append(make('span', 'sd-key', thread.key));
        if (kind === 'secret') return item;
        if (thread.ended?.outcome) item.append(' ', make('span', 'ss-pill sd-outcome', thread.ended.outcome));
        if (thread.summary) item.append(' ', make('p', 'sd-line', thread.summary));
        const meta = make('p', 'sd-meta');
        for (const [name, label] of META) {
            if (!thread.fields?.[name]) continue;
            if (meta.childNodes.length) meta.append(' ');
            meta.append(make('span', '', `${label}: ${thread.fields[name]}`));
        }
        if (meta.childNodes.length) item.append(' ', meta);
        return item;
    };

    function draw() {
        const data = value && typeof value === 'object' ? value : { kinds: [], problems: [], open: 0, total: 0 };
        const guard = reveal.guard();
        const hidden = guard && !reveal.revealed();
        const parts = [];
        if (hidden) {
            const lock = make('section', 'sd-kind sd-lock', undefined, { 'data-kind': 'behind' });
            const text = make('div', 'sd-lock-text');
            const facts = [plural(data.open ?? 0, 'open thread'), data.problems?.length ? plural(data.problems.length, 'problem') : ''].filter(Boolean).join(' · ');
            text.append(...spaced([
                make('h4', 'sd-h', 'Behind the scenes'),
                make('p', 'sd-line', 'Agendas, planned beats, clocks and secrets stay hidden so the story can still surprise you.'),
                make('p', 'sd-meta sd-lock-counts', facts),
            ]));
            lock.append(make('i', 'fa-solid fa-eye-slash sd-lock-icon', undefined, { 'aria-hidden': 'true' }), text);
            const actions = make('div', 'sd-actions');
            actions.append(button(make, 'Reveal', 'sd-reveal', 'fa-eye', () => reveal.set(true)));
            lock.append(actions);
            parts.push(lock);
            root.replaceChildren(...spaced(parts));
            return;
        }
        if (guard) {
            const bar = make('div', 'sd-unlocked');
            bar.append(make('span', 'sd-line', 'Behind the scenes is showing.'), button(make, 'Hide', 'ss-button-quiet sd-hide', 'fa-eye-slash', () => reveal.set(false)));
            parts.push(bar);
        }
        for (const [kind, title] of BEHIND_KINDS) {
            const group = (data.kinds ?? []).find(entry => entry.kind === kind);
            if (!group) continue;
            const section = make('section', 'sd-kind ss-glass', undefined, { 'data-kind': kind });
            const head = make('h4', 'sd-h', title);
            if (group.open.length) head.append(' ', make('small', '', String(group.open.length)));
            const list = make('ul', 'sd-list sd-threads');
            for (const thread of group.open) list.append(threadItem(thread, kind));
            section.append(head, ' ', list);
            if (group.closed.length) {
                const fold = make('details', 'sd-closed');
                const summary = make('summary', '', 'Closed ');
                summary.append(make('small', '', String(group.closed.length)));
                const closed = make('ul', 'sd-list sd-threads');
                for (const thread of group.closed) closed.append(threadItem(thread, kind));
                fold.append(summary, ' ', closed);
                section.append(' ', fold);
            }
            parts.push(section);
        }
        if (data.problems?.length) {
            const section = make('section', 'sd-kind ss-glass sd-problems-box', undefined, { 'data-kind': 'behind-problems' });
            section.append(make('h4', 'sd-h', 'Problems behind the scenes'));
            const list = make('ol', 'sd-list sd-problems');
            for (const problem of data.problems) {
                const item = make('li', 'sd-problem', undefined, { 'data-kind': problem.kind });
                item.append(make('span', 'ss-pill', problem.kind), ` ${problem.text}`);
                list.append(item);
            }
            section.append(' ', list);
            parts.push(section);
        }
        root.replaceChildren(...spaced(parts));
    }

    const off = reveal.subscribe(draw);
    draw();
    return {
        update(next) {
            value = next?.value ?? null;
            draw();
        },
        destroy() {
            off?.();
            root.remove();
        },
    };
}

/** The widget definition; `reveal` (tests): the reveal choice (the page's by default). */
export function createBehindWidget({ reveal = pageReveal } = {}) {
    return Object.freeze({
        // The agendas, clocks, beats and secrets are the feature `story-director.threads`': off, the host draws no Behind widget.
        feature: THREADS_FEATURE,
        props: Object.freeze({ value: Object.freeze({ type: 'object', default: null }) }),
        primary: 'value',
        validate: props => (props?.value !== undefined && props.value !== null && typeof props.value !== 'object' ? ['value must be the director.behind data.'] : []),
        render: (el, props, api) => render(el, props, api, reveal),
    });
}

export const behindWidget = createBehindWidget();

// ---- the Director screen's plan cards ---------------------------------------------------------------

export const PLAN_WIDGET = 'story-director.plan';
const PLAN_SHOWN = 3;
const PLAN_CARDS = [['beats', 'Beats', 'beat'], ['hooks', 'Hooks the story is planning', 'hook'], ['clocks', 'Clocks', 'clock'], ['agendas', 'Off-screen', 'agenda'], ['secrets', 'Secrets', 'secret'], ['problems', 'Problems', 'problem']];

function renderPlan(el, props) {
    const make = maker(el.ownerDocument ?? globalThis.document);
    const root = make('div', 'sd-behind sd-plan');
    el.replaceChildren(root);
    let value = props?.value ?? null;
    const opened = new Set();

    const row = (item, kind) => {
        if (kind === 'problem') {
            const li = make('li', 'sd-problem', undefined, { 'data-kind': item.kind });
            li.append(make('span', 'sd-line', item.text), ' ', make('span', 'ss-pill sd-ptag', item.kind, { title: item.kind }));
            return li;
        }
        const li = make('li', 'sd-thread', undefined, { 'data-thread': item.id });
        li.append(make('span', 'sd-key', item.key));
        if (kind === 'secret' || kind === 'beat') return li;
        if (item.summary) li.append(' ', make('p', 'sd-line', kind === 'agenda' ? `wants: ${item.summary}` : item.summary));
        const meta = [kind === 'agenda' && item.fields?.now ? `At: ${item.fields.now}` : '', kind === 'clock' && item.fields?.due ? `Due: ${item.fields.due}` : '', item.fields?.then ? `Next: ${item.fields.then}` : ''].filter(Boolean);
        // The text sits in a span: the sheet hides a `.sd-meta` with no child element.
        if (meta.length) {
            const line = make('p', 'sd-meta');
            line.append(make('span', '', meta.join(' · ')));
            li.append(' ', line);
        }
        return li;
    };

    function draw() {
        const data = value && typeof value === 'object' ? value : {};
        const cards = [];
        for (const [name, title, kind] of PLAN_CARDS) {
            const items = Array.isArray(data[name]) ? data[name] : [];
            if (!items.length) continue;
            const card = make('section', 'sd-kind ss-glass sd-plan-card', undefined, { 'data-kind': kind });
            const head = make('h4', 'sd-h', title);
            head.append(' ', make('small', '', String(items.length)));
            const shown = opened.has(name) ? items : items.slice(0, PLAN_SHOWN);
            const list = make('ul', 'sd-list sd-threads');
            list.append(...shown.map(item => row(item, kind)));
            card.append(head, ' ', list);
            if (items.length > PLAN_SHOWN) {
                const more = opened.has(name) ? 'Show less' : `+ ${items.length - PLAN_SHOWN} more`;
                card.append(' ', button(make, `${more} ${opened.has(name) ? '‹' : '›'}`, 'ss-button-quiet sd-more', null, () => {
                    if (!opened.delete(name)) opened.add(name);
                    draw();
                }));
            }
            cards.push(card);
        }
        root.replaceChildren(...spaced(cards));
    }

    draw();
    return { update(next) { value = next?.value ?? null; draw(); }, destroy() { root.remove(); } };
}

/** The Director screen's plan cards (bound to `director.plan`). The beats, off-screen and secrets are the feature `story-director.threads`'. */
export const planWidget = Object.freeze({
    props: Object.freeze({ value: Object.freeze({ type: 'object', default: null }) }),
    primary: 'value',
    validate: props => (props?.value !== undefined && props.value !== null && typeof props.value !== 'object' ? ['value must be the director.plan data.'] : []),
    render: renderPlan,
});

// ---- the Ripples card (Director tab, spoilers): each power's sway bar and its top reasons; always drawn (the Director is game-view only) ----

export const RIPPLES_WIDGET = 'story-director.ripples';
const TOP_REASONS = 3;
const signed = n => (n > 0 ? `+${n}` : String(n));

function renderRipples(el, props) {
    const doc = el.ownerDocument ?? globalThis.document;
    const make = maker(doc);
    const root = make('div', 'sd-ripples');
    el.replaceChildren(root);
    let rows = Array.isArray(props?.value) ? props.value : [];
    function draw() {
        if (!rows.length) return root.replaceChildren();
        const section = make('section', 'sd-kind ss-glass', undefined, { 'data-kind': 'ripples' });
        section.append(make('h4', 'sd-h', 'Ripples'), ' ');
        const list = make('ul', 'sd-list sd-ripple-list');
        for (const row of rows) {
            const item = make('li', 'sd-ripple', undefined, { 'data-power': row.id });
            const bar = make('span', 'sd-ripple-bar', undefined, { role: 'meter', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': row.sway, 'aria-label': `${row.name} sway` });
            const fill = make('span', 'sd-ripple-fill');
            fill.style.width = `${Math.max(0, Math.min(100, row.sway))}%`;
            bar.append(fill);
            item.append(make('span', 'sd-key', row.name), ' ', make('small', '', String(row.sway)), ' ', bar);
            const reasons = Array.isArray(row.reasons) ? row.reasons : [];
            for (const reason of reasons.slice(0, TOP_REASONS)) item.append(' ', make('p', 'sd-meta sd-reason', `${signed(reason.delta)} · ${reason.text}`));
            if (reasons.length > TOP_REASONS) item.append(' ', make('p', 'sd-meta sd-more', `+${reasons.length - TOP_REASONS} more`));
            list.append(item);
        }
        section.append(list);
        root.replaceChildren(section);
    }
    draw();
    return {
        update(next) {
            rows = Array.isArray(next?.value) ? next.value : [];
            draw();
        },
        destroy() {
            root.remove();
        },
    };
}

/** The widget `story-director.ripples` (bound to `ripples.sway`): no Reveal step; the Director screen is where spoilers live. */
export function createRipplesWidget() {
    return Object.freeze({
        props: Object.freeze({ value: Object.freeze({ type: 'array', default: Object.freeze([]) }) }),
        primary: 'value',
        validate: props => (props?.value !== undefined && props.value !== null && !Array.isArray(props.value) ? ['value must be the ripples.sway rows.'] : []),
        render: (el, props) => renderRipples(el, props),
    });
}

export const ripplesWidget = createRipplesWidget();
