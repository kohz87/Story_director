// Story Director: the note's record, due, arrival and While away lines (pure).
//
// Item rendering moved out of note.js; note.js re-exports only its own former public names.
import { questDifficulty } from './changes.js';
import { waitsForPay } from './tracker.js';
import { AWAY_ARRIVAL, AWAY_CUE, AWAY_DEADLINE, AWAY_RECORD } from './note-text.js';
import { ITEM_SEPARATOR, fieldOf, notePart, part } from './note-format.js';

// The foes of a planned fight, as written ('' for a record that is not one).
export function encounterOf(record) {
    return fieldOf(record, 'encounter');
}

// "Ambush at the weir (Haywane 14) (fight: 3 bandit, bandit captain (boss))": a due fight
// says who is coming, so the storyteller can bring them on.
export function withFight(item, record) {
    const foes = encounterOf(record);
    return foes ? `${item} (fight: ${foes})` : item;
}

// (0.9.19) "… · reach: the inn shuts for repairs": what a due beat changes for {{user}} wherever
// they are, so a story away from it has concrete aftermath to show rather than nothing. Due
// now only: a beat still ahead keeps its reach off the Beats line, so the note stays short and
// the story is not handed an aftermath before the beat has happened.
export function withReach(item, record) {
    const reach = fieldOf(record, 'reach');
    return reach ? `${item}${ITEM_SEPARATOR}reach: ${reach}` : item;
}

// The compact form for the kind lines: the fight is planned, not happening yet.
export function fightPart(record) {
    const foes = encounterOf(record);
    return foes ? `${ITEM_SEPARATOR}fight: ${foes}` : '';
}

// The arc is carried by its beats (0.9.3): its name and what it is about head the Beats line,
// "Beats — The Weir Debt (who sold the route): Toll riders reach the ford (Goldwane 19)", so
// the note has no separate arc line to weigh against them. With every beat due (on Due now)
// or none left, the line is the arc alone.
export function addBeats(parts, arc, items) {
    const present = items.filter(Boolean);
    if (!arc) {
        addLine(parts, 'Beats', present);
        return;
    }
    const desc = notePart(fieldOf(arc, 'desc'), 'desc');
    const head = `Beats — ${arc.key}${desc ? ` (${desc})` : ''}`;
    parts.push(part('Beats', present.length ? `${head}: ${present.join(ITEM_SEPARATOR)}` : head));
}

export function addLine(parts, label, items, separator = ITEM_SEPARATOR) {
    const present = items.filter(Boolean);
    if (present.length) parts.push(part(label, `${label}: ${present.join(separator)}`));
}

// The record's fields as the note writes them, each within its word limit. The leg stays
// whole: only its destination is shown, and it is read from the full text.
export function noteFields(record) {
    const fields = record?.fields ?? {};
    return Object.fromEntries(Object.entries(fields).map(([name, value]) => [name, name === 'leg' ? value : notePart(value, name)]));
}

// "Saartje's sale (Goldwane 16)", or with what is meant to happen: "Geva — files the warrant (Goldwane 17)".
export function dueItem(record, clock = text => text) {
    const f = noteFields(record);
    // (0.9.28) The work done and only the pay left, its time is when the pay can be had.
    if (record.kind === 'quest' && waitsForPay(record)) return payItem(record, clock);
    // A quest's due is its deadline: reaching it means time ran out.
    if (record.kind === 'quest') return `${record.key} — deadline${f.due ? ` ${clock(f.due)}` : ''} reached${f.goal ? ` (${f.goal})` : ''}`;
    const when = record.kind === 'clock' ? f.due || f.on : f.on || f.due;
    const what = f.then || (record.kind === 'clock' ? f.desc : '');
    return `${record.key}${what ? ` — ${what}` : ''}${when ? ` (${when})` : ''}`;
}

// (0.9.19) "While away (Goldwane 12, 08:00 pm → Goldwane 15, 07:00 am): Stray Oar — sacked
// (Goldwane 13) · Bond collector reached Hollin's Reach (Goldwane 14) · Bounty — deadline
// Goldwane 14, 11:59 pm passed. Show what came of them …". A planned fight in the gap was fought
// off-screen. '' with nothing in the gap.
export function awayPart(away, calendar, clock, instruction) {
    const items = [
        // A beat's reach is the aftermath to show: most needed here, where it happened unseen.
        ...(away?.due ?? []).map(record => withReach(withAwayFight(awayDueItem(record, clock), record), record)),
        ...(away?.arriving ?? []).filter(record => !(away?.due ?? []).includes(record)).map(record => withAwayFight(arrivalItem(record, 'reached'), record)),
    ].filter(Boolean);
    if (!items.length) return '';
    const span = `${calendar.format(away.from, { era: false })} → ${calendar.format(away.to, { era: false })}`;
    const record = instruction
        ? [AWAY_RECORD, away.arriving?.length ? AWAY_ARRIVAL : '', (away.due ?? []).some(entry => entry.kind === 'quest' && !waitsForPay(entry)) ? AWAY_DEADLINE : '']
        : [];
    const list = items.join(ITEM_SEPARATOR);
    // A list ending in a trimmed part ("…") needs no full stop after it.
    return [`While away (${span}): ${list}${/[.…]$/u.test(list) ? '' : '.'}`, AWAY_CUE, ...record].filter(Boolean).join(' ');
}

