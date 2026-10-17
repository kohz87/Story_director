// Travel checks over the tracker, with a world pack.
//
// Every active record that carries a `leg:` is a party on the road. The model writes the leg
// and its arrival; code checks them against the pack: is it one road, from where the party
// actually is, at a pace the road allows, arriving when that pace says? Anything wrong comes
// back as a finding with the corrected leg, which the note hands to the model next reply.
//
// Where a party starts is taken only from facts: the end of its previous leg, or its `place`
// field. The free text of `now` is not used ("on the road to Auvoth" names the destination,
// not the start), so a missing start means the start is not checked, never a false error.

import { exitsFrom, findPlace, parseLeg, validateLeg } from './routes.js';
import { activeRecords, findRecord } from './tracker.js';

function legEnd(pack, text) {
    if (!text) return null;
    return parseLeg(pack, text)?.to ?? null;
}

function startOf(pack, record, previousRecord) {
    // A new leg starts where the last one ended.
    if (previousRecord?.fields?.leg && previousRecord.fields.leg !== record.fields.leg) {
        const end = legEnd(pack, previousRecord.fields.leg);
        if (end) return end;
    }
    return record.fields.place ? findPlace(pack, record.fields.place) : null;
}

/**
 * Findings for legs in `tracker`: [{ kind, severity, key, id, message, correction? }].
 * With `onlyChanged`, only legs (or arrivals) that differ from `previous` are checked, as the
 * reply that wrote them is the one to blame.
 */
export function travelFindings(tracker, { pack, calendar = null, previous = null, onlyChanged = false } = {}) {
    if (!pack || !tracker) return [];
    const findings = [];
    for (const record of activeRecords(tracker)) {
        if (!record.fields.leg) continue;
        const before = previous ? findRecord(previous, record.id) : null;
        if (onlyChanged && before
            && before.fields.leg === record.fields.leg
            && before.fields.arrive === record.fields.arrive) continue;

        const leg = parseLeg(pack, record.fields.leg);
        if (!leg) {
            findings.push({ kind: 'leg-unreadable', severity: 'info', key: record.key, id: record.id, message: `${record.key}: the leg "${record.fields.leg}" could not be read` });
            continue;
        }
        const depart = record.legSince?.time ?? null;
        const parsedArrive = record.fields.arrive && calendar
            ? calendar.parse(record.fields.arrive, { reference: depart ?? tracker.time ?? null })
            : null;
        const results = validateLeg(pack, leg, {
            from: startOf(pack, record, before),
            depart,
            arrive: parsedArrive?.abs ?? null,
            calendar,
        });
        for (const result of results) {
            findings.push({ ...result, key: record.key, id: record.id, message: `${record.key}: ${result.message}` });
        }
    }
    return findings;
}

/** Corrections for the note: `Key — leg …`, one per record, from findings that carry one. */
export function corrections(findings) {
    const seen = new Set();
    const lines = [];
    for (const finding of findings ?? []) {
        if (!finding.correction || seen.has(finding.id ?? finding.key)) continue;
        seen.add(finding.id ?? finding.key);
        lines.push(`${finding.key} — leg ${finding.correction}`);
    }
    return lines;
}

// Roads that make a place "nearby": short and overland. Sea lanes, flights and seasonal
// expeditions can join places thousands of km apart in one hop.
const FAR_CODES = new Set(['S', 'D', 'A', 'X']);

/** The scene's place and the places one short road away, for relevance ("one hop away"). */
export function nearbyPlaces(pack, place, { maxKm = 150 } = {}) {
    if (!pack || !place) return [];
    const here = findPlace(pack, place);
    if (!here) return [];
    const near = exitsFrom(pack, here).filter(exit => exit.km <= maxKm && !FAR_CODES.has(exit.code)).map(exit => exit.to);
    return [...new Set([here, ...near])];
}
