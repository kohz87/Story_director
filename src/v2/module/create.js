// Story Director v2: building the one module definition from its parts.

import { CALENDAR_KEYS, calendarRule, liveCalendarSettings } from '../tracker/calendar-settings.js';
import { calendarOf, packCalendarOf, settingsFrom } from '../tracker/time.js';
import { rareKindsUsed } from '../rare.js';
import { MODULE_ID, MODULE_NAME, PARTS, STORY_BLOCK_RANGE, VERSION } from './parts.js';
import { LIVE_HOST, isObject, liveSdk, tryLive } from './shared.js';
import { fightRunner } from './host.js';
import { namespaced, readsOf, settingsFor } from './settings.js';
import { memoQueries, partCtx, partTools, partView, withSettingArgs } from './contexts.js';
import { cueLinesOf, linesOf, mergeHook, own, sectionOf, withFeature } from './merge.js';

// Story Block's RPG feature: while it is on, its planner asks for the checks.
const RPG_FEATURE = 'story-block.rpg';

/**
 * The module definition for `sdk.registerModule` (SPEC §6) from `parts` ([id, part], in order;
 * default: tracker, quests, time, atlas, chronicle, screens). `host` (tests): `{ settings(id), substitute(text) }`
 * for queries whose host tools lack them; by default Story Block's live sdk.
 */
