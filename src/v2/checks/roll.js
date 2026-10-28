// Standalone and NPC social modifiers for a check.

import { topicsOf } from './words.js';

export const MOD_LIMIT = 30;
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isInt = value => Number.isSafeInteger(value);
const clip = (text, max) => String(text ?? '').slice(0, max);

/** The standalone subtotal: bonuses[stat] (default 0) and each distinct matching `topic:<name>` once. → parts. */
export function standaloneParts(actor, stat, skill) {
    const bonuses = isRecord(actor?.bonuses) ? actor.bonuses : {};
    const parts = [];
    if (isInt(bonuses[stat]) && bonuses[stat] !== 0) parts.push({ source: 'standalone', ref: stat, reason: `${stat} bonus`, amount: bonuses[stat] });
    for (const topic of topicsOf(skill)) {
        const key = `topic:${topic}`;
        if (isInt(bonuses[key]) && bonuses[key] !== 0) parts.push({ source: 'standalone', ref: key, reason: `${topic} bonus`, amount: bonuses[key] });
    }
    return parts;
}

/** NPC State Delta's `npc.socialModifier` answer as parts (one per reason), or [] when it has none. */
export function socialParts(answer) {
    if (!isRecord(answer) || !isInt(answer.mod) || answer.mod === 0 || !Array.isArray(answer.reasons)) return [];
    const parts = answer.reasons.filter(reason => isRecord(reason) && isInt(reason.value) && reason.value !== 0)
        .map(reason => ({ source: 'social', ref: null, reason: clip(reason.text, 120) || 'how they feel about you', amount: reason.value }));
    // A modifier whose reasons do not add up to it is kept whole as one part, so the parts always sum to what NSD said.
    return parts.reduce((sum, part) => sum + part.amount, 0) === answer.mod ? parts : [{ source: 'social', ref: null, reason: clip(`${answer.name ?? 'they'} ${answer.skill ?? ''}`.trim(), 120) || 'how they feel about you', amount: answer.mod }];
}

/** Clamps the parts' sum to the limit with a `cap` part: → { parts, mod }. */
export function combine(parts) {
    const sum = parts.reduce((total, part) => total + part.amount, 0);
    const mod = Math.max(-MOD_LIMIT, Math.min(MOD_LIMIT, sum));
    return mod === sum ? { parts, mod } : { parts: [...parts, { source: 'cap', ref: null, reason: `held to ${MOD_LIMIT}`, amount: mod - sum }], mod };
}