// A due item as it reads in the past: a quest's deadline "passed", not "reached".
// "Lone Grey Wolf — pay waiting from Goldwane 14, 12:00 pm (turn in voucher at the bailiff hatch);
// the work is done, the hour fails nothing".
export function payItem(record, clock) {
    const f = noteFields(record);
    const step = f.step || f.now;
    return `${record.key} — pay waiting${f.due ? ` from ${clock(f.due)}` : ''}${step ? ` (${step})` : ''}; the work is done, the hour fails nothing`;
}

export function awayDueItem(record, clock) {
    if (record.kind !== 'quest' || waitsForPay(record)) return dueItem(record, clock);
    const f = noteFields(record);
    return `${record.key} — deadline${f.due ? ` ${clock(f.due)}` : ''} passed${f.goal ? ` (${f.goal})` : ''}`;
}

export function withAwayFight(item, record) {
    const foes = encounterOf(record);
    return foes ? `${item} (fought off-screen: ${foes})` : item;
}

// "Courier arrives Varnhold Watch (Goldwane 16, morning)".
export function arrivalItem(record, verb = 'arrives') {
    const f = noteFields(record);
    const where = destination(f.leg);
    // With nowhere to reach, an arrival in the past just "arrived".
    const said = where ? verb : verb === 'reached' ? 'arrived' : verb;
    return `${record.key} ${said}${where ? ` ${where}` : ''}${f.arrive ? ` (${f.arrive})` : ''}`;
}

// "Geva — Bailiff Court → files the warrant (Goldwane 17)",
// "Hollin's Reach graves — the dead rise (Goldwane 28) · shown: sign".
// "Bounty on Kettle Jack — bring him in alive · at: cornered at the weir · for Warden Hale · 40 crowns · by Haywane 30".
export function questItem(record, clock = text => text) {
    const f = noteFields(record);
    const parts = [f.goal || f.desc, f.step ? `at: ${f.step}` : '', f.giver ? `for ${f.giver}` : '', f.reward, f.due ? `by ${clock(f.due)}` : '']
        .map(part => String(part ?? '').trim())
        .filter(Boolean);
    // A normal difficulty goes without saying; a set one rides with the type: "(bounty, hard)".
    const difficulty = questDifficulty(f.difficulty);
    const tags = [String(f.type ?? '').trim(), difficulty === 'normal' ? '' : difficulty].filter(Boolean);
    return record.key + (tags.length ? ` (${tags.join(', ')})` : '') + (parts.length ? ` — ${parts.join(ITEM_SEPARATOR)}` : '') + fightPart(record);
}

export function recordItem(record, clock) {
    if (record.kind === 'quest') return questItem(record, clock);
    const f = noteFields(record);
    const body = [];
    const state = f.now || f.desc;
    if (state) body.push(state);
    const when = record.kind === 'clock' ? f.due : f.on;
    if (f.then) body.push(`${state ? '→ ' : ''}${f.then}${when ? ` (${when})` : ''}`);
    if (f.arrive) {
        const where = destination(f.leg);
        body.push(`${body.length ? '→ ' : ''}arrives${where ? ` ${where}` : ''} (${f.arrive})`);
    }

    let item = record.key + (body.length ? ` — ${body.join(' ')}` : '');
    // With no then, the date belongs to the record itself (a beat's on, a clock's due).
    if (when && !f.then) item += ` (${when})`;
    if (record.kind === 'clock' && f.shown && !/^none$/i.test(f.shown.trim())) item += `${ITEM_SEPARATOR}shown: ${f.shown}`;
    return item + fightPart(record);
}

// The far end of a one-hop leg: "Shorn → Varnhold Watch 35 B, courier 70/day → 0.5" gives
// "Varnhold Watch" (the distance, road code and pace after it are not a place).
export function destination(leg) {
    const hops = String(leg ?? '').split(/\s*(?:→|->)\s*/);
    if (hops.length < 2) return '';
    return hops[1].split(',')[0].replace(/\s+\d.*$/, '').trim();
}
