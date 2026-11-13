// Story Director v2, chronicle part: the factions (moved out of capture.js unchanged; capture.js re-exports the
// public names): `faction` lines and their summaries. A safety-net line (`ctx.carrier.assist`, rule mark `assistFaction`) never sets an existing faction's stance.

import { MAX_FACTIONS, cleanName, cleanSummary, findIn, isRecord, keyOf, newId, revOf } from '../domain.js';
import { CLEAR, asText, labelOf, lineText, sentence } from './text.js';

export function changeFaction(faction, fields, rev) {
    const changes = [];
    for (const field of ['summary', 'area', 'stance']) {
        if (fields[field] === undefined || fields[field] === faction[field]) continue;
        faction[field] = fields[field];
        changes.push(field);
    }
    if (changes.length) faction.rev = rev;
    return changes;
}

function factionSummary(faction) {
    const about = [faction.area && `in ${faction.area}`, faction.stance].filter(Boolean).join(', ');
    return sentence(`Faction: ${faction.name}${about ? ` (${about})` : ''}${faction.summary ? ` — ${faction.summary}` : ''}.`);
}

const optionalText = value => (value === undefined ? undefined : CLEAR.test(asText(value).trim()) ? '' : cleanName(value));

/** `apply(ctx, line)` for `faction` lines. */
export function applyFactionLine(ctx, line) {
    const op = line?.op;
    if (!['+', '~', '-', '!'].includes(op)) return ctx.fail('INVALID', `"${lineText(line)}": faction lines use +, ~ or -.`);
    const name = cleanName(line?.name);
    if (!keyOf(name)) return ctx.fail('INVALID', `"${lineText(line)}" names no faction.`);
    const labels = isRecord(line?.labels) ? line.labels : {};
    const chronicle = ctx.draft('chronicle');
    const found = findIn(chronicle.factions, name);
    const rev = revOf(ctx);

    if (op === '-') {
        if (!found) return ctx.fail('NOT_FOUND', `There is no faction "${name}" in the chronicle.`);
        delete chronicle.factions[found.id];
        const why = cleanSummary(line?.text);
        return { summary: `Faction: ${found.name} is gone${why ? ` — ${why}` : ''}.`, narrate: false, data: { faction: found.id, removed: true } };
    }

    const fields = {
        summary: asText(line?.text).trim() ? cleanSummary(line.text) : undefined,
        area: optionalText(labelOf(labels, ['area', 'region', 'where', 'territory', 'holds'])),
        stance: optionalText(labelOf(labels, ['stance', 'toward', 'towards', 'attitude'])),
    };
    if (!found) {
        if (Object.keys(chronicle.factions).length >= MAX_FACTIONS) return ctx.fail('REFUSED', `The chronicle already keeps ${MAX_FACTIONS} factions; remove one first.`);
        const id = newId(ctx, 'fa', chronicle.factions);
        const faction = { id, name, summary: fields.summary ?? '', area: fields.area ?? '', stance: fields.stance ?? '', aka: [], rev };
        chronicle.factions[id] = faction;
        return { summary: factionSummary(faction), narrate: false, data: { faction: id, created: true } };
    }
    const faction = chronicle.factions[found.id];
    // The Assist safety net's line never sets the stance of a faction the chronicle already keeps (it is the story's and the reader's to move). Only a
    // reply carrying Story Block's `assistFaction` rule mark (`ctx.carrier.rules`); an older reply keeps what its Re-read did.
    if (ctx.carrier?.assist && Array.isArray(ctx.carrier.rules) && ctx.carrier.rules.includes('assistFaction')) fields.stance = undefined;
    const changes = changeFaction(faction, fields, rev);
    return { summary: changes.length ? factionSummary(faction) : `Faction: ${faction.name} is unchanged.`, narrate: false, data: { faction: faction.id } };
}

/**
 * The factions a `world` line's `factions:` names that the chronicle does not know yet (no name or aka match), added on the draft:
 * name, summary "Seen in: <event>", area the event's place, no stance. Only for a story line on a reply that carries Story Block's
 * `factionTags` rule mark (`ctx.carrier.rules`); a reply recorded before it keeps its chronicle as it was on a Re-read. Past
 * MAX_FACTIONS the rest are skipped quietly. Returns the names made.
 */
export function tagFactions(ctx, chronicle, names, event) {
    const marked = Array.isArray(ctx.carrier?.rules) && ctx.carrier.rules.includes('factionTags');
    if (!marked || ctx.cause !== 'story' || !Array.isArray(names)) return [];
    const made = [];
    for (const name of names) {
        if (findIn(chronicle.factions, name) || Object.keys(chronicle.factions).length >= MAX_FACTIONS) continue;
        const id = newId(ctx, 'fa', chronicle.factions);
        chronicle.factions[id] = { id, name, summary: cleanSummary(`Seen in: ${event.name}`), area: event.place ?? '', stance: '', aka: [], rev: revOf(ctx) };
        made.push(name);
    }
    return made;
}
