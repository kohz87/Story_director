// Story Director: whether an offer's giver is in the scene (pure).
//
// (0.9.34) Taking a job on is done in front of whoever offers it: the Quests tab's Take on is
// there while the giver is in the scene, read from the scene block's "NPCs Present" (Story
// Block's World State), else NPC State Delta's present cast, else the latest reply naming them.
// (0.9.35) The tab only asks before taking a job on away from its giver; turning one down needs no one.

// Titles and kinship words that do not tell one giver from another ("Brother Aldo" is Aldo).
const TITLES = new Set([
    'the', 'of', 'for', 'and', 'old', 'young', 'master', 'mistress', 'brother', 'sister', 'father', 'mother', 'lord', 'lady',
    'sir', 'dame', 'captain', 'watch', 'reeve', 'factor', 'elder', 'priest', 'priestess', 'guildmaster', 'miller', 'mayor',
    'magistrate', 'sergeant', 'chief', 'king', 'queen', 'prince', 'princess', 'baron', 'baroness', 'mr', 'mrs', 'ms', 'goodwife', 'goodman',
]);

const words = text => String(text ?? '').toLowerCase().normalize('NFKC').split(/[^\p{L}\p{N}'-]+/u).filter(Boolean);

/**
 * The names a giver goes by: "Elke (for Watch-Captain)" → ['elke']; "Reeve Hollis" →
 * ['hollis', 'reeve hollis']; a giver that is only a title ("the quarry master") keeps it.
 */
export function giverNames(giver) {
    const own = String(giver ?? '').split(/[,(;—–]/)[0].trim();
    if (!own) return [];
    const all = words(own);
    const names = all.filter(word => word.length >= 3 && !TITLES.has(word));
    const whole = all.join(' ');
    return [...new Set([...(names.length ? names : [whole]), ...(all.length > 1 ? [whole] : [])])].filter(Boolean);
}

/** The scene block's "NPCs Present" part, '' when it has none (its Off-Screen list never counts). */
export function presentPart(sceneText) {
    const text = String(sceneText ?? '');
    const start = text.search(/NPCs?\s+Present/i);
    if (start < 0) return '';
    const rest = text.slice(start);
    const end = rest.slice(1).search(/\n\s*-{3,}\s*\n|Off-?Screen|Scene Phase/i);
    return end < 0 ? rest : rest.slice(0, end + 1);
}

const names = (text, name) => new RegExp(`(?<![\\p{L}\\p{N}])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')}(?![\\p{L}\\p{N}])`, 'iu').test(text);

/**
 * Whether `giver` is in the scene, from the first source there is, in this order (0.9.36): the
 * scene block's NPCs Present (`scene`), NPC State Delta's present cast (`present`: names), the
 * latest reply naming them (`reply`). True or false from that source; null when there is no
 * giver to look for (no check then).
 */
export function giverPresent(giver, { scene = '', present = null, reply = '' } = {}) {
    const list = giverNames(giver);
    if (!list.length) return null;
    const board = presentPart(scene);
    if (board) return list.some(name => names(board, name));
    const cast = (Array.isArray(present) ? present : []).map(name => String(name ?? '').trim()).filter(Boolean);
    if (cast.length) return list.some(name => cast.some(member => names(member, name)));
    return list.some(name => names(String(reply ?? ''), name));
}

// (0.9.37) Where a job was offered, and whether the story is there now: an offer is taken on
// where it was made. A place is compared by its settlement (the first part of the scene's Loc,
// "Bluewatch Village | Guild Post" → Bluewatch), so moving between its spots stays "here".
const SETTLEMENT_WORDS = new Set(['the', 'village', 'town', 'city', 'hamlet', 'outpost', 'port', 'of', 'settlement']);

/** A place's settlement, as words to compare: "Bluewatch Village | Guild Post" → 'bluewatch'. */
export function settlementKey(place) {
    const first = String(place ?? '').replace(/\*\*/g, '').split(/\s*(?:\||·|—|–)\s*/)[0].replace(/\[[^\]]*\]/g, '');
    return words(first).filter(word => !SETTLEMENT_WORDS.has(word)).join(' ');
}

/** The settlement's name as written, for the badge: "Bluewatch Village | Guild Post" → "Bluewatch Village". */
export function settlementName(place) {
    return String(place ?? '').replace(/\*\*/g, '').split(/\s*(?:\||·|—|–)\s*/)[0].replace(/\[[^\]]*\]/g, '').trim();
}

/**
 * Where an offer was made: the scene's place at the reply that first showed it (`visits`:
 * [{ message, text }], chat order), else where it was last seen, else its `place` field (which
 * often names the job's site rather than where it was offered). '' when none is known.
 */
export function offerPlace(record, visits = []) {
    const at = message => {
        if (!Number.isInteger(message)) return '';
        let found = '';
        for (const visit of visits ?? []) if (Number.isInteger(visit?.message) && visit.message <= message && visit.text) found = visit.text;
        return found;
    };
    return at(record?.created?.message) || at(record?.seen?.message) || String(record?.fields?.place ?? '').trim();
}

/**
 * Whether an offer can be taken on here (0.9.37): { here, badge, ask }, or null when neither a
 * place nor a giver can tell. Here when the story is in the settlement it was offered in, or
 * its giver is in the scene (giverPresent); `ask` is the question Take on puts while not.
 */
export function offerPresence(record, { place = '', visits = [], scene = '', present = null, reply = '' } = {}) {
    const offered = offerPlace(record, visits);
    const where = settlementName(offered);
    const giver = String(record?.fields?.giver ?? '').split(/[,(;—–]/)[0].trim();
    const withGiver = giverPresent(record?.fields?.giver, { scene, present, reply });
    if (where && settlementKey(offered) && settlementKey(place)) {
        if (settlementKey(offered) === settlementKey(place)) return { here: true, badge: `${where} · here`, ask: '' };
        if (withGiver) return { here: true, badge: `${giver} · here`, ask: '' };
        return { here: false, badge: `offered in ${where}`, ask: `You're not in ${where} — take it anyway?` };
    }
    if (withGiver === null) return null;
    return withGiver
        ? { here: true, badge: `${giver} · here`, ask: '' }
        : { here: false, badge: `${giver} · not here`, ask: `${giver} isn't here — take it anyway?` };
}
