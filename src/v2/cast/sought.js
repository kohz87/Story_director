// Story Director v2, part **cast**: a kind of person the reader seeks ("a healer or sister around", a priest, a smith, a guide). Pure.
//
// The planner (plan.js, mode 'sought') may answer that an unmet person is SOUGHT, citing the words of the reader's message (or the story's last
// reply) that ask for them. Code checks the citation like the RPG's foe check: the cited words must stand in those texts as whole words, so a
// phrase the model made up is refused (`citedIn`). Here too: the cheap check that a message may be asking for someone at all (`kindTouches`),
// and the rumor, a description of a sought person who is elsewhere that never carries their name or an alias (`rumorText`).

import { cutPoints, cutWords, flat, keyOf } from './domain.js';

const STOP = new Set(['that', 'this', 'with', 'from', 'they', 'them', 'their', 'there', 'then', 'what', 'when', 'where', 'which', 'while', 'about', 'after', 'before', 'have', 'been', 'were', 'will', 'would', 'could', 'should', 'into', 'over', 'under', 'again', 'still', 'only', 'some', 'such', 'than', 'very', 'your', 'ever', 'also']);
/** The telling words of a text (four letters or more, lower case, no filler). */
export const words = text => (String(text ?? '').toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? []).filter(word => !STOP.has(word));

const escapeRe = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wholeWords = phrase => new RegExp(`(?<![\\p{L}\\p{N}_])${phrase.split(/\s+/).map(escapeRe).join('\\s+')}(?![\\p{L}\\p{N}_])`, 'iu');

export const MAX_CITED = 80;

