// Story Director v2, quests part: reading a quest's target and reward out of the words the
// story wrote (its `target:` / `reward:` labels, else its goal), and matching names whole-word.
// Pure: no ctx, no state. Every number here comes from the text by code; nothing is guessed
// from a vague sentence ("deal with the wolves" has no target, and that is fine).

import { entityKey } from '../../quest-completion.js';

const clean = value => String(value ?? '').normalize('NFKC').replace(/[*_`]+/g, '').replace(/\s+/g, ' ').trim();

export const NUMBER_WORDS = Object.freeze({
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
    eighteen: 18, nineteen: 19, twenty: 20,
});
const COUNT = `(\\d+|${Object.keys(NUMBER_WORDS).join('|')})`;

/** A whole count from digits or a number word up to twenty; null for anything else. */
export function countOf(word) {
    const text = clean(word).toLowerCase();
    if (/^\d+$/.test(text)) {
        const value = Number(text);
        return Number.isSafeInteger(value) ? value : null;
    }
    return Object.hasOwn(NUMBER_WORDS, text) ? NUMBER_WORDS[text] : null;
}

// Plurals entityKey (v1) does not know; everything else goes through it.
const IRREGULAR = Object.freeze({
    thieves: 'thief', elves: 'elf', dwarves: 'dwarf', halves: 'half', wives: 'wife', calves: 'calf',
    men: 'man', women: 'woman', teeth: 'tooth', feet: 'foot', children: 'child', oxen: 'ox', lice: 'louse',
    hooves: 'hoof', loaves: 'loaf', scarves: 'scarf', staves: 'staff', pennies: 'penny', pence: 'penny',
});

const PLURAL_OF = Object.freeze(Object.fromEntries([
    ...Object.entries(IRREGULAR), ['wolves', 'wolf'], ['knives', 'knife'], ['leaves', 'leaf'], ['mice', 'mouse'], ['geese', 'goose'],
].filter(([many]) => many !== 'pence').map(([many, one]) => [one, many])));

/** One word in its singular, lower case: "Wolves" → "wolf", "Rats" → "rat", "boss" → "boss". */
export function singular(word) {
    const lower = clean(word).toLowerCase();
    return IRREGULAR[lower] ?? entityKey(lower);
}

const wordsOf = text => clean(text).toLowerCase().split(/[^\p{L}\p{N}'-]+/u).filter(Boolean).map(singular);

/**
 * Whether `noun` names the thing called `name`, by whole words in the singular: the noun's
 * words appear in the name, in order and side by side. "wolves" matches "Grey Wolf" and
 * "Wolf", never "Wolfhound Handler"; "cellar rats" matches "Cellar Rat Swarm".
 */
export function nameMatches(noun, name) {
    const want = wordsOf(noun);
    const have = wordsOf(name);
    if (!want.length || want.length > have.length) return false;
    for (let start = 0; start + want.length <= have.length; start += 1) {
        if (want.every((word, i) => have[start + i] === word)) return true;
    }
    return false;
}

const FOE_VERBS = ['defeat', 'kill', 'slay', 'slaughter', 'beat', 'clear', 'cull', 'hunt', 'hunt down', 'destroy',
    'vanquish', 'exterminate', 'dispatch', 'eliminate', 'take down', 'put down', 'wipe out', 'bring down', 'fight'];
const ITEM_VERBS = ['bring', 'bring back', 'deliver', 'fetch', 'gather', 'collect', 'find', 'retrieve', 'recover',
    'harvest', 'return', 'obtain', 'procure', 'forage', 'possess', 'get', 'hand over', 'turn in', 'buy', 'pick'];
const verbPattern = list => [...list].sort((a, b) => b.length - a.length).map(verb => `${verb.replace(' ', '\\s+')}s?`).join('|');
const VERB_KIND = new RegExp(`^(?:(${verbPattern(FOE_VERBS)})|(${verbPattern(ITEM_VERBS)}))$`, 'i');
const VERBS = verbPattern([...FOE_VERBS, ...ITEM_VERBS]);

// Where a target's noun ends: a preposition, a joining word, or punctuation.
const STOP_WORDS = new Set(['from', 'in', 'at', 'near', 'for', 'to', 'on', 'by', 'before', 'after', 'within', 'and',
    'or', 'with', 'around', 'outside', 'inside', 'under', 'over', 'that', 'who', 'which', 'while', 'then', 'until',
    'each', 'per', 'apiece', 'into', 'across', 'along', 'behind', 'beyond', 'without', 'if', 'so', 'as']);
const NOUN_WORDS_MAX = 5;

function nounAfter(rest) {
    const words = [];
    for (const match of rest.matchAll(/([\p{L}][\p{L}'-]*)|([^\s\p{L}])/gu)) {
        if (match[2]) break;
        const word = match[1];
        if (STOP_WORDS.has(word.toLowerCase())) break;
        words.push(word);
        if (words.length > NOUN_WORDS_MAX) return '';
    }
    return words.join(' ');
}

// "and 2 bears" / ", 4 boars" right after the noun: two targets at once, which code does not split.
const SECOND_TARGET = new RegExp(`^\\s*(?:,|&|\\band\\b|\\bor\\b)\\s*(?:then\\s+)?(?:at\\s+least\\s+)?${COUNT}\\s+\\p{L}`, 'iu');

function targetIn(text, { verbRequired }) {
    const head = verbRequired
        ? new RegExp(`(?:^|[^\\p{L}])(${VERBS})\\s+(?:the\\s+)?(?:at\\s+least\\s+)?${COUNT}\\s+`, 'iu')
        : new RegExp(`^(?:(${VERBS})\\s+)?(?:the\\s+)?(?:at\\s+least\\s+)?${COUNT}\\s+`, 'iu');
    const match = head.exec(text);
    if (!match) return null;
    const count = countOf(match[2]);
    if (!count || count < 1) return null;
    const rest = text.slice(match.index + match[0].length);
    const noun = nounAfter(rest);
    if (!noun) return null;
    const after = rest.slice(rest.indexOf(noun) + noun.length);
    if (SECOND_TARGET.test(after)) return null;
    const verb = (match[1] ?? '').toLowerCase().replace(/\s+/g, ' ');
    const kinds = VERB_KIND.exec(verb);
    const kind = kinds ? (kinds[1] ? 'foes' : 'items') : null;
    return { noun, count, kind };
}

/**
 * A quest's target from its fields: `{ noun, count, kind: 'foes' | 'items' | null }` or null.
 * The `target:` label may leave out the verb ("3 wolves", "at least 3 wolves"), then `kind`
 * is null and the caller decides it (an item the inventory knows, else foes); in the goal
 * text a verb is needed ("Clear at least 3 wolves from East Bluff"). A label code cannot read
 * gives no target rather than falling back to the goal.
 */
export function parseTarget(fields = {}, summary = '') {
    const label = clean(fields.target);
    if (label) return targetIn(label, { verbRequired: false });
    for (const text of [fields.goal, fields.desc, summary]) {
        const found = targetIn(clean(text), { verbRequired: true });
        if (found) return found;
    }
    return null;
}

// The coin words code reads as money. A chat has one currency (MODULES §F1): the word only says
// that a number is money; the number is a whole amount of the chat's currency, whatever word the
// story wrote ("8 silver" pays 8 of it, as v1's numbers were kept as they are).
const COIN_WORDS = Object.freeze(['copper', 'silver', 'gold', 'platinum', 'electrum', 'cp', 'sp', 'gp', 'pp',
    'coin', 'coins', 'crown', 'crowns', 'mark', 'marks', 'penny', 'pennies', 'pence', 'shilling', 'shillings',
    'ducat', 'ducats', 'florin', 'florins', 'sovereign', 'sovereigns', 'denar', 'denars', 'gil']);
const escape = word => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const EACH = `(?:\\s*,?\\s*(?:(each|apiece|a\\s+head|per\\s+head)(?![\\p{L}])(?:\\s+([\\p{L}][\\p{L}'-]*))?|(?:per|for\\s+each|for\\s+every|each)\\s+([\\p{L}][\\p{L}'-]*)))?`;

// The words for money in this chat: the usual coin words plus the chat's own currency name and
// short form ("Gil", "g"), longest first so "gold coins" is read before "gold".
function coinPattern(currency) {
    const coins = Array.isArray(currency?.coins) ? currency.coins.flatMap(coin => [coin?.name, coin?.plural]) : [];
    const own = [currency?.name, currency?.short, ...coins].map(word => clean(word).toLowerCase()).filter(word => word && /^[\p{L}][\p{L} '-]*$/u.test(word));
    const words = [...new Set([...COIN_WORDS, ...own.flatMap(word => [word, `${word}s`])])].sort((a, b) => b.length - a.length);
    return `(${words.map(escape).join('|').replace(/ /g, '\\s+')})`;
}

/** What one coin named `word` is worth in the smallest unit (`currency.coins`, from inventory.currency); 1 otherwise. */
export function coinWorth(word, currency) {
    const want = clean(word).toLowerCase().replace(/\s+(?:coins?|pieces?)$/, '');
    const coin = (Array.isArray(currency?.coins) ? currency.coins : []).find(entry => [entry?.name, entry?.plural, `${entry?.name}s`].some(name => clean(name).toLowerCase() === want));
    return Number.isSafeInteger(coin?.value) && coin.value >= 1 ? coin.value : 1;
}

function rewardPattern(currency) {
    return new RegExp(`(?:^|[^\\p{L}\\d])${COUNT}\\s+${coinPattern(currency)}(?:\\s+(?:coins?|pieces?))?(?![\\p{L}])${EACH}`, 'iu');
}

// A `reward:` label that is only a number ("30", "2 each", "1 per wolf"): money too.
const BARE_REWARD = new RegExp(`^${COUNT}${EACH}\\.?$`, 'iu');

/**
 * A reward from the `reward:` label, else from the goal text:
 * `{ amount, each, unit, text, per }` — `amount` a whole number of the chat's one currency
 * (`unit` is always ''; the currency's name comes from `inventory.currency` when it is shown), or
 * null when the reward is not money code can read (a favour, a horse); `each` when it is paid per
 * unit of the target ("1 silver each wolf", "2 per tail"), `per` the unit word as written ('' when
 * "each" names none). `reward: none` is `{ amount: 0 }`. No reward written → null.
 * `options.currency` ({ name, short }) adds the chat's own currency words to the coin words.
 */
export function parseReward(fields = {}, summary = '', { currency = null } = {}) {
    const label = clean(fields.reward);
    if (/^(?:none|nothing|no reward|unpaid)\.?$/i.test(label)) return { amount: 0, each: false, unit: '', text: label, per: '' };
    const sources = label ? [label] : [fields.goal, fields.desc, summary].map(clean).filter(Boolean);
    const pattern = rewardPattern(currency);
    for (const text of sources) {
        const bare = text === label ? BARE_REWARD.exec(text) : null;
        const match = bare ? [bare[0], bare[1], '', bare[2], bare[3], bare[4]] : pattern.exec(text);
        if (!match) continue;
        const count = countOf(match[1]);
        if (count === null) continue;
        // Story Block's coins (MODULES §F108): "3 silver" is 30 when silver is worth 10 of the smallest.
        const amount = count * coinWorth(match[2], currency);
        const each = Boolean(match[3] || match[5]);
        // "each wolf" may be "each, paid on return": a word after a bare "each" is only a hint.
        const per = clean(match[5] || match[4] || '');
        const loose = !match[5] && Boolean(match[4]);
        const text2 = label || match[0].replace(/^[^\p{L}\d]/u, '').trim();
        return { amount, each, unit: '', text: text2, per, loose };
    }
    return label ? { amount: null, each: false, unit: '', text: label, per: '' } : null;
}

/**
 * The reward as stored on the thread (MODULES §C1 shape), checked against the target: a
 * per-unit reward whose unit is not the target's ("1 silver per rat" on a wolf quest) is not
 * money code pays (amount null; the story settles it).
 */
export function settleReward(reward, target) {
    if (!reward) return null;
    const { amount, each, text, per, loose } = reward;
    const unitMismatch = per && target && !nameMatches(per, target.noun) && !nameMatches(target.noun, per);
    if (each && (!target || (unitMismatch && !loose))) return { amount: null, each: false, unit: '', text };
    return { amount, each, unit: '', text };
}

/** The chat's one currency as `{ name }` from a name, a `{ name }` or nothing (gold, Story Block's default). */
export function currencyName(currency) {
    const name = clean(typeof currency === 'string' ? currency : currency?.name);
    return name || 'gold';
}

/** "1 mark", "8 marks": an amount of the chat's one currency (its plural for any amount but one). */
export function money(amount, currency) {
    const name = currencyName(currency);
    const plural = typeof currency === 'object' ? clean(currency?.plural) : '';
    return `${amount} ${Math.abs(Number(amount)) === 1 || !plural ? name : plural}`;
}

const matchCase = (word, like) => (like[0] && like[0] === like[0].toUpperCase() ? word.replace(/^./, c => c.toUpperCase()) : word);

/**
 * The target's noun for `n` of them: "1 wolf", "8 wolves" (as written when it was plural);
 * a noun written singular after a count above one ("5 moonleaf") is kept as written.
 */
export function nounFor(target, n) {
    const words = clean(target?.noun).split(' ');
    const last = words.at(-1) ?? '';
    const one = singular(last);
    const isPlural = one !== last.toLowerCase();
    if (!isPlural && target.count > 1) return words.join(' ');
    const many = isPlural ? last : PLURAL_OF[last.toLowerCase()] ? matchCase(PLURAL_OF[last.toLowerCase()], last) : (/(?:s|x|z|ch|sh)$/i.test(last) ? `${last}es` : /[^aeiou]y$/i.test(last) ? `${last.slice(0, -1)}ies` : `${last}s`);
    const oneForm = isPlural ? matchCase(one, last) : last;
    words[words.length - 1] = n === 1 ? oneForm : many;
    return words.join(' ');
}

/** The pay for `units` of the target, a whole amount of the currency, or null when code pays nothing. */
export function payFor(reward, units) {
    if (!reward || !Number.isSafeInteger(reward.amount) || reward.amount < 0) return null;
    const total = reward.each ? reward.amount * units : reward.amount;
    return Number.isSafeInteger(total) ? total : null;
}

/** "beat 3 wolves", "bring 5 moonleaf": the target in words, for summaries. */
export function targetText(target) {
    if (!target) return '';
    return `${target.kind === 'items' ? 'bring' : 'beat'} ${target.count} ${nounFor(target, target.count)}`;
}

/** "1 gold per wolf", "8 gold", or the reward as written when it is not money. */
export function rewardText(reward, target, currency) {
    if (!reward) return '';
    if (reward.amount === null) return reward.text;
    if (reward.amount === 0) return 'no reward in money';
    return reward.each ? `${money(reward.amount, currency)} per ${target ? nounFor(target, 1) : 'unit'}` : money(reward.amount, currency);
}
