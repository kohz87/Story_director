// Story Director: reading and checking the model's one-hop `leg:` lines (pure).
//
// parseLeg reads the line, validateLeg checks it against the pack and offers a corrected leg
// in the same grammar. Split out of routes.js, which still re-exports every name it exported
// before.

import { DAY_MINUTES, addDays, num, positive, tidy, toAbs } from './util.js';
import { EPSILON, KM_TOLERANCE, MODERN_ALIASES, MODERN_MODES, MODES, MODE_ALIASES, edgesBetween, exitsFrom, findPlace, normalizeMode, resolvePlace } from './pack.js';
import { acceptedRange, bestEdge, codeName, hopDays, inferMode, paceFor, planRoute, restDaysFor, search } from './plan.js';
import { capitalize, dateText, durationText, exitsText, formatLeg, hopText, rangeText, rateWords, roadName, routeText, toleranceFor, unitOf } from './text.js';

// ---------------------------------------------------------------------------------------
// Legs

const ARROW = /\s*(?:→|⟶|➔|->|=>)\s*/u;
const BRACKETED = /\(([^()]*(?:→|⟶|➔|->|=>)[^()]*)\)/u;
const RATE = /(\d+(?:\.\d+)?)\s*(?:km\s*)?(?:\/\s*(day|d|h|hr|hour)\b|(?:a|an|per)\s+(day|hour)\b|(kph))/i;
const KM_CODE = /(?<![\d.])(\d+(?:\.\d+)?)\s*(?:km\b\.?)?\s*(?:([A-Z]{1,3})(?![\p{L}\p{N}]))?/u;
const modeWord = words => new RegExp(`(?<![\\p{L}])(${words.sort((a, b) => b.length - a.length).join('|')})(?![\\p{L}])`, 'iu');
const MODE_WORD = modeWord([...MODES, ...Object.keys(MODE_ALIASES)]);
const MODERN_MODE_WORD = modeWord([...MODERN_MODES, ...Object.keys(MODERN_ALIASES)]);
// "→ 2.5 h", "→ 45 min", "→ 1.5 days", or a bare number in the pack's unit.
const DURATION = /^(\d+(?:\.\d+)?)\s*(min(?:ute)?s?|h(?:rs?|ours?)?|d(?:ays?)?)?(?![\p{L}])/iu;

/**
 * Reads a `leg:` value: `Shorn → Varnhold Watch 35 B, courier 70/day → 0.5`, also `->`,
 * `to`, and the legacy `(Shorn → Auvoth, 130 km B)`. Unknown pieces are null; the raw place
 * texts are kept in `fromText`/`toText` for messages. Null when there is no `from → to`.
 */
