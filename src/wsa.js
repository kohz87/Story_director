// Importing a World State Alpha export.
//
// World State Alpha keeps two kinds of record: facts (true now) and developments (ongoing, with
// a trend). Both are things happening in the world, so both become `event` records here. A
// record has no title, only a summary, so the key is the summary's first clause; the anchors
// (people and places it involves) go into `people`, which is what relevance matches against.
// Only active records come over: resolved and superseded ones are history the story already
// moved past. Pure.

import { lineKey } from './changes.js';

const FORMAT = 'world_state_alpha_bundle';
const KEY_WORDS = 7;

// "Armed men claiming ditch-watch authority are demanding a raised ditch tax; villagers avoid
// the lane" → "Armed men claiming ditch-watch authority are demanding".
function keyOf(summary) {
    const clause = String(summary ?? '').split(/\s+[—–]\s+|[;:.]\s|,\s+(?=(?:and|but|while|so)\b)/)[0].trim();
    const words = clause.split(/\s+/).filter(Boolean);
    return (words.length > KEY_WORDS ? words.slice(0, KEY_WORDS) : words).join(' ').replace(/[,.;:]+$/, '');
}

// A key's own separators would split the change line, so they are softened.
const clean = text => String(text ?? '').replace(/\s*\|\s*/g, ' / ').replace(/\s+/g, ' ').trim();

/**
 * A World State Alpha bundle (JSON text or object) as `+ event` ops:
 * { ops, counts: { facts, developments, skipped }, errors }.
 */
export function importWorldStateAlpha(input) {
    let bundle = input;
    if (typeof input === 'string') {
        try {
            bundle = JSON.parse(input);
        } catch {
            return { ops: [], counts: { facts: 0, developments: 0, skipped: 0 }, errors: ['That is not valid JSON.'] };
        }
    }
    if (!bundle || bundle.format !== FORMAT || !Array.isArray(bundle.state?.records)) {
        return { ops: [], counts: { facts: 0, developments: 0, skipped: 0 }, errors: ['That is not a World State Alpha export (world_state_alpha_bundle).'] };
    }

    const ops = [];
    const counts = { facts: 0, developments: 0, skipped: 0 };
    const used = new Set();
    for (const record of bundle.state.records) {
        if (record?.status !== 'active' || !String(record.summary ?? '').trim()) {
            counts.skipped += 1;
            continue;
        }
        let key = clean(keyOf(record.summary)) || 'World record';
        // Two summaries can open alike; keys must stay apart.
        for (let n = 2; used.has(lineKey(key)); n++) key = `${clean(keyOf(record.summary))} (${n})`;
        used.add(lineKey(key));

        // A short summary is its own key; repeating it as the description says nothing new.
        const fields = lineKey(key) === lineKey(record.summary) ? {} : { desc: clean(record.summary) };
        const anchors = (Array.isArray(record.anchors) ? record.anchors : []).map(clean).filter(Boolean);
        if (anchors.length) fields.people = anchors.join(', ');
        const extra = {};
        if (record.kind === 'development') {
            counts.developments += 1;
            if (record.trend) extra.trend = String(record.trend);
        } else {
            counts.facts += 1;
            extra.settled = 'yes';
        }
        if (record.timeAnchor) extra.since = clean(record.timeAnchor);
        ops.push({ op: '+', kind: 'event', key, id: lineKey(key), fields, extra, reason: '', raw: '' });
    }
    return { ops, counts, errors: [] };
}
