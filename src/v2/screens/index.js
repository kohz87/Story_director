// Story Director v2, part **screens** (SPEC §13, MODULES §A): the module's default screens, as data
// Story Block renders: `story-director/quests` (tab, screen), `story-director/director` (tab, screen),
// `story-director/status-card` (card, under each reply, from that reply's state). The story time and place are
// in the Status fold, not a HUD strip (Story Block's HUD shows party data only). Cards and packs restyle or replace any of
// them by id (§13.7). The Quests screen draws its threads as cards through the widget `story-director.quests` (quest-cards.js).
//
// The screens bind to the tracker's and quests' queries (`director.time`, `director.threads`,
// `quest.progress`, `quest.details`) and to four view queries this part adds (queries.js: `director.goal`,
// `director.next`, `quest.board`, `director.problems`), which work out what a template cannot
// (sorting, dates, each quest's status line and details, `{{user}}` in problem texts) from those same
// queries. No screen draws a command button (F95): quests follow the reader's words and the story. No commands, domains or change-line kinds of its own.
// The Director screen's device-wide spoiler switch is independent of the older Behind widget's per-chat
// Reveal choice (reveal.js, widget `story-director.behind`; setting `hideBehind`, on). The status card is
// on under every reply by default (`defaultOn: true`, MODULES §F24; the reader can turn it off).

import { PULSE_FEATURE, SPOILER_WIDGET, directorScreen, pulseQuiet, pulseView, spoilerSwitchWidget } from './director.js';
import { questsScreen } from './quests.js';
import { screenQueries } from './queries.js';
import { statusCardScreen } from './status-card.js';
import { BEHIND_WIDGET, PLAN_WIDGET, RIPPLES_WIDGET, behindWidget, planWidget, createRipplesWidget, ripplesWidget } from './behind.js';
import { QUESTS_WIDGET, questsWidget } from './quest-cards.js';
import { THREADS_FEATURE } from '../threads.js';

export { DIRECTOR_ID, KIND_GROUPS } from './director.js';
export { QUESTS_ID } from './quests.js';
export { STATUS_CARD_ID } from './status-card.js';
export { BEHIND_WIDGET, PLAN_WIDGET, RIPPLES_WIDGET, behindWidget, createBehindWidget, planWidget, createRipplesWidget, ripplesWidget } from './behind.js';
export { QUESTS_WIDGET, chipOf, createQuestsWidget, isQuestThread, questsWidget, rowsOf } from './quest-cards.js';
export { BEHIND, BEHIND_KINDS, HIDE_SETTING, browserStore, createReveal, reveal } from './reveal.js';
export { calendarSetting, currentGoal, nextDue, planView, problemsList, readerWords, screenQueries } from './queries.js';

export const MODULE_ID = 'story-director';

/** The default screens, in the order the tab bar shows them. */
export const screens = Object.freeze([questsScreen, directorScreen, statusCardScreen]);

// The module's settings (its calendar), read when a query runs; Story Block's sdk when it is there.
function hostSettings() {
    try {
        return globalThis.StoryBlock?.sdk?.settings?.(MODULE_ID) ?? null;
    } catch {
        return null;
    }
}

/**
 * The part. `settings` (a function or an object) gives the module's settings, for the calendar
 * `director.next` reads dates on; by default Story Block's `sdk.settings('story-director')`.
 */
export function createScreensPart({ settings = hostSettings } = {}) {
    return {
        domains: {},
        commands: {},
        // `pulse.view`: the World pulse card and the status card's roll row; `pulse.quiet`: the header switch's state (feature `story-director.pulse`).
        queries: { ...screenQueries({ settings }), 'pulse.view': Object.assign((state, args, tools) => pulseView(state, args, tools, settings), { feature: PULSE_FEATURE }),
            'pulse.quiet': Object.assign((state, args, tools) => pulseQuiet(state, args, tools, settings), { feature: PULSE_FEATURE }) },
        // The Quiet scene switch in Story Block's game view header (a host that has `headerControls`; the Director tab keeps its own switch otherwise).
        headerControls: [{ id: 'quiet', label: 'Quiet scene', icon: '🌙', query: 'pulse.quiet', command: 'director.pulse.quiet', feature: PULSE_FEATURE }],
        kinds: {},
        hooks: {},
        tabs: [],
        screens: [...screens],
        widgets: { [BEHIND_WIDGET]: behindWidget, [PLAN_WIDGET]: planWidget, [RIPPLES_WIDGET]: ripplesWidget, [QUESTS_WIDGET]: questsWidget, [SPOILER_WIDGET]: spoilerSwitchWidget },
        settings: {
            defaults: { hideBehind: true },
            schema: {
                // Per chat, Reveal shows them (remembered in this browser); this hides nothing from the story.
                // Shown only while the feature `story-director.threads` is on (what it hides is that feature's).
                hideBehind: { type: 'bool', label: 'Behind the scenes: Hide agendas, planned beats, clocks and secrets (the Director screen has its own spoiler switch)', feature: THREADS_FEATURE },
            },
        },
    };
}

export const part = createScreensPart();