/** A cited phrase as one plain line (quotes and markup off its ends), or '' when it is too short to mean anything. */
export function citedClean(value) {
    const text = flat(String(value ?? '').replace(/<[^>]*>/g, '')).replace(/^[\s"'“”‘’`*_[(]+|[\s"'“”‘’`*_\])]+$/g, '').trim();
    return (text.match(/[\p{L}\p{N}]/gu) ?? []).length >= 3 ? cutPoints(text, MAX_CITED) : '';
}

/** Whether `phrase` stands in one of `texts` as whole words, any case (a made-up phrase, or a part of a longer word, does not). */
export function citedIn(phrase, texts) {
    const clean = citedClean(phrase);
    if (!clean || clean.endsWith('…')) return false;
    const pattern = wholeWords(clean);
    return (Array.isArray(texts) ? texts : [texts]).some(text => pattern.test(flat(String(text ?? ''))));
}

// ---- who a person is, in words that hide the name ----------------------------------------------------------------------------------------

// Titles and particles are not names: "a Flame sister" says who someone is, "Temiwa" says which one.
const TITLES = new Set(['sister', 'brother', 'mother', 'father', 'captain', 'lady', 'lord', 'sir', 'dame', 'master', 'mistress', 'old', 'young', 'saint', 'doctor', 'madam', 'king', 'queen', 'prince', 'princess', 'elder', 'lieutenant', 'sergeant', 'knight', 'the', 'and', 'of', 'de', 'la', 'le', 'von', 'van', 'du', 'el', 'al', 'in', 'on', 'at']);

/** A text as lower case with diacritics folded away ("Zoë" is "zoe"). */
export const fold = text => String(text ?? '').normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase();
/** The words of a text, folded; any non-letter splits (hyphens, apostrophes, possessives: "Temiwa's" is "temiwa", "s"). */
const wordsOf = text => fold(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
const prefixLen = (a, b) => { let n = 0; while (n < a.length && n < b.length && a[n] === b[n]) n += 1; return n; };

// Whether a word of a text is a name token: the same word; in Latin script the token with up to two letters added or taken off its end
// ("Temiwa", "Temiwan", "Temiwas"); in another script (where a name is inflected: "Зоя", "Зои", "Зою") a word of three or more letters that
// shares all but the last letter of the shorter one.
function sameToken(word, token) {
    if (word === token) return true;
    if (!/[^\u0000-\u024f]/.test(token)) {
        const [short, long] = word.length <= token.length ? [word, token] : [token, word];
        return short.length >= 4 && long.length - short.length <= 2 && long.startsWith(short);
    }
    const common = prefixLen(word, token);
    return Math.min(word.length, token.length) >= 3 && common >= Math.min(word.length, token.length) - 1;
}

/**
 * `mentions(text)`: whether a text holds the person's name, an alias or a name-like token: every word of the name, of each alias and of the
 * entry's id (split on any non-letter, diacritics folded, two letters are enough for a whole word) that is not a title, whole or inflected.
 */
export function nameTester(entryOrPerson) {
    const aliases = Array.isArray(entryOrPerson?.aliases) ? entryOrPerson.aliases : [];
    const tokens = new Set();
    for (const name of [entryOrPerson?.name, ...aliases, entryOrPerson?.id ?? entryOrPerson?.eid]) {
        const parts = wordsOf(name);
        for (const part of parts) if (Array.from(part).length >= 2 && !TITLES.has(part)) tokens.add(part);
    }
    return text => wordsOf(text).some(word => [...tokens].some(token => sameToken(word, token)));
}

const sentencesOf = text => String(text ?? '').split(/(?<=[.!?])\s+/).map(sentence => sentence.trim()).filter(Boolean);

/** What the entry's `about` says of who they are: the opening noun phrase of its first sentence with no name (up to the first `:`, `,` or `;`, no article). */
export function leadOf(entry, mentions = nameTester(entry)) {
    for (const sentence of sentencesOf(entry?.about)) {
        // Only this opening phrase is ever used, so it is the phrase that must not carry a name (a common word of the sentence elsewhere may).
        const phrase = sentence.split(/[:,;]/)[0].trim().replace(/^(?:the|a|an)\s+/i, '').replace(/[.!?]+$/, '');
        // A lone adjective or a pair of them ("Proud", "Stoic and tired") says nothing about who someone is.
        if (mentions(sentence.split(/[:,;]/)[0]) || phrase.split(/\s+/).length < 3 || /^\S+ and \S+$/i.test(phrase)) {
            if (mentions(sentence)) continue;
            return '';
        }
        return cutWords(phrase, 70);
    }
    return '';
}

/** The words a person is sought by: their calling and the lead of their `about` (name-free). */
export function kindWords(entry) {
    const mentions = nameTester(entry);
    // Each part of a calling that carries a name-like word is left out on its own ("Saintess candidate, healer" for an alias "Last Candle" keeps "healer").
    const calling = flat(entry?.calling).split(/\s*[,;]\s*/).filter(part => part && !mentions(part)).join(', ');
    return { calling, lead: leadOf(entry, mentions) };
}

// Words of ordinary prose that a calling or a lead happens to use: they never open the gate on their own.
const COMMON = new Set(['long', 'watch', 'iron', 'card', 'candidate', 'chain', 'cell', 'runner', 'sharp', 'guard', 'captain', 'knife', 'night', 'dark', 'grey', 'gray', 'pale', 'calm', 'warm', 'cold', 'tired', 'proud', 'gentle', 'stranger', 'keeper', 'people', 'village', 'frontier', 'city', 'great', 'noble', 'self', 'taught', 'spell', 'grammar', 'free', 'freed', 'broken', 'holds', 'roaming', 'little', 'small', 'tall', 'old', 'young', 'aging', 'dead', 'hair', 'quiet', 'loud', 'sworn', 'twenty', 'lost', 'thousand', 'sails', 'church', 'eternal', 'flame', 'eared', 'barge', 'barges', 'vargate', 'flower']);
/** The words a person is sought by: a telling word of their calling and of the lead of their `about`, common prose words out. */
export function gateWords(entry) {
    const { calling, lead } = kindWords(entry);
    return [...new Set(words(`${calling} ${lead}`).filter(word => !COMMON.has(word)))];
}
const hasWord = (have, word) => have.has(word) || have.has(`${word}s`) || have.has(`${word}es`) || (word.endsWith('s') && have.has(word.slice(0, -1)));

/** Whether the reader's `text` may be asking for this person's kind: a word of `gateWords` is in it as a whole word (a plural counts). */
export function kindTouches(entry, text) {
    const have = new Set(words(Array.isArray(text) ? text.join('\n') : text));
    return gateWords(entry).some(word => hasWord(have, word));
}

/** Whether cited words hold a telling word of the person's kind (their calling or the lead of their `about`, 4+ letters, no stop word). */
export function citesKind(entry, cited) {
    const { calling, lead } = kindWords(entry);
    const have = new Set(words(cited));
    return words(`${calling} ${lead}`).some(word => hasWord(have, word));
}

// ---- the rumor ---------------------------------------------------------------------------------------------------------------------------

export const MAX_RUMOR = 240;
const lowerFirst = text => text.replace(/^(\p{Lu})(\p{Ll}+)(?=\s+\p{Ll}|$|,)/u, (_all, first, rest) => `${first.toLowerCase()}${rest}`);
const article = text => (/^(?:the|a|an|some)\s/i.test(text) ? '' : /^[aeiou]/i.test(text) ? 'an ' : 'a ');

/**
 * The line the narrator is told when the reader sought a kind of person who is elsewhere: who they are (calling, the lead of `about`) and
 * where to find them (their routine's first part and `where`), built from the entry and never carrying the name, an alias or a name-like
 * token: a part that does is left out, and with nothing left (or the whole still naming them) there is no rumor (''). `home`: they are at
 * their start, so their routine says what they do there.
 */
export function rumorText(entry, { where = '', home = false } = {}) {
    const mentions = nameTester(entry);
    const { calling, lead } = kindWords(entry);
    const place = mentions(where) ? '' : flat(where);
    // Who they are: their calling, else the lead of their `about`.
    const kind = calling ? lowerFirst(cutPoints(calling, 80)) : lowerFirst(lead);
    if (!kind) return '';
    // The lead says more of who they are when there is a calling too ("a saintess candidate, healer (fox-eared saintess candidate of the Church...)").
    const extra = calling && lead && !words(calling).some(word => words(lead).includes(word)) ? ` (${cutPoints(lead, 60)})` : '';
    // Where to find them: what their routine has them at (only at their start, and only a short noun phrase), then the place.
    const routine = home ? shortRoutine(entry?.routine, mentions) : '';
    const spot = routine && place && !routine.toLowerCase().includes(place.toLowerCase()) ? `${routine} in ${place}` : routine || (place ? `in ${place}` : '');
    const text = `People here know of ${article(kind)}${kind}${extra}${spot ? `, ${routine ? 'at ' : 'found '}${spot}` : ''}.`;
    if (mentions(text)) return '';
    return cutPoints(text, MAX_RUMOR);
}

// The first part of a routine when it reads as a place and a time ("Watchhouse infirmary by day"): short, no comma, not opening with a verb.
function shortRoutine(routine, mentions) {
    const part = String(routine ?? '').split(/[;.]/).map(flat).find(one => one && !mentions(one)) ?? '';
    const first = part.replace(/^(?:the|a|an)\s+/i, '').split(/\s+/)[0] ?? '';
    if (!part || Array.from(part).length > 32 || part.includes(',') || /(?:s|ing|ed)$/i.test(first)) return '';
    return part.replace(/^(\p{Lu})(?=\p{Ll}+\s)/u, c => (/^the\s/i.test(part) ? c.toLowerCase() : c));
}