export function createModule({ parts = PARTS, host = LIVE_HOST } = {}) {
    const owners = { domain: {}, command: {}, query: {}, kind: {}, tab: {}, screen: {}, widget: {}, feature: {} };
    const features = [];
    const capabilities = [];
    const screenList = [];
    const widgets = {};
    const headerControls = [];
    const readsByPart = {};
    // What the parts are told of the module set: `fights`, whether a fight runner is there (true until
    // it is known; worked out before each reply's prompt, so the static part is the same bytes for
    // one set of modules).
    // It starts from what fightRunner says now (a dormant fight runner is none), true where that cannot be known.
    // `chronicle`, `map`, `routes`: whether the story uses the rare kinds (world and faction lines; landmark and route lines; trip lines),
    // so their grammar is taught only then (the lean diet, 3 Nov). All start false and are learnt from the state before each reply.
    const env = { fights: fightRunner() ?? true, rpg: false, keyPeople: false, chronicle: false, map: false, routes: false, calendarRule: '' };
    const learn = view => {
        const found = fightRunner(view);
        if (typeof found === 'boolean') env.fights = found;
        // Story Block's RPG feature (off by default): while it is on its planner asks for the checks.
        if (typeof view?.feature === 'function') env.rpg = tryLive(() => view.feature(RPG_FEATURE), false) === true;
        if (isObject(view?.state?.domains)) Object.assign(env, rareKindsUsed(view));
        // Whether anyone is pinned (Key people): the feature's paragraph and grammar lines are taught only then, so a chat with no key
        // people sends the prompt it always did. The prompt changes when the first person is pinned and when the last is unpinned.
        const pins = view?.state?.domains?.keypeople?.pins;
        if (isObject(view?.state?.domains)) env.keyPeople = isObject(pins) && Object.keys(pins).length > 0;
        // The custom calendar's one rule (no real-world day or month names): a setting, so the same bytes every reply of the story.
        env.calendarRule = tryLive(() => {
            const base = typeof view?.settings === 'function' ? id => view.settings(id) : id => (id === undefined || id === null || id === MODULE_ID ? view?.settings : {});
            return calendarRule(calendarOf(settingsFrom(settingsFor('tracker', base, { defaults, query: view?.query })()), packCalendarOf(view?.query)));
        }, '');
    };
    // The model call a part may ask for (the host's `callModel`); built each time the parts' views are, so a host that gains or loses it is followed.
    const modelOf = () => (typeof host?.callModel === 'function' && (typeof host.canCallModel !== 'function' || host.canCallModel()) ? Object.freeze({ callModel: request => host.callModel(request), chat: () => (typeof host.chat === 'function' ? host.chat() : []) }) : null);
    const storyOf = () => Object.freeze({ chat: () => (typeof host?.chat === 'function' ? host.chat() : []) });
    const shared = ns => ({ defaults, reads: readsByPart[ns] ?? [], env, model: modelOf(), story: storyOf() });
    const domains = {};
    const commands = {};
    const queries = {};
    const kinds = {};
    const appliers = {};
    const hooks = {};
    const tabs = [];
    const defaults = {};
    const schema = {};
    // The static paragraphs in prompt order: { static, feature? }. A paragraph a feature owns is a context part of that
    // feature; the plain ones around it stay one static each, so the bytes the host builds are the parts' in order.
    const chunks = [];
    const tails = [];
    // Context parts under a feature (`context.parts: [{ feature, static?, tail? }]`, MODULES §F100): Story
    // Block adds their static and tail only while the feature is on.
    const contextParts = [];
    const sections = [];
    let budget = 0;
    // A part whose token budget is a setting (`context.budgetOf(settings)`, the Key people's): the module's budget follows it, so a
    // larger one is not cut by the host at the sum of the fixed ones. Its own `context.budget` is what it is when the setting is unread.
    const dynamicBudgets = [];

    for (const [ns, part] of parts) {
        for (const [name, domain] of Object.entries(part.domains ?? {})) {
            own(owners.domain, name, ns, 'the domain');
            domains[name] = domain;
        }
        for (const [type, handler] of Object.entries(part.commands ?? {})) {
            own(owners.command, type, ns, 'the command');
            commands[type] = withFeature((ctx, payload) => handler(partCtx(ns, ctx, shared), payload), handler);
        }
        for (const [name, query] of Object.entries(part.queries ?? {})) {
            own(owners.query, name, ns, 'the query');
            queries[name] = withFeature((state, args, tools) => {
                const own = partTools(ns, tools, shared, host);
                return query(state, withSettingArgs(name, args, own), own);
            }, query);
        }
        for (const name of part.capabilities ?? []) if (!capabilities.includes(name)) capabilities.push(name);
        for (const feature of part.features ?? []) {
            own(owners.feature, feature?.id, ns, 'the feature');
            features.push({ ...feature });
        }
        for (const [kind, spec] of Object.entries(part.kinds ?? {})) {
            own(owners.kind, kind, ns, 'the change-line kind');
            // A part's grammar may depend on the module set (`spec.grammar(env)`): read when the prompt is built.
            const grammar = spec.grammar;
            kinds[kind] = {
                // A line may be '' (the Key people's, while nobody is pinned): the host then leaves the kind out, so a function answers (the registry takes one for a kind with no line yet).
                get grammar() {
                    const line = typeof grammar === 'function' ? grammar({ fights: env.fights, rpg: env.rpg, keyPeople: env.keyPeople, chronicle: env.chronicle, map: env.map, routes: env.routes }) : grammar;
                    return line === '' ? () => '' : line;
                },
                ...(spec.aliases ? { aliases: spec.aliases } : {}),
                // The change-line heads a kind with no grammar line of its own still answers to when a story writes one outside the block (Story Block `heads`).
                ...(Array.isArray(spec.heads) ? { heads: [...spec.heads] } : {}),
                // A kind a feature owns (MODULES §F100): Story Block leaves its grammar out, and its lines unused, while that feature is off.
                ...(typeof spec.feature === 'string' ? { feature: spec.feature } : {}),
                // Kinds whose lines of a reply this kind's lines run behind (Story Block 2.11.1; an older host reads the lines as written).
                ...(Array.isArray(spec.after) ? { after: [...spec.after] } : {}),
            };
            appliers[kind] = (ctx, line) => spec.apply(partCtx(ns, ctx, shared), line);
            for (const alias of spec.aliases ?? []) appliers[alias] = appliers[kind];
        }
        if (typeof part.context?.static === 'function') chunks.push({ static: part.context.static, ...(typeof part.context.staticFeature === 'string' ? { feature: part.context.staticFeature } : {}) });
        for (const inline of Array.isArray(part.context?.inline) ? part.context.inline : []) {
            if (typeof inline?.static === 'function') chunks.push({ static: inline.static, ...(typeof inline.feature === 'string' ? { feature: inline.feature } : {}) });
        }
        if (typeof part.context?.tail === 'function') tails.push([ns, part.context.tail]);
        for (const extra of Array.isArray(part.context?.parts) ? part.context.parts : []) contextParts.push({ ...extra });
        if (typeof part.context?.budgetOf === 'function') dynamicBudgets.push([ns, part.context.budgetOf, part.context.budget]);
        else if (Number.isInteger(part.context?.budget) && part.context.budget > 0) budget += part.context.budget;
        for (const [name, fn] of Object.entries(part.hooks ?? {})) {
            if (typeof fn !== 'function') continue;
            (hooks[name] ??= []).push([ns, fn]);
        }
        if (part.settings) {
            const named = namespaced(ns, part.settings);
            Object.assign(defaults, named.defaults);
            Object.assign(schema, named.schema);
            readsByPart[ns] = readsOf(part.settings);
            if (typeof part.settings.section === 'function') sections.push(part.settings.section);
        }
        for (const tab of part.tabs ?? []) {
            own(owners.tab, tab.id, ns, 'the tab');
            tabs.push({ ...tab, render: (el, view, api) => tab.render(el, partView(ns, view, shared), api) });
        }
        for (const screen of part.screens ?? []) {
            own(owners.screen, screen?.id, ns, 'the screen');
            screenList.push(screen);
        }
        for (const control of part.headerControls ?? []) headerControls.push(control);
        for (const [name, widget] of Object.entries(part.widgets ?? {})) {
            own(owners.widget, name, ns, 'the widget');
            widgets[name] = widget;
        }
    }

    // The Calendar settings show the calendar in use (tracker/calendar-settings.js): with `pack`, the
    // pack's, and Custom starts from it. Read from Story Block's live queries when the settings are drawn.
    const askLive = name => tryLive(() => (typeof host.query === 'function' ? host.query(name, {}) : liveSdk()?.query?.(name, {})), null);
    const liveView = () => {
        const stored = tryLive(() => host.settings(MODULE_ID), null);
        return { calendar: packCalendarOf(name => askLive(name)), list: askLive('packs.list'), preset: stored?.[CALENDAR_KEYS.preset] };
    };
    liveView.calendar = () => packCalendarOf(name => askLive(name));
    liveCalendarSettings(defaults, schema, liveView);
    // Runs of plain paragraphs are one static; a paragraph under a feature is a context part (MODULES §F100). The first
    // run is the module's own static, the rest follow it as parts in the same order, before the parts the module's
    // parts declare (the NPC initiative's), so the host puts the paragraphs together exactly as they were written.
    const grouped = [];
    for (const chunk of chunks) {
        const last = grouped.at(-1);
        if (last && !last.feature && !chunk.feature) last.items.push(chunk.static);
        else grouped.push({ feature: chunk.feature, items: [chunk.static] });
    }
    const staticOf = items => () => items.map(fn => String(fn({ fights: env.fights, keyPeople: env.keyPeople, chronicle: env.chronicle, map: env.map, routes: env.routes, calendarRule: env.calendarRule }) ?? '').trim()).filter(Boolean).join('\n');
    const staticParts = grouped.slice(grouped[0] && !grouped[0].feature ? 1 : 0)
        .map(group => ({ ...(group.feature ? { feature: group.feature } : {}), static: staticOf(group.items) }));
    const def = {
        id: MODULE_ID,
        name: MODULE_NAME,
        version: VERSION,
        // The Story Block this needs (B-b7r2-1): the beta asks for the beta host it was built and tested
        // with (arc planning's sdk.callModel among it, arc/controller.js ARC_NEEDS_STORY_BLOCK). Story Block
        // before 2.0.0-alpha.2 compares without the pre-release tag, so it reads this as ">=2.0.0" and
        // still loads the module.
        requires: { storyBlock: STORY_BLOCK_RANGE },
        domains,
        commands,
        queries,
        replayQueries: ['director.thread'].filter(name => Object.hasOwn(queries, name)),
        context: {
            // The same bytes every reply: each part's static is fixed text. What a feature owns is a context part of its own.
            static: staticOf(grouped[0] && !grouped[0].feature ? grouped[0].items : []),
            tail(hostView) {
                // One memo for this build: learn and every part's tail ask the same queries of the same state.
                const view = memoQueries(hostView);
                learn(view);
                const lines = [];
                const optional = [];
                for (const [ns, tail] of tails) {
                    const out = tail(partView(ns, view, shared)) ?? {};
                    lines.push(...cueLinesOf(out.lines));
                    optional.push(...linesOf(out.optional));
                }
                return { lines, optional };
            },
            get budget() {
                let total = budget;
                for (const [ns, budgetOf, fallback] of dynamicBudgets) {
                    let own;
                    try { own = budgetOf(settingsFor(ns, id => host.settings(id), { defaults })()); } catch { own = undefined; }
                    total += Number.isSafeInteger(own) && own >= 0 ? own : fallback;
                }
                return total || 1;
            },
            ...(staticParts.length || contextParts.length ? { parts: [...staticParts, ...contextParts] } : {}),
        },
        hooks: Object.fromEntries(Object.entries(hooks).map(([name, entries]) => {
            const merged = mergeHook(name, entries, shared);
            // Before each reply: what the module set is, before the prompt is assembled.
            return [name, name === 'beforeGenerate'
                ? Object.assign((view, ...rest) => { learn(view); return merged(view, ...rest); }, Number.isFinite(merged.timeoutMs) ? { timeoutMs: merged.timeoutMs } : {})
                : merged];
        })),
        settings: { defaults, schema, ...(sectionOf(sections) ? { section: sectionOf(sections) } : {}) },
        tabs,
        screens: screenList,
    };
    if (Object.keys(widgets).length) def.widgets = widgets;
    // Story Block's game view header toggle (the host's `headerControls`, one per module): the Quiet scene switch.
    if (headerControls.length) def.headerControls = headerControls;
    if (features.length) def.features = features;
    // The names a pack's `requires.capabilities` can ask of this module (Story Block lists a pack as missing one that no module declares).
    if (capabilities.length) def.capabilities = capabilities;
    if (Object.keys(kinds).length) {
        def.capture = {
            kinds,
            apply(ctx, line) {
                const apply = appliers[line?.kind] ?? appliers[String(line?.word ?? '').toLowerCase()];
                if (!apply) return ctx.fail('INVALID', `Story Director does not keep "${line?.kind}" lines.`);
                return apply(ctx, line);
            },
        };
    }
    return def;
}
