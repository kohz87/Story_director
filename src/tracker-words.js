// Story Director: the word helpers the tracker matches keys by (pure): a key's words, near
// matches among the active records, and the looser name comparisons. Moved out of tracker.js;
// tracker.js re-exports `keyWords` and `nearMatches`.

import { lineKey } from './changes.js';

// Matching a key that is not tracked to the record it most likely means (v0.8.3): the words
// that tell keys apart, without a leading article or the small words models swap freely.
const LEADING_ARTICLES = new Set(['the', 'a', 'an']);
const CONNECTIVES = new Set(['in', 'at', 'of', 'on', 'to', 'for', 'from', 'the', 'and']);
// One key's words inside the other's counts only when the shorter has this many words.
const MIN_CONTAINED_WORDS = 2;
const MIN_WORD_OVERLAP = 0.75;

/** The words a key is matched by: lineKey's, less a leading article and small connectives. */
export function keyWords(key) {
    const words = lineKey(key).split(' ').filter(Boolean);
    while (words.length && LEADING_ARTICLES.has(words[0])) words.shift();
    return words.filter(word => !CONNECTIVES.has(word));
}

function sameWords(left, right) {
    return left.join(' ') === right.join(' ');
}

// One word set inside the other (the shorter of at least two words), or a Jaccard overlap
// of at least 0.75.
function closeWords(left, right) {
    const a = new Set(left);
    const b = new Set(right);
    const [small, large] = a.size <= b.size ? [a, b] : [b, a];
    const shared = [...small].filter(word => large.has(word)).length;
    if (shared === small.size && small.size >= MIN_CONTAINED_WORDS) return true;
    const union = a.size + b.size - shared;
    return union > 0 && shared / union >= MIN_WORD_OVERLAP;
}

/**
 * The active records a key that is not tracked may mean, as `[{ record, index }]` (index into
 * `records`): those with the same words (case, punctuation, a leading article and small words
 * like in/at/of ignored) or, only when there are none, those whose words contain or are
 * contained in the key's (two words or more) or overlap by 3/4. One entry is a match; more
 * are ambiguous and none is to be guessed.
 */
export function nearMatches(records, key, kind = null) {
    const found = nearMatchesAll(records, key);
    // (stage72) A line that says its kind ("- quest …") and more than one near match, of which exactly one is
    // of that kind: the kind settles it (the hook a quest grew out of stays active beside the quest).
    if (found.length > 1 && kind) {
        const same = found.filter(entry => entry.record.kind === kind);
        if (same.length === 1) return same;
    }
    return found;
}

function nearMatchesAll(records, key) {
    const words = keyWords(key);
    if (!words.length) return [];
    const active = (records ?? [])
        .map((record, index) => ({ record, index, words: keyWords(record.key) }))
        .filter(entry => entry.record.status === 'active' && entry.words.length);
    for (const close of [sameWords, closeWords]) {
        const found = active.filter(entry => close(words, entry.words));
        if (found.length) return found.map(({ record, index }) => ({ record, index }));
    }
    // (0.9.16) Looser, and only ever one: "Fold Wolf Contract" for Sheepfold Wolves (plurals
    // folded, job words such as contract or bounty set aside, "fold" inside "sheepfold"), then
    // a name every word of which the record's own name, goal or description holds ("Fold Wolf
    // Contract" for Wolf Hunt, "kill ridge wolves threatening the sheep fold").
    const core = coreWords(words);
    if (!core.length) return [];
    // More than one: none is taken, and the warning names them.
    const loose = active.filter(entry => looseWords(core, coreWords(entry.words)));
    if (loose.length) return loose.map(({ record, index }) => ({ record, index }));
    if (core.length < 2) return [];
    const described = active.filter(entry => {
        const own = coreWords(['key', 'goal', 'desc'].flatMap(field => keyWords(field === 'key' ? entry.record.key : entry.record.fields?.[field] ?? '')));
        return core.every(word => own.some(other => sameWord(word, other)));
    });
    return described.length <= 3 ? described.map(({ record, index }) => ({ record, index })) : [];
}

// Words that only say it is a job, not which one.
const JOB_WORDS = new Set(['quest', 'job', 'jobs', 'contract', 'bounty', 'task', 'work', 'mission', 'favour', 'favor', 'side', 'main', 'hook', 'event']);

// A word in its singular (wolves → wolf, bounties → bounty, rats → rat), job words left out.
function coreWords(words) {
    return [...new Set(words
        .map(word => word.replace(/ies$/, 'y').replace(/ves$/, 'f').replace(/(?<=[^s])s$/, ''))
        .filter(word => word.length >= 3 && !JOB_WORDS.has(word)))];
}

// The same word, or one inside the other when both are long enough to mean it ("fold", "sheepfold").
function sameWord(a, b) {
    return a === b || (Math.min(a.length, b.length) >= 4 && (a.includes(b) || b.includes(a)));
}

// Every word of the shorter set found in the longer one, with at least two words on each side.
function looseWords(left, right) {
    if (left.length < 2 || right.length < 2) return false;
    const [small, large] = left.length <= right.length ? [left, right] : [right, left];
    return small.every(word => large.some(other => sameWord(word, other)));
}
