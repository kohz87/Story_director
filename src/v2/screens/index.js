// Story Director v2, part **screens** (SPEC §13, MODULES §A): the module's default screens, as data
// Story Block renders: `story-director/quests` (tab, screen), `story-director/director` (tab, screen),
// `story-director/status-card` (card, under each reply, from that reply's state) and
// `story-director/hud` (hud: the story time and place). Cards and packs restyle or replace any of
// them by id (§13.7).
//
// The screens bind to the tracker's and quests' queries (`director.time`, `director.threads`,
// `quest.progress`) and to four view queries this part adds (queries.js: `director.goal`,
// `director.next`, `quest.board`, `director.problems`), which work out what a template cannot
// (sorting, dates, the Finish state from `quest.progress`'s `finish`, `{{user}}` in problem texts)
// from those same queries. No commands, domains or change-line kinds of its own. The status card is
// on under every reply by default (`defaultOn: true`, MODULES §F24; the reader can turn it off).

import { directorScreen } from './director.js';
import { hudScreen } from './hud.js';
import { questsScreen } from './quests.js';
import { screenQueries } from './queries.js';
import { statusCardScreen } from './status-card.js';

export { DIRECTOR_ID, KIND_GROUPS } from './director.js';
export { HUD_ID } from './hud.js';
export { QUESTS_ID } from './quests.js';
export { STATUS_CARD_ID } from './status-card.js';
export { calendarSetting, currentGoal, finishState, nextDue, problemsList, questBoard, readerWords, screenQueries } from './queries.js';

export const MODULE_ID = 'story-director';

/** The default screens, in the order the tab bar shows them. */
export const screens = Object.freeze([questsScreen, directorScreen, statusCardScreen, hudScreen]);

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
        queries: screenQueries({ settings }),
        kinds: {},
        hooks: {},
        tabs: [],
        screens: [...screens],
    };
}

export const part = createScreensPart();