export function parseLeg(pack, text) {
    if (typeof text !== 'string' || !text.trim()) return null;
    let body = text.replace(/[*_`]+/g, '').replace(/[’‘]/g, '\'').split(' | ')[0];
    body = body.replace(/^\s*leg\s*:\s*/i, '');
    const bracketed = BRACKETED.exec(body);
    if (bracketed) body = bracketed[1];
    body = body.trim();

    let parts = body.split(ARROW);
    if (parts.length < 2) {
        const to = /\s+to\s+/i.exec(body);
        if (!to) return null;
        parts = [body.slice(0, to.index), body.slice(to.index + to[0].length)];
    }
    const [fromText, middle, ...tail] = parts.map(part => part.trim());

    // The destination is the text before the numbers ("Varnhold Watch 35 B, …").
    const toText = /^[^\d,]*/.exec(middle)[0].trim();
    let rest = middle.slice(toText.length);

    let rate = null;
    const rateMatch = RATE.exec(rest);
    if (rateMatch) {
        rate = Number(rateMatch[1]);
        rest = rest.slice(0, rateMatch.index) + rest.slice(rateMatch.index + rateMatch[0].length);
    }
    const words = pack?.era === 'modern' ? MODERN_MODE_WORD : MODE_WORD;
    const modeMatch = words.exec(rest) ?? words.exec(tail.join(' '));
    const mode = modeMatch ? normalizeMode(modeMatch[1], pack) : null;

    const kmMatch = KM_CODE.exec(rest);
    // Days, whatever unit the leg wrote its time in.
    const durationMatch = DURATION.exec(tail[0] ?? '');
    const hourly = pack?.era === 'modern';
    const unit = (durationMatch?.[2] ?? '').toLowerCase();
    const perDay = /^min/.test(unit) ? 1440 : /^h/.test(unit) ? 24 : /^d/.test(unit) ? 1 : hourly ? 24 : 1;
    const days = durationMatch ? Number(durationMatch[1]) / perDay : null;

    const place = (raw, whole) => {
        if (!pack) return raw || null;
        return resolvePlace(pack, raw) ?? (whole ? findPlace(pack, whole) : null);
    };
    return {
        text,
        from: place(fromText),
        to: place(toText, middle),
        km: kmMatch ? Number(kmMatch[1]) : null,
        code: kmMatch?.[2] ?? null,
        mode,
        rate,
        days,
        fromText,
        toText: toText || middle,
    };
}

/**
 * Checks one leg against the pack. Findings are `{ kind, severity, key: null, message }`,
 * with `correction` (the right leg in the line grammar) whenever one can be given.
 *
 * Without a direct road, whether the leg is `leg-not-one-hop` or `leg-no-edge` depends on
 * the leg's mode (stated, or inferred from its code: W boat, S/D ship, A flight, else foot)
 * and, when the leg names a road code, on that code: the leg described one road, so a path
 * counts only if every hop is that code. `Bluewatch Village → Siltbarrow 130 L` has no L road
 * out of Bluewatch, so it is no-edge (with the exits), though a long foot path exists; the
 * same leg with no code, on foot, is not-one-hop.
 *
 * Beyond the contract's kinds: `leg-code` (warn, the code differs from the road's),
 * `leg-rate` (warn, a stated rate outside the pace range) and `leg-days` (warn, stated days
 * off by more than half a day). Days, rate and arrival are only checked when the leg states
 * a mode or a rate; a bare `130 km B` says nothing about speed.
 */
export function validateLeg(pack, leg, { from = null, depart = null, arrive = null, calendar = null } = {}) {
    if (typeof leg === 'string') leg = parseLeg(pack, leg);
    if (!pack || !leg) return [];
    const findings = [];
    const start = toAbs(depart, calendar);
    const ctx = { pack, calendar, start, legRate: positive(leg.rate) };

    if (!leg.from || !leg.to) {
        const unknown = [!leg.from && (leg.fromText || 'the start'), !leg.to && (leg.toText || 'the destination')]
            .filter(Boolean).map(name => `"${name}"`);
        let message = `${unknown.join(' and ')} ${unknown.length > 1 ? 'are' : 'is'} not in the world pack.`;
        if (leg.from) message += ` ${exitsText(pack, leg.from)}`;
        findings.push(finding('leg-unknown-place', 'warn', message));
        return findings;
    }

    const origin = from ? resolvePlace(pack, from) : null;
    const statedMode = normalizeMode(leg.mode, pack);
    if (origin && origin !== leg.from) {
        const mode = statedMode ?? inferMode(leg.code, pack);
        const plan = planRoute(pack, origin, leg.to, { mode });
        const hop = plan?.hops[0];
        findings.push(finding('leg-wrong-start', 'error',
            `The leg starts at ${leg.from}, but the traveller is at ${origin}.`
            + (hop ? ` First leg from ${origin}: ${hopText(hop)}.` : ''),
            hop ? correctionFor({ ...ctx, hop, mode }).text : null));
        return findings;
    }
    if (leg.from === leg.to) return findings;

    const direct = edgesBetween(pack, leg.from, leg.to);
    const mode = statedMode ?? inferMode(leg.code ?? direct[0]?.code, pack);

    if (!direct.length) {
        const onCode = leg.code ? edge => edge.code === leg.code : null;
        if (!search(pack, leg.from, leg.to, mode, onCode)) {
            const road = leg.code ? `${leg.code} road` : `road ${mode === 'foot' ? 'on foot' : `by ${mode}`}`;
            const result = finding('leg-no-edge', 'error',
                `No ${road} from ${leg.from} to ${leg.to}. ${exitsText(pack, leg.from)}`);
            result.exits = exitsFrom(pack, leg.from);
            findings.push(result);
            return findings;
        }
        const plan = planRoute(pack, leg.from, leg.to, { mode });
        const hop = plan.hops[0];
        const result = finding('leg-not-one-hop', 'error',
            `${leg.from} → ${leg.to} is not one hop: ${routeText(plan)} (${num(plan.km)} km). First leg: ${hopText(hop)}.`,
            correctionFor({ ...ctx, hop, mode }).text);
        result.firstHop = { from: hop.from, to: hop.to, km: hop.km, code: hop.code, corridor: hop.corridor };
        result.path = plan;
        findings.push(result);
        return findings;
    }

    const named = leg.code ? direct.filter(edge => edge.code === leg.code) : [];
    const edge = bestEdge(pack, named.length ? named : direct, mode);
    if (!edge) {
        // The road exists but not for this mode: another road between the two, or the
        // first hop of a path the mode can take.
        const other = bestEdge(pack, direct, mode);
        const plan = other ? null : planRoute(pack, leg.from, leg.to, { mode });
        const hop = other ? toHop(other, leg.from) : plan?.hops[0];
        const road = direct.find(candidate => !leg.code || candidate.code === leg.code);
        const result = finding('leg-mode', 'error',
            `${capitalize(mode)} cannot use ${roadName(road)} from ${leg.from} to ${leg.to}.`
            + (hop ? ` Instead: ${hopText(hop)}${plan ? ` (${num(plan.km)} km in all)` : ''}.` : ''),
            hop ? correctionFor({ ...ctx, hop, mode }).text : null);
        if (plan) result.path = plan;
        findings.push(result);
        return findings;
    }

    const hop = toHop(edge, leg.from);
    const fix = correctionFor({ ...ctx, hop, mode, rateOk: statedMode ? null : true });
    if (leg.code && !named.length) {
        findings.push(finding('leg-code', 'warn',
            `The road from ${leg.from} to ${leg.to} is ${edge.code} (${codeName(pack, edge.code)}), not ${leg.code}.`, fix.text));
    }
    if (leg.km !== null && leg.km !== undefined && Math.abs(leg.km - edge.km) > KM_TOLERANCE * edge.km) {
        findings.push(finding('leg-km', 'warn',
            `${leg.from} → ${leg.to} is ${num(edge.km)} km, not ${num(leg.km)}.`, fix.text));
    }
    if (!statedMode && !ctx.legRate) return findings;

    const unit = unitOf(pack);
    if (statedMode && ctx.legRate && !fix.rateInRange) {
        findings.push(finding('leg-rate', 'warn',
            `${capitalize(mode)} on ${edge.code} goes ${rangeText(fix.range)} ${rateWords(unit)}, not ${num(ctx.legRate)}.`, fix.text));
    }
    const tolerance = toleranceFor(fix.days, unit);
    if (leg.days !== null && leg.days !== undefined
        && Math.abs(leg.days - fix.days) > tolerance && Math.abs(leg.days - fix.activeDays) > tolerance) {
        findings.push(finding('leg-days', 'warn',
            `${num(edge.km)} km at ${num(fix.rate)} ${rateWords(unit)} is ${durationText(fix.days, unit)}, not ${durationText(leg.days, unit)}.`, fix.text));
    }
    if (fix.arrive !== null) {
        const gap = arrivalGap(fix.arrive, arrive, calendar);
        if (gap !== null && gap > tolerance) {
            findings.push(finding('leg-arrive', 'warn',
                `Arrival ${dateText(arrive, calendar)} is ${durationText(gap, unit)} off: `
                + `${durationText(fix.days, unit)} from ${dateText(start, calendar)} is ${dateText(fix.arrive, calendar)}.`, fix.text));
        }
    }
    return findings;
}

function finding(kind, severity, message, correction = null) {
    const result = { kind, severity, key: null, message };
    if (correction) result.correction = correction;
    return result;
}

// The corrected leg for one hop: the stated rate when it fits the pace, else the pace.
function correctionFor({ pack, calendar, start, legRate, hop, mode, rateOk = null }) {
    const pace = paceFor(pack, hop.code, mode, { corridor: hop.corridor });
    const range = acceptedRange(pack, hop, mode) ?? pace;
    const rateInRange = Boolean(legRate && range && legRate >= range.low - EPSILON && legRate <= range.high + EPSILON);
    const rate = legRate && (rateInRange || rateOk) ? legRate : pace?.rate ?? legRate;
    const activeDays = rate > 0 ? hopDays(pack, hop, mode, rate) : null;
    const days = tidy(activeDays + restDaysFor(mode, activeDays, pack.rules));
    const arrive = start === null ? null : addDays(start, days, calendar);
    const text = formatLeg(hop, { mode, rate, days, arrive, calendar, unit: unitOf(pack) });
    return { text, rate, range, rateInRange, activeDays, days, arrive };
}

function toHop(edge, from) {
    return { from, to: edge.a === from ? edge.b : edge.a, km: edge.km, code: edge.code, corridor: edge.corridor };
}

// How far (in days) a stated arrival is from the computed one. A date without a time
// covers its whole day.
function arrivalGap(expected, arrive, calendar) {
    if (typeof arrive === 'number' && Number.isFinite(arrive)) return Math.abs(arrive - expected) / DAY_MINUTES;
    if (typeof arrive !== 'string' || !calendar) return null;
    const parsed = calendar.parse(arrive, { reference: expected });
    if (!parsed) return null;
    if (parsed.hasTime) return Math.abs(parsed.abs - expected) / DAY_MINUTES;
    const dayStart = Math.floor(parsed.abs / DAY_MINUTES) * DAY_MINUTES;
    if (expected < dayStart) return (dayStart - expected) / DAY_MINUTES;
    if (expected > dayStart + DAY_MINUTES) return (expected - dayStart - DAY_MINUTES) / DAY_MINUTES;
    return 0;
}
