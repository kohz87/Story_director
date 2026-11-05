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

// Titles are not names: "a Flame sister" says who someone is, "Temiwa" says which one.
const TITLES = new Set(['sister', 'brother', 'mother', 'father', 'captain', 'lady', 'lord', 'sir', 'dame', 'master', 'mistress', 'old', 'young', 'saint', 'doctor', 'madam', 'king', 'queen', 'prince', 'princess', 'elder', 'lieutenant', 'sergeant', 'knight', 'the', 'and', 'of']);

/** `mentions(text)`: whether a text holds the person's name, an alias or a name-like token (a word of their name that is not a title). */
export function nameTester(entryOrPerson) {
    const names = [entryOrPerson?.name, ...(Array.isArray(entryOrPerson?.aliases) ? entryOrPerson.aliases : []), entryOrPerson?.id ?? entryOrPerson?.eid].map(flat).filter(Boolean);
    const phrases = new Set(names.filter(name => keyOf(name)));
    for (const name of [entryOrPerson?.name, ...(Array.isArray(entryOrPerson?.aliases) ? entryOrPerson.aliases : [])].map(flat)) {
        for (const part of name.split(/\s+/)) {
            const bare = part.replace(/[^\p{L}\p{N}]/gu, '');
            if (Array.from(bare).length >= 3 && !TITLES.has(bare.toLowerCase())) phrases.add(bare);
        }
    }
    const tests = [...phrases].filter(phrase => Array.from(phrase).length >= 3).map(wholeWords);
    return text => { const said = flat(text); return tests.some(test => test.test(said)); };
}

const sentencesOf = text => String(text ?? '').split(/(?<=[.!?])\s+/).map(sentence => sentence.trim()).filter(Boolean);

/** What the entry's `about` says of who they are: the opening noun phrase of its first sentence with no name (up to the first `:`, `,` or `;`, no article). */
export function leadOf(entry, mentions = nameTester(entry)) {
    const sentence = sentencesOf(entry?.about).find(one => !mentions(one));
    if (!sentence) return '';
    const phrase = sentence.split(/[:,;]/)[0].trim().replace(/^(?:the|a|an)\s+/i, '').replace(/[.!?]+$/, '');
    // A lone adjective or a pair of them ("Proud", "Stoic and tired") says nothing about who someone is.
    return mentions(phrase) || phrase.split(/\s+/).length < 3 || /^\S+ and \S+$/i.test(phrase) ? '' : cutWords(phrase, 70);
}

/** The words a person is sought by: their calling and the lead of their `about` (name-free). */
export function kindWords(entry) {
    const mentions = nameTester(entry);
    const calling = mentions(entry?.calling) ? '' : flat(entry?.calling);
    return { calling, lead: leadOf(entry, mentions) };
}

/**
 * Whether the reader's `text` may be asking for this person's kind: a telling word of their calling (else, with no calling, of the lead of their
 * `about`) as a whole word, a plural counting. A cheap check so the planner is asked only then; a word of ordinary prose that the entry's
 * other sentences happen to use does not count.
 */
export function kindTouches(entry, text) {
    const { calling, lead } = kindWords(entry);
    const have = new Set(words(Array.isArray(text) ? text.join('\n') : text));
    return words(calling || lead).some(word => have.has(word) || have.has(`${word}s`) || have.has(`${word}es`));
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
