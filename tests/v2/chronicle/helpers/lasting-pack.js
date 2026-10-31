// A pack whose events write lasting changes to the chronicle (`chronicle.lasting`), for the delete fuzzes
// (tests/v2/break/fuzz-delete*.test.js): the repo notes ask for every command in their generators.
// Two entries are made by events that fire before the second reply (the first exchanges are never deleted),
// one of them by an "Any time" event, which is tried before the first reply has set the clock and waits
// (NOT_YET). Later events count story minutes from them (`chronicle.passed`), change them and make entries of
// their own; a delete that takes such a fire away makes the event happen again. Like the other generators,
// the story's lines and the reader's edits name only the entries the first exchanges made, so a skipped block
// can only come from bookkeeping one reply keeps for another.

import { cleanName } from '../../../../src/v2/chronicle/domain.js';

const passed = (name, minutes) => `query('chronicle.passed', { name: '${name}', minutes: ${minutes} })`;
const lasting = payload => ({ command: 'chronicle.lasting', payload });

/** The entries the story's lines and the reader's edits may name. */
export const LASTING_NAMES = Object.freeze(['Fuzz omen', 'Fuzz any']);

export const LASTING_PACK = JSON.stringify({
    id: 'fuzz-lasting',
    version: '1.0.0',
    name: 'Fuzz lasting',
    requires: { storyBlock: '^2', capabilities: ['chronicle-lasting'] },
    content: {
        events: [
            { id: 'fuzz-omen', once: true, when: 'time() != null', cue: 'An omen.', then: [lasting({ name: 'Fuzz omen', state: 'looming', place: 'Bluewatch', factions: ['Fuzz Guild'], summary: 'Something stirs.', keep: true })] },
            { id: 'fuzz-fall', after: 'fuzz-omen', once: true, when: passed('Fuzz omen', 1500), cue: 'It falls.', then: [lasting({ name: 'Fuzz omen', state: 'resolved' }), lasting({ name: 'Fuzz fall', state: 'ongoing', keep: true })] },
            { id: 'fuzz-any', once: true, when: 'true', cue: 'Any time.', then: [lasting({ name: 'Fuzz any', state: 'looming' })] },
            { id: 'fuzz-any-late', after: 'fuzz-any', once: true, when: passed('Fuzz any', 1440), cue: 'Later.', then: [lasting({ name: 'Fuzz any', state: 'ongoing', summary: 'A day on.' })] },
            { id: 'fuzz-end', after: 'fuzz-fall', once: true, when: passed('Fuzz omen', 4000), cue: 'It ends.', then: [lasting({ name: 'Fuzz any', state: 'resolved', summary: 'Over.' }), lasting({ name: 'Fuzz end', state: 'resolved', summary: 'The last of it.' })] },
        ],
    },
});

/**
 * Lines of the story that name the pack's entries, from a random stream of their own (so the fuzz's other
 * stories stay as they were): `+ world` adds to a locked entry or makes one the event then takes over.
 */
export function lastingLines(r) {
    const lines = [];
    if (r.chance(0.25)) lines.push(`+ world ${r.pick(LASTING_NAMES)} — ${r.pick(['word came', 'a rumour', 'it spreads'])} | state: ${r.pick(['looming', 'ongoing', 'resolved'])}`);
    return lines;
}

/** The reader's edit of a pack entry now and then (cause `ui`): a summary, the keep flag or the lock. Returns the command or null. */
export function lastingEdit(r, host, n) {
    if (!r.chance(0.2)) return null;
    const entry = host.sdk.query('chronicle.event', { name: r.pick(LASTING_NAMES) });
    if (!entry) return null;
    const roll = r();
    const change = roll < 0.5 ? { summary: cleanName(`Edited in reply ${n}`) } : roll < 0.8 ? { keep: entry.keep !== true } : { locked: false };
    return { id: entry.id, ...change };
}
