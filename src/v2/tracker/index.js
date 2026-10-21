// Story Director v2, part **tracker** (MODULES §C1): the `director` domain, its change-line
// kinds, the story clock, its queries, what the model is told, and the Director tab.
// The coordinator's src/v2/module.js merges this part with the others into module
// `story-director`. Quest taking, finishing, targets and progress are part `quests` (§C2):
// this part keeps `taken`, `target` and `reward` as they are, and sets `ended` when a line
// closes a thread.

import { applyThreadLine, applyTimeLine } from './capture.js';
import { THREAD_KINDS } from './convert.js';
import { initialDirector, queries, validateDirector } from './domain.js';
import { GRAMMAR, STATIC_TEXT, TAIL_BUDGET, directorTail } from './note.js';
import { renderDirectorTab } from './tab.js';
import { settingsDefaults } from './time.js';

const kinds = Object.fromEntries(THREAD_KINDS.map(kind => [kind, { grammar: GRAMMAR[kind], apply: applyThreadLine }]));
kinds.time = { grammar: GRAMMAR.time, apply: applyTimeLine };

export const part = {
    domains: {
        director: { initial: initialDirector, validate: validateDirector },
    },
    commands: {},
    queries,
    kinds,
    context: {
        static: () => STATIC_TEXT,
        tail: view => directorTail(view),
        budget: TAIL_BUDGET,
    },
    hooks: {},
    settings: {
        section: 'Calendar',
        defaults: settingsDefaults(),
        schema: {
            calendar: {
                type: 'group',
                label: 'Calendar',
                fields: {
                    preset: { type: 'choice', label: 'Calendar', choices: ['gregorian', 'custom'] },
                    era: { type: 'text', label: 'Era (written before the year)' },
                    months: { type: 'list', label: 'Months', of: { name: { type: 'text', label: 'Name' }, days: { type: 'int', label: 'Days', min: 1, max: 400 } } },
                    leapYears: { type: 'bool', label: 'Leap years' },
                    week: { type: 'text', label: 'Weekdays (comma separated; empty for none)' },
                },
            },
            dormantReplies: { type: 'int', label: 'Quiet after replies', min: 1, max: 500 },
            dormantDays: { type: 'int', label: 'Quiet after story days', min: 1, max: 3650 },
            dueSoonDays: { type: 'int', label: 'Due soon within days', min: 0, max: 365 },
        },
    },
    tabs: [
        { id: 'director', title: 'Director', icon: 'fa-compass', render: (el, view, api) => renderDirectorTab(el, view, api) },
    ],
};
