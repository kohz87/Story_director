// Story Director: how the tracker reads what was said (pure): a quest whose pay is left to
// collect, a job given up, offers chosen in the reader's message, and the reason a `-`, `~` or `!`
// line gives for a quest being over. Moved out of tracker.js; tracker.js re-exports its public names.

import { QUEST_TYPE_WORDS, lineKey } from './changes.js';
import { keyWords } from './tracker-words.js';

// A quest closed with one of these was not done: it ended without the work being finished.
export const FAILED = /\b(?:fail|abandon|gave up|give up|given up|giving up|forfeit|quit\b|walked away|backed out|called off|withdr[eao]w|expired|missed|too late|cancel|refused|declined|botched)/i;
// (0.9.1) How a model says something is over without a `-` line: `~ Quest — step: done`,
// `status: completed`, `outcome: failed`. Only a value that is one of these words, alone or
// before punctuation ("completed — the wolves are dead"): "complete the ritual" is a step.
export const OVER_VALUE = /^(?:done|complete|completed|finished|fulfilled|accomplished|resolved|succeeded|success|turned in|handed in|delivered|over|closed|failed|failure|abandoned|given up|gave up|forfeit|forfeited|quit|withdrawn|called off|expired|cancell?ed)\s*(?:$|[.,;:!—–(-])/i;
// (0.9.42) A quest's step that opens with the ending and goes on to confirm it: "Completed and
// turned in to Fenna" (the rest says turned in), or with a `reward:` that reads as paid in the
// same line ("reward: Claimed 2 gold"). "done tracking, now the den" is still a step.
const OVER_START = /^(?:done|completed|finished|fulfilled|accomplished|cleared|turned in|handed in|delivered|failed|abandoned)\b\s*(?:and|&|,|—|–|-|;)\s*(.+)$/i;
const REWARD_TAKEN = /^(?:claimed|collected|received|paid|taken|pocketed|got)\b/i;
export const overStep = (value, op) => {
    const rest = value.match(OVER_START)?.[1] ?? '';
    if (!rest) return false;
    return LOOKS_OVER.test(rest) || QUEST_OVER_TEXT.test(rest) || REWARD_TAKEN.test(String(op?.fields?.reward ?? op?.extra?.reward ?? '').trim());
};
// The labels such a value comes under: any record's status or outcome, and a quest's step or now.
const OVER_LABELS = ['status', 'state', 'outcome', 'result', 'progress'];
export const QUEST_OVER_FIELDS = ['step', 'now'];
// A `!` on a quest that says it was finished or failed ("! Sheep-killer — wolves slain, reward paid").
// (0.9.27) Or the pay for it: "voucher paid", "bounty collected".
export const QUEST_OVER_TEXT = /\b(?:complet|finish|fulfil|accomplish|done\b|turned in|handed in|(?:reward|bounty|voucher|fee|payment)(?:ed)?\s+(?:paid|collected|received|claimed)|paid out|paid in full)/i;
// (0.9.13) A `-` that says the job was taken on, not ended: "- Hook Sheepfold Wolves — accepted
// by Wessel" beside the `+ quest` it became. Not when it also speaks of pay or an ending.
const TAKEN_ON = /\b(?:accept(?:s|ed)?|tak(?:es|en|ing) (?:on|up)|took (?:on|up)|signed (?:on|up|for)|agreed to|became (?:a |the )?(?:quest|bounty|contract|job)|(?:now|turned into|converted (?:in)?to|promoted to|upgraded to) (?:a |the )?(?:quest|bounty|contract|job))\b/i;
const NOT_TAKEN_ON = /\b(?:reward|paid|pay(?:ment)?|coin|silver|gold|copper|fee)\b/i;
export const endsJob = reason => QUEST_OVER_TEXT.test(reason) || FAILED.test(reason) || LOOKS_OVER.test(reason);
export const takenOn = reason => TAKEN_ON.test(reason) && !NOT_TAKEN_ON.test(reason) && !QUEST_OVER_TEXT.test(reason) && !FAILED.test(reason) && !LOOKS_OVER.test(reason);

// (0.9.5) A quest still open whose own progress reads as over ("step: wolf slain, reward
// collected"): finished or failed words in its step or now. Not its goal or description, which
// say what the job is ("complete the ritual").
export const LOOKS_OVER = /\b(?:completed|finished|fulfilled|accomplished|done\b(?!\s+with)|turned in|handed in|delivered|(?:reward|bounty|voucher|fee|payment)(?:ed)?\s+(?:paid|collected|received|claimed)|paid out|paid in full|failed|abandoned|gave up|given up|forfeit(?:ed)?|quit\b|walked away|backed out|called off|expired|too late)/i;

// (0.9.28) A step that is only the pay left to collect ("turn in voucher at the bailiff hatch",
// "collect the bounty from Verna"): the work is done. A time it was given is when the pay can be
// had, not a deadline the job can be failed by; and a failing reason that is only about time.
const PAY_WORDS = '(?:vouchers?|rewards?|bount(?:y|ies)|pay|payment|purse|coins?|fees?|chits?|tokens?|receipts?|scrip|silver|gold|copper|wages?)';
const CLAIM_STEP = new RegExp(`\\b(?:(?:turn|hand|cash|redeem|collect|claim|pick)(?:s|ed|ing)?(?: in| up)?|exchang(?:e|es|ed|ing))(?:\\s+[\\w'’-]+){0,2}?\\s+${PAY_WORDS}\\b|\\b(?:get|getting|be) paid\\b|\\b(?:return|go back|report)\\w*(?:\\s+[\\w'’-]+){0,4}?\\s+for\\s+(?:the |their |his |her |my |our )?${PAY_WORDS}\\b`, 'i');
export const TIME_FAIL = /\b(?:expired|missed|too late|deadline|lapsed|ran out|out of time|overdue|late\b|window (?:closed|passed|shut))/i;

/** (0.9.28) Whether an open quest's work is done and only its pay is left (its step or now says so). */
export function waitsForPay(record) {
    if (record?.kind !== 'quest' || record.status !== 'active') return false;
    return ['step', 'now'].some(field => CLAIM_STEP.test(String(record.fields?.[field] ?? '')));
}

/** Whether an open quest's step or now says it is over, so the note can ask the story to close it. */
export function looksFinished(record) {
    if (record?.kind !== 'quest' || record.status !== 'active') return false;
    return ['step', 'now'].some(field => LOOKS_OVER.test(String(record.fields?.[field] ?? '')));
}

// (0.9.6) The reader's own message (or the reply's narration) saying a job is given up: a
// sentence with one of these and the quest's key, or its giver's name. Only ever a hint: the
// note asks the story to close it, nothing is closed here.
export const GIVE_UP = /\b(?:give up|gave up|giving up|given up|forfeit(?:s|ed|ing)?|abandon(?:s|ed|ing)?|quit(?:s|ting)?|walk(?:s|ed|ing)? away from|back(?:s|ed|ing)? out of|call(?:s|ed|ing)? off|drop(?:s|ped|ping)? the (?:job|bounty|contract|quest|hunt|search))\b/i;
const NOT_BEFORE = /\b(?:not|never|won't|wont|don't|dont|didn't|didnt|wouldn't|can't|cannot|refuse to)\s+(?:\w+\s+){0,2}$/i;

/** The open quests a text says are given up, by key: [key], in tracker order. */
export function givenUpIn(tracker, text) {
    const sentences = String(text ?? '').split(/(?<=[.!?…])\s+|\n+/).filter(Boolean);
    const said = sentences.filter(sentence => {
        const match = GIVE_UP.exec(sentence);
        return match && !NOT_BEFORE.test(sentence.slice(0, match.index));
    });
    if (!said.length) return [];
    const names = record => [record.key, String(record.fields?.giver ?? '').trim(), ...(record.aliases ?? [])].filter(name => name.length >= 3);
    const named = (sentence, name) => new RegExp(`(?<![\\p{L}\\p{N}])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')}(?![\\p{L}\\p{N}])`, 'iu').test(sentence);
    return (tracker?.records ?? [])
        .filter(record => record.kind === 'quest' && record.status === 'active')
        .filter(record => said.some(sentence => names(record).some(name => named(sentence, name))))
        .map(record => record.key);
}

// (0.9.15) Choices about a job are the reader's: taking it on, turning it down, giving it up.
// The model's line for one counts only when the reader's own message (the one the reply answers)
// made it, naming the job (its key, its giver or a word of its name). The story keeps the
// outcomes: done, failed, expired. A main quest is the story's to give, and a job the story
// moves on (a step under way) is one the character is already doing.
// (0.9.27) "We" as well as "I", and going along: "we'll join the hunt", "count us in".
// (0.9.32) Taking a notice off a board, or several at once: "took down all three contracts".
export const ACCEPT_WORDS = /\b(?:accept(?:s|ed|ing)?|take (?:it|this|that|the|on|up|them|down|all|both|these|those)|takes (?:it|the|on|up|them|down|all|both)|took (?:it|the|on|up|them|down|all|both|these|those)|taking (?:it|the|on|up|them|down|all|both)|(?:tore|pulled|ripped) (?:down|off) (?:the|all|both|them|these|those)|(?:i|we)(?:'?ll| will| shall) (?:take|do|handle|join|help|see to)|join(?:s|ed)? (?:the|you|your|in)|agree(?:s|d)? to|sign(?:s|ed)? (?:up|on)|count (?:me|us) in|(?:i'?m|we'?re) in|(?:i'?m|we'?re) up for|up for it|let'?s do (?:it|this)|deal|choose|chose|pick(?:s|ed)?)\b/i;
// (0.9.27) Plain yes words: they take a job only when the reply's one new quest is the question.
export const AGREE_WORDS = /^\W*(?:yes|yeah|aye|sure|okay|ok|alright|all right|very well|of course|fine)\b/i;
export const REFUSE_WORDS = /\b(?:refuse[sd]?|refusing|declin(?:e|es|ed|ing)|turn(?:s|ed|ing)? (?:it |that |this |them )?down|no thanks|pass(?:es|ed)? on|not interested)\b/i;
// A closing reason that is the reader's decision rather than the story's outcome.
export const CHOSEN_END = /\b(?:abandon|gave up|give up|given up|giving up|forfeit|quit\b|walked away|backed out|withdr[eao]w|refus|declin|turned down|passed on)/i;
// Words of a job's name too general to say which job is meant.
const GENERIC_WORDS = new Set(['quest', 'job', 'jobs', 'contract', 'bounty', 'task', 'work', 'mission', 'favour', 'favor', 'side', 'main']);

// (0.9.32) Every job in question at once: "all three contracts", "both jobs", "all of them".
const COUNT_WORDS = { two: 2, three: 3, four: 4, five: 5, six: 6 };
const JOB_NOUNS = '(?:contracts?|jobs?|quests?|bount(?:y|ies)|tasks?|postings?|notices?|offers?|commissions?|requests?|errands?)';
const ALL_JOBS = new RegExp(`\\b(?:(?:all|both|every|each)(?:\\s+(?:of\\s+)?(?:the|these|those))?(?:\\s+(\\d+|two|three|four|five|six))?\\s+${JOB_NOUNS}|(?:all|both)(?:\\s+(\\d+|two|three|four|five|six))?\\s+of\\s+(?:them|those|these)|them\\s+(?:all|both))\\b`, 'i');

/** How many jobs "all of them" means in `said`: { count } (null: as many as are in question), or null when it says none. */
export function allJobsIn(said) {
    for (const sentence of sentencesOf(said)) {
        const match = ALL_JOBS.exec(sentence);
        if (!match) continue;
        const word = String(match[1] ?? match[2] ?? '').toLowerCase();
        const count = /^\d+$/.test(word) ? Number(word) : COUNT_WORDS[word] ?? (/\bboth\b/i.test(match[0]) ? 2 : null);
        return { count };
    }
    return null;
}

/**
 * The offers "all of them" means: the ones shown most lately before reply `message` (a
 * count given: that many, newest first). [record]
 */
export function offersInQuestion(records, message, count = null) {
    const last = record => Math.max(...[record.seen, record.changed, record.created].map(at => (Number.isInteger(at?.message) && at.message < message ? at.message : -1)));
    const offers = (records ?? []).filter(isOffer).map(record => ({ record, at: last(record) })).filter(entry => entry.at >= 0).sort((a, b) => b.at - a.at);
    if (!offers.length) return [];
    if (count) return offers.slice(0, count).map(entry => entry.record);
    return offers.filter(entry => entry.at === offers[0].at).map(entry => entry.record);
}

export const sentencesOf = text => String(text ?? '').split(/(?<=[.!?…\]])\s+|\n+/).filter(Boolean);

export function namesJob(sentence, record) {
    const words = keyWords(record.key).filter(word => word.length >= 3 && !GENERIC_WORDS.has(word));
    // (0.9.19) A name the story gave the job (an alias) names it too: "the fold wolf contract".
    const names = [record.key, String(record.fields?.giver ?? '').trim(), ...words, ...(record.aliases ?? [])].filter(name => name.length >= 3);
    // A name as written, or with a plural ending: wolf/wolves, bounty/bounties, rat/rats.
    const pattern = name => {
        const body = escapeRegExp(normalizeQuotes(name)).replace(/\s+/g, '\\s+');
        if (/f$/i.test(name)) return `${body.slice(0, -1)}(?:f|ves)`;
        if (/y$/i.test(name)) return `${body.slice(0, -1)}(?:y|ies)`;
        return `${body}(?:s|es)?`;
    };
    return names.some(name => new RegExp(`(?<![\\p{L}\\p{N}])${pattern(name)}(?![\\p{L}\\p{N}])`, 'iu').test(normalizeQuotes(sentence)));
}

/**
 * Whether `said` (the reader's message) makes a choice about `record` with `words`: a sentence
 * with one of them, not negated, naming the job, or any such sentence when `alone` (it is the
 * only job in question).
 */
export function saidAbout(said, record, words, { alone = false, among = false } = {}) {
    return sentencesOf(said).some(sentence => {
        const match = words.exec(sentence);
        if (!match || NOT_BEFORE.test(sentence.slice(0, match.index))) return false;
        // (0.9.32) `among`: the job is one of those "all of them" in the same sentence means.
        return alone || namesJob(sentence, record) || (among && ALL_JOBS.test(sentence));
    });
}

export const isJob = record => BECOMES_QUEST.has(record.kind)
    && (JOB_FIELDS.some(name => String(record.fields?.[name] ?? '').trim()) || isQuestType(record.fields?.type));

/** (0.9.15) An offer: a job (a giver, a reward or a quest type) the reader has not taken on yet. */
export function isOffer(record) {
    return record?.status === 'active' && isJob(record);
}

/** The offers `text` (the reader's message) takes on, or turns down: [key], in tracker order. */
export function offersChosenIn(tracker, text, choice = 'accept') {
    const offers = (tracker?.records ?? []).filter(isOffer);
    const words = choice === 'refuse' ? REFUSE_WORDS : ACCEPT_WORDS;
    const all = allJobsIn(text);
    const among = new Set(all ? offersInQuestion(offers, Number.POSITIVE_INFINITY, all.count).map(record => record.id) : []);
    return offers.filter(record => saidAbout(text, record, words, { alone: offers.length === 1, among: among.has(record.id) })).map(record => record.key);
}

// A `-` line's reason with its labelled parts ("failed: deadline passed"), as written.
export function closingReason(op) {
    const parts = Object.entries(op.extra ?? {}).map(([label, value]) => (String(value ?? '').trim() ? `${label}: ${value}` : label));
    return [String(op.reason ?? '').trim(), ...parts].filter(Boolean).join('; ');
}

/** What a `~` (or a quest's `!`) says when it means the record is over, or null. */
export function overByChange(record, op) {
    if (op.op === '!') {
        // (0.9.27) An offer too, when the story says the job is done ("skins turned in"): what
        // happens to an offer that is not the reader's ("the bandits withdrew") is only news.
        if (record.kind !== 'quest' && !isJob(record)) return null;
        const said = [op.reason, ...Object.values(op.fields ?? {}), ...Object.values(op.extra ?? {})].map(value => String(value ?? '')).join(' ');
        return QUEST_OVER_TEXT.test(said) || (record.kind === 'quest' && FAILED.test(said)) ? (op.reason || said).trim() : null;
    }
    for (const label of OVER_LABELS) {
        const value = String(op.extra?.[label] ?? '').trim();
        if (OVER_VALUE.test(value)) return value;
    }
    if (record.kind === 'quest' || isJob(record) || takesOnQuest(record, op)) {
        for (const field of QUEST_OVER_FIELDS) {
            const value = String(op.fields?.[field] ?? '').trim();
            if (OVER_VALUE.test(value) || overStep(value, op)) return value;
        }
    }
    return null;
}

// Work {{user}} took on (0.8.6): a hook or event that a `~` names a quest (`type: quest`, or a
// category such as bounty), or that is a job — it has, or the `~` gives it, a giver, a reward or
// a quest category — and the `~` moves it on (a giver, reward, goal, step or difficulty). So
// `~ Wolf pelts — step: tracking the pack` on a hook the planner offered with its reward makes
// the bounty a quest (0.9.4), while a step on a plain thread ("River stranger") does not
// (0.9.2: models write `step:` for any progress). Beats are the world's, never a quest.
export const BECOMES_QUEST = new Set(['hook', 'event']);
const JOB_FIELDS = ['giver', 'reward'];
const MOVES_ON = ['giver', 'reward', 'goal', 'step', 'difficulty'];

const isQuestType = value => {
    const type = lineKey(value ?? '');
    return type === 'quest' || Object.hasOwn(QUEST_TYPE_WORDS, type);
};

export function takesOnQuest(record, op) {
    if (!BECOMES_QUEST.has(record.kind)) return false;
    const fields = op.fields ?? {};
    if (isQuestType(fields.type)) return true;
    const given = name => String(fields[name] ?? '').trim();
    const job = JOB_FIELDS.some(name => given(name) || String(record.fields?.[name] ?? '').trim()) || isQuestType(record.fields?.type);
    return job && MOVES_ON.some(given);
}

export function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function normalizeQuotes(text) {
    return text.replace(/[’‘]/g, '\'');
}
