// Story Director: SillyTavern glue.
//
// Everything that decides anything lives in src/ and is pure; this file only wires it to
// SillyTavern and Story Block:
//
// - Story Block (0.6+) carries the model's <Director> change lines in its hidden envelope
//   (registerBlock), gives us the scene block (Time, Location), refreshes, and hosts our tab.
// - The tracker for any point in the chat is a replay of every <Director> block up to that
//   reply, so swipes, edits, deletes and branches are right by construction. Replays are
//   cached per message and resumed from the first message that changed.
// - Before each foreground reply the generate interceptor injects a short note (what is due,
//   arriving and relevant) as a system message at a shallow depth, so the cached history
//   in front of it is untouched.
// - After each reply the change lines are checked, problems shown once, and active agendas
//   mirrored into the scene block's Off-Screen section, for a World State that keeps one.
// - With a world pack (the reader's map), travel legs are checked against its roads and
//   paces, corrections go into the next note, and /route plans a journey.
// - Optionally, a capture call (a model of its own) writes a reply's change lines when the
//   model did not, or always, for writers that skip or garble them.
// - Once per arc, the planner (one model call, on the chat's model or a connection profile)
//   turns the next arc into tracked records: an arc, dated beats, agendas, hooks, clocks and
//   secrets. A plan waits in the tab for the reader unless they chose to skip review.
// - Planned fights (a record with an `encounter`) are only stored, scheduled and handed over:
//   globalThis.StoryDirector.encountersAt tells RPG Battle which ones the story has reached,
//   and questsDoneAt which quests a reply finished (with their difficulty).
// - Story Suite (src/suite.js, docs/STORY_SUITE.md): while it tracks the story, Story Director
//   announces itself for the calendar, the timeline and NPCs (switched off, it stays announced
//   as disabled, with its settings panel and api.manage for Story Suite's overlay). When NPC
//   State Delta is the source of truth for who an NPC is, agenda lines are asked for plans
//   and timing only. Alone, everything works as before.

import { PRESETS, makeCalendar, normalizeCalendar, sharedCalendar } from './src/calendar.js';
import { formatOp, parseChanges } from './src/changes.js';
import { offerPresence } from './src/presence.js';
import { activeRecords, emptyTracker, findRecord, givenUpIn, isOffer, offersChosenIn, questsDoneIn, replay, untrackedCorrections, waitsForPay } from './src/tracker.js';
import { seedFromWorldState } from './src/seed.js';
import { checkpointDue, compactTracker, compactVisits, shiftTracker, shiftVisits, usableCheckpoint, withCheckpoint } from './src/checkpoints.js';
import { mirrorOffscreen } from './src/mirror.js';
import { DEFAULTS, classify, encountersIn, estimateTokens } from './src/relevance.js';
import { CHANGE_INSTRUCTION, noteParts, noteTokens, staticNote, tailNote } from './src/note.js';
import { checkReply } from './src/checks.js';
import { lapseLines, lapsedOffers, lapsesIn, slippedBeats } from './src/lapses.js';
import { renderSettings } from './src/ui/settings.js';
import { renderTab } from './src/ui/tab.js';
import { renderQuests } from './src/ui/quests.js';
import { renderJournal } from './src/ui/journal.js';
import { buildJournal } from './src/journal.js';
import { MODERN_MODES, MODES, findPlace, formatRoute, loadWorldPack, packSummary, placesIn, planRoute } from './src/routes.js';
import { distancesFor, withFixedDistance, wrongDistances } from './src/distances.js';
import { corrections, nearbyPlaces, travelFindings } from './src/travel.js';
import { arcBeats, autoPlanReason, buildPlannerMessages, DEFAULT_LOW_THREADS, DEFAULT_PLANNER_PROMPT, DEFAULT_STALL_DAYS, noteAfterAccept, parsePlan, planToOps, summarizeTracker, validatePlan } from './src/planner.js';
import { buildCaptureMessages, parseCapture } from './src/capture.js';
import { importWorldStateAlpha } from './src/wsa.js';
import { DEFAULT_MAP, buildPlaceBook, estimateTrip, findBookPlace, formatTrip, mapSettings, nearbyByCoords } from './src/places.js';
import { isSourceOfTruth, storySuite } from './src/suite.js';
import { makeManage, sourceChoices as validSourceChoices, suiteAnnouncement, suiteOpener } from './src/manage.js';

const VERSION = '0.9.38';
const SETTINGS_KEY = 'storyDirector';
// (0.9.38) Story Suite's cache-friendly layout: the fixed part of the note early (in the
// prompt, after the main prompt), byte-identical every reply; the rest at the end of the chat.
// PROMPT_KEY is the one key before 0.9.38, cleared on load.
const PROMPT_KEY = 'story_director';
const STATIC_KEY = 'story_suite_static_story_director';
const TAIL_KEY = 'story_suite_tail_2_story_director';
const EXTENSION_PROMPT_IN_PROMPT = 0;
const BLOCK = { id: 'story-director', tag: 'Director', name: 'Story Director', icon: '🎬' };
const TAB_ID = 'story-director';
const QUESTS_TAB_ID = 'story-director-quests';
const JOURNAL_TAB_ID = 'story-director-journal';
const EXTENSION_PROMPT_IN_CHAT = 1;
const EXTENSION_PROMPT_ROLE_SYSTEM = 0;
const MIN_STORY_BLOCK_API = 1;
// Story Suite: who we are, and the areas we can be the source of truth for.
const SUITE = Object.freeze({ id: 'story-director', name: 'Story Director', areas: Object.freeze(['calendar', 'timeline', 'npc']) });
// The settings panel's root under #extensions_settings, which Story Suite's overlay borrows.
const PANEL_ID = 'story_director_settings';

const DEFAULT_SETTINGS = Object.freeze({
    enabled: true,
    sceneTag: 'World_State',
    // (0.9.38) The note's part for this reply goes at the very end (Story Suite's layout).
    depth: 0,
    budgetTokens: DEFAULTS.budgetTokens,
    dormantReplies: DEFAULTS.dormantReplies,
    dormantDays: DEFAULTS.dormantDays,
    dueSoonDays: DEFAULTS.dueSoonDays,
    mirrorOffscreen: true,
    // The tracker is the story behind the scenes: hidden in the tab until the reader asks.
    spoilerGuard: true,
    // (0.9.34) Take on only while the offer's giver is in the scene (or "I'm with them").
    giverPresent: true,
    calendar: PRESETS.gregorian,
    arc: Object.freeze({ trigger: 'manual', model: { source: 'chat' }, recent: 60, maxTokens: 1500, stallDays: DEFAULT_STALL_DAYS, lowThreads: DEFAULT_LOW_THREADS, autoAccept: false, genre: '', note: '', keepNote: false, prompt: '' }),
    capture: Object.freeze({ mode: 'off', model: { source: 'chat' }, maxTokens: 800 }),
    // How to read map coordinates: which way north and east run, km per unit, road winding.
    map: DEFAULT_MAP,
    // Per Story Suite area: 'auto' (the suite's order), 'mine' or 'theirs'.
    sourceOfTruth: Object.freeze({ calendar: 'auto', timeline: 'auto', npc: 'auto' }),
});

let initialized = false;
let registered = false;
let uiRetry = null;
let lastFindings = [];
let lastFindingsKey = '';
// Replay cache: one entry per message of the active chat, { sig, tracker, problems, … }.
// `base`: (0.9.30) the message whose entry is a checkpoint, -1 for a replay from the start.
let cache = { chatId: null, entries: [], base: -1 };
// The loaded world pack, rebuilt only when the stored JSON object changes.
let packCache = { source: null, pack: null };
let settingsPanel = null;
// Arc planning: one call at a time, and its last error for the tab.
let planning = false;
let planError = '';
// Chats whose behind-the-scenes view the reader opened this session.
const revealed = new Set();

// ---------------------------------------------------------------------------
// SillyTavern and Story Block access

function context() {
    return globalThis.SillyTavern?.getContext?.() ?? null;
}

function storyBlock() {
    const api = globalThis.StoryBlock;
    return api && Number(api.apiVersion) >= MIN_STORY_BLOCK_API ? api : null;
}

function chatIdOf(ctx) {
    try { return ctx?.getCurrentChatId?.() ?? ctx?.chatId ?? null; }
    catch { return ctx?.chatId ?? null; }
}

function notify(level, message, options) {
    return globalThis.toastr?.[level]?.(message, 'Story Director', options);
}

function reportStatus(text) {
    const status = globalThis.document?.getElementById?.('story_director_status');
    if (status) status.textContent = text;
}

function isAssistant(message) {
    return Boolean(message) && !message.is_user && !message.is_system;
}

// (0.9.29) A reply hidden from the model (SillyTavern's hide, or an extension that hides old
// messages to save context) is still the story: its Director and scene blocks stay part of the
// tracker, so hiding the reply that started a quest never loses the quest. A hidden message
// without either block (a system note, a battle hand-off) is not a reply.
function isStoryReply(message, sb = storyBlock(), sceneTag = settings().sceneTag) {
    if (isAssistant(message)) return true;
    if (!message || message.is_user || !message.is_system || !sb?.blockInText) return false;
    return Boolean(sb.blockInText(message.mes, BLOCK.tag) || sb.blockInText(message.mes, sceneTag));
}

// Quiet and impersonate generations are other features' prompts, not the story's reply.
function isBackground(type) {
    const kind = String(type ?? 'normal').toLowerCase();
    return kind === 'quiet' || kind === 'impersonate';
}

function replacesLastReply(chat, type) {
    const kind = String(type ?? 'normal').toLowerCase();
    return (kind.includes('swipe') || kind.includes('regenerate')) && isAssistant(chat.at(-1));
}

// ---------------------------------------------------------------------------
// Settings

function settings(ctx = context()) {
    const store = ctx?.extensionSettings;
    if (!store) return { ...DEFAULT_SETTINGS };
    const saved = store[SETTINGS_KEY] && typeof store[SETTINGS_KEY] === 'object' ? store[SETTINGS_KEY] : {};
    // (0.9.38) A depth left at the old default (1) moves to the end, once; one set by hand stays.
    const layout = saved.suiteLayout === 1 ? {} : { suiteLayout: 1, ...(saved.depth === undefined || Number(saved.depth) === 1 ? { depth: 0 } : {}) };
    store[SETTINGS_KEY] = {
        ...DEFAULT_SETTINGS,
        ...saved,
        ...layout,
        calendar: normalizeCalendar(saved.calendar ?? DEFAULT_SETTINGS.calendar),
        arc: { ...DEFAULT_SETTINGS.arc, ...(saved.arc && typeof saved.arc === 'object' ? saved.arc : {}) },
        capture: { ...DEFAULT_SETTINGS.capture, ...(saved.capture && typeof saved.capture === 'object' ? saved.capture : {}) },
        map: mapSettings(saved.map),
        sourceOfTruth: sourceChoices(saved.sourceOfTruth),
    };
    return store[SETTINGS_KEY];
}

function sourceChoices(saved) {
    return validSourceChoices(saved, SUITE.areas);
}

function saveSettings(ctx = context()) {
    ctx?.saveSettingsDebounced?.();
}

function calendar() {
    return makeCalendar(settings().calendar);
}

function relevanceSettings(own = settings()) {
    return {
        budgetTokens: Number(own.budgetTokens) || DEFAULTS.budgetTokens,
        dormantReplies: Number(own.dormantReplies) || DEFAULTS.dormantReplies,
        dormantDays: Number(own.dormantDays) || DEFAULTS.dormantDays,
        dueSoonDays: Number(own.dueSoonDays) >= 0 ? Number(own.dueSoonDays) : DEFAULTS.dueSoonDays,
    };
}

// The reader's map, stored raw in the settings and normalized once.
function worldPack() {
    const source = settings().worldPack ?? null;
    if (source !== packCache.source) {
        packCache = { source, pack: source ? loadWorldPack(source).pack : null };
    }
    return packCache.pack;
}

// Pins are the reader's, not the story's: kept per chat, laid over the replayed records.
function chatMeta(ctx = context()) {
    return ctx?.chatMetadata ?? ctx?.chat_metadata ?? null;
}

function pins(ctx = context()) {
    const list = chatMeta(ctx)?.[SETTINGS_KEY]?.pins;
    return new Set(Array.isArray(list) ? list : []);
}

function setPin(id, pinned) {
    const ctx = context();
    const meta = chatMeta(ctx);
    if (!meta) return;
    const next = pins(ctx);
    if (pinned) next.add(id); else next.delete(id);
    meta[SETTINGS_KEY] = { ...(meta[SETTINGS_KEY] ?? {}), pins: [...next] };
    ctx.saveMetadataDebounced?.();
    storyBlock()?.refresh?.();
}

// ---------------------------------------------------------------------------
// Reading messages

// Visible narration only: the hidden envelope and other comments are machine state.
function visibleText(message) {
    return String(message?.mes ?? '').replace(/<!--[\s\S]*?-->/g, '').trim();
}

// `**📅 Time:** CY 611, Haywane 12, 05:35 pm | **🌤 Loc:** …`: the value of one header cell.
const CELL_LABEL = String.raw`\**\s*(?:\p{Extended_Pictographic}️?\s*)?`;

function headerCell(text, labels) {
    const pattern = new RegExp(`(?:^|\\|)\\s*${CELL_LABEL}(?:${labels})\\s*:\\**\\s*([^\\n]*)`, 'iu');
    const match = pattern.exec(String(text ?? ''));
    if (!match) return '';
    // The cell runs until the next labelled cell (`| **🌡 Wx:**`); pipes inside it stay.
    const next = new RegExp(`\\s*\\|\\s*(?=${CELL_LABEL}[\\p{L} ]{1,20}:)`, 'u');
    return match[1].split(next)[0].replace(/\*\*/g, '').trim();
}

function sceneTimeText(sceneText) {
    return headerCell(sceneText, 'time|date');
}

function scenePlace(sceneText) {
    // Coordinates (`[59.0, 110.0]`) say nothing a place name matcher can use.
    return headerCell(sceneText, 'loc|location|place')
        .replace(/\[[^\]]*\]/g, '')
        .replace(/\s*\|\s*/g, ' | ')
        .replace(/[|\s]+$/, '')
        .trim();
}

function signature(message) {
    const text = String(message?.mes ?? '');
    let hash = 5381;
    for (let index = 0; index < text.length; index++) hash = ((hash * 33) ^ text.charCodeAt(index)) >>> 0;
    // (0.9.15) The reader's abandon stamp is part of what a reply says.
    const stamp = [...abandonedStamp(message), ...takenStamp(message).map(id => `+${id}`)].join('|');
    return `${message?.is_user ? 'u' : 'a'}:${text.length}:${hash}${stamp ? `:${stamp}` : ''}`;
}

// One replay entry per message: its change lines (assistant replies only), its narration
// (for "seen"), and the story time its scene block states.
// (0.9.15) The reader's message(s) a reply answers: every user message since the reply before
// it, or null when there is none (a greeting, a reply after another reply).
function saidBefore(chat, index, isReply = isAssistant) {
    const said = [];
    for (let at = index - 1; at >= 0 && !isReply(chat[at]); at--) {
        if (chat[at]?.is_user) said.unshift(visibleText(chat[at]));
    }
    return said.length ? said.join('\n') : null;
}

function entryFor(message, index, sb, cal, own, reference, said = null) {
    const assistant = isStoryReply(message, sb, own.sceneTag);
    const block = assistant ? sb.blockInText(message.mes, BLOCK.tag) : null;
    const parsed = block ? parseChanges(block.text) : { ops: [], errors: [] };
    const scene = assistant ? sb.blockInText(message.mes, own.sceneTag) : null;
    const timeText = scene ? sceneTimeText(scene.text) : '';
    const date = timeText ? cal.parse(timeText, { reference }) : null;
    return {
        entry: { message: index, ops: block ? parsed.ops : null, text: visibleText(message), time: date ? date.abs : null, ...(assistant ? { said, chosen: abandonedStamp(message), taken: takenStamp(message) } : {}) },
        location: scene ? headerCell(scene.text, 'loc|location|place') : '',
        hadBlock: Boolean(block),
        parseErrors: parsed.errors,
    };
}

// One message read into a cache entry, after the entry before it (`previous`).
function readEntry(chat, index, previous, sb, cal, own) {
    const seed = previous?.tracker ?? emptyTracker();
    const read = entryFor(chat[index], index, sb, cal, own, seed.time ?? null, saidBefore(chat, index, message => isStoryReply(message, sb, own.sceneTag)));
    const result = replay([read.entry], { seed });
    return {
        sig: signature(chat[index]),
        tracker: result.tracker,
        problems: result.problems,
        hadBlock: read.hadBlock,
        parseErrors: read.parseErrors,
        location: read.location ? { message: index, time: read.entry.time ?? seed.time ?? null, text: read.location } : null,
    };
}

// (0.9.30) Checkpoints: the tracker kept at the back of the chat (src/checkpoints.js), in its
// metadata, so the messages before one are never read again.
function checkpointKey(own = settings()) {
    return JSON.stringify([own.calendar ?? null, own.sceneTag ?? '']);
}

function checkpoints(ctx = context()) {
    const list = chatMeta(ctx)?.[SETTINGS_KEY]?.checkpoints;
    return Array.isArray(list) ? list : [];
}

// The cache entry a checkpoint stands for, at `index` (where its reply is now).
function checkpointEntry({ index, point }, chat) {
    const delta = index - point.message;
    const visits = shiftVisits(point.visits, delta);
    return {
        sig: signature(chat[index]),
        tracker: shiftTracker(point.tracker, delta),
        problems: [],
        hadBlock: true,
        parseErrors: [],
        location: visits.at(-1)?.message === index ? visits.at(-1) : null,
        visits,
        checkpoint: true,
    };
}

// The place visits up to and including message `upTo`, from the cache.
function visitsUpTo(upTo) {
    return cache.entries.slice(0, upTo + 1).flatMap(entry => (entry ? entry.visits ?? (entry.location ? [entry.location] : []) : []));
}

// After a read through the newest message: keep a checkpoint once one is due.
function keepCheckpoint(ctx, chat, sb, own) {
    const meta = chatMeta(ctx);
    if (!meta) return;
    const points = checkpoints(ctx);
    const key = checkpointKey(own);
    const replies = [];
    chat.forEach((message, index) => { if (isStoryReply(message, sb, own.sceneTag)) replies.push(index); });
    const newest = usableCheckpoint(points, chat, { signature, upTo: chat.length - 1, key });
    const at = checkpointDue(replies, newest ? newest.index : null);
    if (at === null || at <= cache.base || !cache.entries[at]) return;
    const point = {
        message: at,
        sig: cache.entries[at].sig,
        sendDate: String(chat[at]?.send_date ?? ''),
        key,
        version: VERSION,
        tracker: compactTracker(cache.entries[at].tracker),
        visits: compactVisits(visitsUpTo(at)),
    };
    meta[SETTINGS_KEY] = { ...(meta[SETTINGS_KEY] ?? {}), checkpoints: withCheckpoint(points, point) };
    ctx.saveMetadataDebounced?.();
}

/**
 * The tracker after message `upTo` (inclusive), replaying only what changed since the last
 * call: { tracker, problems (from that message), info (its cache entry) }. (0.9.30) It starts
 * from the newest checkpoint it can use, so messages before that are not read; one asked for
 * before it is read from the start, without the cache.
 */
function trackerAt(upTo) {
    const ctx = context();
    const sb = storyBlock();
    const chat = ctx?.chat ?? [];
    const chatId = chatIdOf(ctx);
    if (!sb || !chatId) return { tracker: emptyTracker(), problems: [], info: null };
    if (cache.chatId !== chatId) cache = { chatId, entries: [], base: -1 };
    const own = settings(ctx);
    const cal = calendar();
    const last = Math.min(Number(upTo), chat.length - 1);

    // The checkpoint's reply changed or went (a swipe, an edit, a rollback past it): start over.
    if (cache.base >= 0 && cache.entries[cache.base]?.sig !== signature(chat[cache.base])) cache = { chatId, entries: [], base: -1 };
    if (!cache.entries.length) {
        const found = usableCheckpoint(checkpoints(ctx), chat, { signature, upTo: chat.length - 1, key: checkpointKey(own) });
        if (found) {
            cache.base = found.index;
            cache.entries[found.index] = checkpointEntry(found, chat);
        }
    }
    if (last < cache.base) {
        // Before the checkpoint: read from the start, with whatever messages are still there.
        let entry = null;
        for (let index = 0; index <= last; index++) entry = readEntry(chat, index, entry, sb, cal, own);
        return { tracker: entry?.tracker ?? emptyTracker(), problems: entry?.problems ?? [], info: entry };
    }

    // Resume from the first message whose text (or role) changed.
    let start = cache.base + 1;
    while (start <= last && cache.entries[start]?.sig === signature(chat[start])) start++;
    if (start < cache.entries.length) cache.entries.length = start;
    for (let index = start; index <= last; index++) {
        cache.entries[index] = readEntry(chat, index, cache.entries[index - 1], sb, cal, own);
    }
    if (start <= last && last === chat.length - 1) keepCheckpoint(ctx, chat, sb, own);
    const at = last >= 0 ? cache.entries[last] : null;
    return { tracker: at?.tracker ?? emptyTracker(), problems: at?.problems ?? [], info: at ?? null };
}

// The place book up to message `upTo`, from the locations the replay cache already read.
let placeCache = { key: '', book: null };
function placeBookAt(upTo) {
    trackerAt(upTo);
    const last = Math.min(Number(upTo), cache.entries.length - 1);
    const pack = worldPack();
    const key = [cache.chatId, last, last >= 0 ? cache.entries[last]?.sig : '', pack ? packSummary(pack) : ''].join('|');
    if (placeCache.key !== key) {
        const visits = visitsUpTo(last);
        placeCache = { key, book: buildPlaceBook(visits, { pack }) };
    }
    return placeCache.book;
}

function withPins(tracker) {
    const pinned = pins();
    if (!pinned.size) return tracker;
    return { ...tracker, records: tracker.records.map(record => (pinned.has(record.id) ? { ...record, pinned: true } : record)) };
}

// The scene the model will see for this generation, and what the tracker says around it.
function situation(type = 'normal') {
    const ctx = context();
    const sb = storyBlock();
    const chat = ctx?.chat ?? [];
    const own = settings(ctx);
    const replacing = replacesLastReply(chat, type);
    const upTo = replacing ? chat.length - 2 : chat.length - 1;
    const scene = sb?.blockForGeneration?.(own.sceneTag, type) ?? null;
    return situationAt(upTo, scene?.text ?? '');
}

// The scene block in force at message `upTo`: the newest one written at or before it.
function sceneTextAt(upTo) {
    const ctx = context();
    const sb = storyBlock();
    const chat = ctx?.chat ?? [];
    const tag = settings(ctx).sceneTag;
    for (let index = Math.min(upTo, chat.length - 1); index >= 0; index--) {
        if (!isStoryReply(chat[index], sb, tag)) continue;
        const scene = sb?.blockInText?.(chat[index].mes, tag);
        if (scene?.text) return scene.text;
    }
    return '';
}

// What the tracker says around the scene `sceneText` after message `upTo`: the same reading
// the note uses, so another extension asking about a message sees what the note saw.
function situationAt(upTo, sceneText) {
    const ctx = context();
    const chat = ctx?.chat ?? [];
    const own = settings(ctx);
    const cal = calendar();
    const { tracker } = trackerAt(upTo);
    const parsed = sceneText ? cal.parse(sceneTimeText(sceneText), { reference: tracker.time }) : null;
    const now = parsed?.abs ?? tracker.time ?? null;
    const recent = chat.slice(Math.max(0, upTo - 1), upTo + 1).map(visibleText).join('\n');
    const place = scenePlace(sceneText);
    // With a map, places one road away count as "here" for relevance; without roads, places
    // close by on the map's coordinates.
    const roads = nearbyPlaces(worldPack(), place);
    const nearby = roads.length ? roads : nearbyByCoords(placeBookAt(upTo), place, { map: own.map }).map(entry => entry.name);
    const selection = classify(withPins(tracker), {
        calendar: cal,
        now,
        message: Math.max(upTo, 0),
        place: [place, ...nearby].filter(Boolean).join(' | '),
        sceneText,
        recentText: recent,
        settings: relevanceSettings(own),
    });
    // The neighbours only widen relevance; the note's header names the scene's own place.
    selection.place = place;
    return { tracker, selection, now, place, sceneText, upTo };
}

// ---------------------------------------------------------------------------
// Before a reply: the note

/** The note as sent: `{ fixed, tail }` ('' clears; a string sets the tail alone, fixed cleared). */
function setNote(note) {
    const ctx = context();
    if (typeof ctx?.setExtensionPrompt !== 'function') return;
    const { fixed = '', tail = '' } = typeof note === 'string' ? { tail: note } : note ?? {};
    const depth = Math.max(0, Math.min(20, Number(settings(ctx).depth) || 0));
    ctx.setExtensionPrompt(STATIC_KEY, fixed, EXTENSION_PROMPT_IN_PROMPT, 0, false, EXTENSION_PROMPT_ROLE_SYSTEM);
    ctx.setExtensionPrompt(TAIL_KEY, tail, EXTENSION_PROMPT_IN_CHAT, depth, false, EXTENSION_PROMPT_ROLE_SYSTEM);
    // The single key before 0.9.38 never carries a copy.
    ctx.setExtensionPrompt(PROMPT_KEY, '', EXTENSION_PROMPT_IN_CHAT, depth, false, EXTENSION_PROMPT_ROLE_SYSTEM);
}

/** The note for the next reply in its two parts, `{ fixed, tail }`, macros substituted. */
function noteFor(ctx, selection, options) {
    const substitute = typeof ctx.substituteParams === 'function' ? text => ctx.substituteParams(text) : text => text;
    const parts = noteParts(selection, options);
    const fixed = staticNote({ instruction: options.instruction ?? CHANGE_INSTRUCTION, npcPlansOnly: options.npcPlansOnly });
    return { fixed: substitute(fixed), tail: substitute(tailNote(parts)) };
}

// Corrections for the `~`/`!` lines the newest assistant reply at or before `upTo` wrote on
// keys that are not tracked: in the next note only, never again after another reply.
function latestReplyCorrections(upTo) {
    trackerAt(upTo);
    const chat = context()?.chat ?? [];
    for (let index = Math.min(Number(upTo), cache.entries.length - 1); index >= 0; index--) {
        if (isAssistant(chat[index])) return untrackedCorrections(cache.entries[index]?.problems, { message: index });
    }
    return [];
}

// (0.9.19) The story time before the newest assistant reply at or before `upTo`: where the
// note's While away part measures a jump from (to the scene's time now). Null before any reply
// or any known time.
function timeBeforeLatestReply(upTo) {
    trackerAt(upTo);
    const chat = context()?.chat ?? [];
    for (let index = Math.min(Number(upTo), cache.entries.length - 1); index >= 0; index--) {
        if (isAssistant(chat[index])) return cache.entries[index - 1]?.tracker?.time ?? null;
    }
    return null;
}

// The newest assistant reply at or before `upTo` (-1 when there is none).
function latestReplyAt(upTo) {
    const chat = context()?.chat ?? [];
    for (let index = Math.min(Number(upTo), chat.length - 1); index >= 0; index--) {
        if (isAssistant(chat[index])) return index;
    }
    return -1;
}

// How the note is built for a reply: the same for the injected note and for its token count.
// (0.9.23) How far back the note looks for places in play.
const RECENT_DISTANCE_MESSAGES = 10;

function noteOptions(ctx, tracker, upTo, place = '') {
    const cal = calendar();
    // With capture writing every reply's changes, the model is not asked to.
    const asks = settings(ctx).capture.mode !== 'always';
    const instructionless = asks ? {} : { instruction: '' };
    const fixes = corrections(travelFindings(tracker, { pack: worldPack(), calendar: cal }));
    // The last reply's `~`/`!` lines on keys that are not tracked, while the model writes them.
    if (asks) fixes.push(...latestReplyCorrections(upTo));
    // (0.9.3) While the scene block's Off-Screen carries the agendas, the note does not repeat them.
    const offscreenInBlock = Boolean(settings(ctx).mirrorOffscreen && isSource('timeline', settings(ctx)) && storyBlock()?.getBlock?.(settings(ctx).sceneTag)?.text);
    // (0.9.6) The reader's latest message, read for a job given up; (0.9.15) only theirs, and
    // for an offer taken on or turned down too: choices are the reader's.
    const chat = ctx?.chat ?? [];
    const lastUser = [...chat].reverse().find(message => message?.is_user);
    const said = visibleText(lastUser);
    const givenUp = asks ? givenUpIn(tracker, said) : [];
    const taking = asks ? offersChosenIn(tracker, said, 'accept') : [];
    const declining = asks ? offersChosenIn(tracker, said, 'refuse') : [];
    // (0.9.19) What came due while the story skipped ahead, told as a recap: with or without
    // change lines, since it is about the narration.
    const previousTime = timeBeforeLatestReply(upTo);
    // (0.9.19) Beats that slipped and offers that lapsed in the latest reply: in this note only.
    const latest = latestReplyAt(upTo);
    const { slipped, lapsed } = lapsesIn(tracker, latest);
    // (0.9.22) How far the places the story and the reader just named really are, by the
    // world pack's roads, and whether the reply said otherwise.
    const pack = worldPack();
    // (0.9.23) On every reply, for the places in play: also those of the open records (most
    // recently seen first; never a secret's) and of the last few messages.
    const records = pack ? tracker.records
        .filter(record => record.status === 'active' && record.kind !== 'secret')
        .sort((a, b) => (b.seen?.message ?? -1) - (a.seen?.message ?? -1))
        .map(record => [record.key, ...Object.values(record.fields ?? {})].join('. ')) : [];
    const recent = pack ? chat.slice(Math.max(0, upTo - RECENT_DISTANCE_MESSAGES + 1), upTo + 1).reverse().filter(message => message !== chat[latest]).map(visibleText) : [];
    const distances = pack ? distancesFor(pack, place, { reply: latest >= 0 ? visibleText(chat[latest]) : '', message: said, records, recent }) : [];
    const distanceFrom = distances.length ? placesIn(pack, place)[0] : '';
    return { calendar: cal, budgetTokens: relevanceSettings().budgetTokens, corrections: fixes, npcPlansOnly: !isSource('npc'), offscreenInBlock, givenUp, taking, declining, previousTime, slipped, lapsed, distances, distanceFrom, ...instructionless };
}

/**
 * What Story Director adds to the next ordinary reply, for Story Suite's overlay
 * (api.manage.tokens): the note as it would be injected now, in its parts, and the allowance
 * for the change lines it asks for. Planner and capture calls are quiet calls of their own and
 * not counted. Nothing while the note is not sent (tracking off, no chat, no Story Block).
 */
function nextReplyTokens() {
    const ctx = context();
    if (!ctx || !chatIdOf(ctx) || !storyBlock() || !settings(ctx).enabled) return noteTokens([]);
    const { selection, tracker, upTo } = situation('normal');
    const substitute = typeof ctx.substituteParams === 'function' ? text => ctx.substituteParams(text) : text => text;
    const parts = noteParts(selection, noteOptions(ctx, tracker, upTo, selection.place)).map(entry => ({ ...entry, text: substitute(entry.text) }));
    return noteTokens(parts);
}

/**
 * (0.9.34) What's sent: the note as the next ordinary reply would get it, built now and
 * changing nothing: { label, text, tokens } ('' while no note is sent).
 */
function notePreview() {
    const label = 'Story Director note';
    try {
        const ctx = context();
        if (!ctx || !chatIdOf(ctx) || !storyBlock() || !settings(ctx).enabled) return { label, text: '', tokens: 0 };
        const { selection, tracker, upTo } = situation('normal');
        const note = noteFor(ctx, selection, { ...noteOptions(ctx, tracker, upTo, selection.place), ...choicesFor(ctx.chat?.length ?? 0, tracker, { peek: true }) });
        // Both parts, as the model reads them: the fixed one early in the prompt, the rest at the end.
        const text = [note.fixed, note.tail].filter(Boolean).join('\n\n');
        return { label, text, tokens: text ? estimateTokens(text) : 0 };
    } catch (error) {
        console.error('[Story Director] preview failed', error);
        return { label, text: '', tokens: 0 };
    }
}

async function onGenerationInterceptor(_chat, _contextSize, _abort, type = 'normal') {
    try {
        if (isBackground(type)) return;
        const ctx = context();
        if (!ctx || !chatIdOf(ctx) || !storyBlock() || !settings(ctx).enabled) {
            setNote('');
            return;
        }
        const { selection, tracker, upTo } = situation(type);
        const slot = replacesLastReply(ctx.chat ?? [], type) ? (ctx.chat?.length ?? 1) - 1 : ctx.chat?.length ?? 0;
        const note = noteFor(ctx, selection, { ...noteOptions(ctx, tracker, upTo, selection.place), ...choicesFor(slot, tracker) });
        setNote(note);
        const counted = selection.due.length + selection.arriving.length + selection.relevant.length;
        reportStatus(`Last reply: note sent (${counted} tracked ${counted === 1 ? 'item' : 'items'}, ~${estimateTokens(note.fixed) + estimateTokens(note.tail)} tokens, ~${estimateTokens(note.fixed)} of them fixed).`);
    } catch (error) {
        // A broken note must never block the reply.
        console.error('[Story Director] note failed', error);
        setNote('');
    }
}

globalThis.storyDirectorInterceptor = onGenerationInterceptor;

// A small read-only API for other extensions (RPG Battle recovers HP with story time). The
// same object is what Story Director shares through the Story Suite.
const API = Object.freeze({
    apiVersion: 1,
    get version() { return VERSION; },
    /** The reader's calendar, `{ era, months: [{ name, days }] }` as plain copies (Gregorian until set). */
    calendar() {
        try {
            return sharedCalendar(settings().calendar);
        } catch {
            return sharedCalendar(DEFAULT_SETTINGS.calendar);
        }
    },
    /** The story time (minutes on the reader's calendar) known at message `index`, or null. */
    timeAt(index) {
        try {
            const chat = context()?.chat ?? [];
            if (!storyBlock() || !chat.length) return null;
            const at = Math.min(Number(index), chat.length - 1);
            if (!(at >= 0)) return null;
            const time = trackerAt(at).tracker.time;
            return typeof time === 'number' && Number.isFinite(time) ? time : null;
        } catch {
            return null;
        }
    },
    /** A story time as the calendar writes it ("CY 611, Haywane 12, 05:35 pm"). */
    formatTime(abs) {
        try {
            return typeof abs === 'number' && Number.isFinite(abs) ? calendar().format(abs) : '';
        } catch {
            return '';
        }
    },
    /**
     * The planned fights the story has reached at message `index`, read the way the note
     * reads the scene there: `[{ key, id, kind, encounter, place, on, status }]`, due (or
     * arriving) ones first as `'due'`, then those within the due-soon window as `'soon'`.
     * Story Director only hands them over; the fight and its outcome belong to the caller
     * and the story (the model closes the record with a `!` or `-` line when it narrates it).
     */
    encountersAt(index) {
        try {
            const chat = context()?.chat ?? [];
            if (!storyBlock() || !chat.length || !settings().enabled) return [];
            const at = Math.min(Number(index), chat.length - 1);
            if (!(at >= 0)) return [];
            const { selection, now } = situationAt(at, sceneTextAt(at));
            return encountersIn(selection, { calendar: calendar(), now, dueSoonDays: relevanceSettings().dueSoonDays, message: at });
        } catch {
            return [];
        }
    },
    /**
     * The quests finished in the assistant reply at `index` (a `-` line there closed them, not
     * as failed): `[{ id, name, type, difficulty, reward, giver }]`, `difficulty` one of easy,
     * normal, hard, nightmare. Quests finished in earlier replies are not listed, so a swipe
     * or an edit of that reply is read afresh. RPG Battle offers quest XP with it.
     */
    /** (0.9.34) The note the next reply would get, as text: { label, text, tokens }. */
    preview() {
        return notePreview();
    },
    questsDoneAt(index) {
        try {
            const chat = context()?.chat ?? [];
            const at = Number(index);
            if (!storyBlock() || !settings().enabled) return [];
            if (!Number.isInteger(at) || at < 0 || at >= chat.length || !isAssistant(chat[at])) return [];
            return questsDoneIn(trackerAt(at).tracker, at);
        } catch {
            return [];
        }
    },
});
globalThis.StoryDirector = API;

// ---------------------------------------------------------------------------
// Story Suite: working alone and together (docs/STORY_SUITE.md)

// What was last announced ('' = withdrawn, 'off' = switched off), so the same state is never
// announced twice: every announcement wakes every extension's listener.
let announced = null;
let suiteWatched = false;

// Story Suite's overlay changes the Source of truth choices and the tracking switch through
// this, the same path as an edit in the panel (src/manage.js).
const MANAGE = makeManage({
    areas: SUITE.areas,
    read: () => settings(),
    save: next => applySettings(next),
    panel: () => settingsPanel,
    tokens: () => nextReplyTokens(),
    // (0.9.34) What's sent, for a suite overlay that shows it (an extra the contract allows).
    preview: () => notePreview(),
});
// What the suite gets as `api`: globalThis.StoryDirector plus `manage`, built once, so the
// global stays read-only and every announcement hands over the same object.
const SUITE_API = Object.freeze({ ...API, manage: MANAGE });

/**
 * Offered while the story is tracked (the switch on, Story Block there): the calendar, the
 * timeline and NPCs, except an area the reader gave to "the other one", so the others take it
 * on Automatic. Switched off, announced with `enabled: false` so Story Suite's overlay can
 * switch it back on; withdrawn while Story Block is missing.
 */
function announceToSuite() {
    try {
        const { key, provider } = suiteAnnouncement({ id: SUITE.id, name: SUITE.name, version: VERSION, areas: SUITE.areas, settings: settings(), storyBlock: Boolean(storyBlock()), api: SUITE_API, panel: `#${PANEL_ID}` });
        if (key === announced) return;
        announced = key;
        if (provider) storySuite().announce(provider);
        else storySuite().withdraw(SUITE.id);
    } catch (error) {
        console.warn('[Story Director] could not announce to the Story Suite', error);
    }
}

/** Whether Story Director is the source of truth for `area`; true alone, and on any failure. */
function isSource(area, own = settings()) {
    try {
        return isSourceOfTruth(SUITE.id, area, own.sourceOfTruth?.[area] ?? 'auto');
    } catch {
        return true;
    }
}

function otherSuiteNames() {
    try {
        return storySuite().providers().filter(provider => provider.id !== SUITE.id && provider.enabled).map(provider => String(provider.name || provider.id));
    } catch {
        return [];
    }
}

function suiteLinkShown() {
    return Boolean(suiteOpener(storySuite()));
}

function openSuite() {
    try {
        suiteOpener(storySuite())?.(SUITE.id);
    } catch (error) {
        console.warn('[Story Director] could not open Story Suite', error);
    }
}

// The note, the planner and the mirror ask isSource when they run, so only the settings'
// list of who is here and the Story Suite link need a refresh. Nothing here announces: that
// would wake everyone again.
function watchSuite() {
    if (suiteWatched) return;
    try {
        storySuite().onChange(() => {
            settingsPanel?.setOthers?.(otherSuiteNames());
            settingsPanel?.setSuiteLink?.(suiteLinkShown());
        });
        suiteWatched = true;
    } catch (error) {
        console.warn('[Story Director] could not join the Story Suite', error);
    }
}

// ---------------------------------------------------------------------------
// After a reply: checks and the Off-Screen mirror

async function onReply({ messageIndex }) {
    const ctx = context();
    const sb = storyBlock();
    if (!ctx || !sb || !settings(ctx).enabled) return;
    const index = Number(messageIndex);
    const chat = ctx.chat ?? [];
    if (!isAssistant(chat[index])) return;
    try {
        // Capture first, so the checks below see the changes it wrote.
        if (settings(ctx).capture.mode !== 'off' && !sb.blockInText(chat[index].mes, BLOCK.tag)) await capture(index);
        await closeAbandoned(index);
        await closeLapsed(index);
        const before = trackerAt(index - 1).tracker;
        const { tracker: after, problems, info } = trackerAt(index);
        const block = sb.blockInText(chat[index].mes, BLOCK.tag);
        lastFindings = checkReply({
            before,
            after,
            ops: block ? parseChanges(block.text).ops : [],
            // Replay problems carry the message index in `message` and their words in `text`.
            applyProblems: problems.map(problem => ({ ...problem, message: problem.text ?? String(problem.message ?? '') })),
            parseErrors: info?.parseErrors ?? [],
            calendar: calendar(),
            now: after.time ?? before.time ?? null,
            hadBlock: Boolean(block),
        });
        // Legs the reply wrote or changed, against the map.
        lastFindings.push(...travelFindings(after, { pack: worldPack(), calendar: calendar(), previous: before, onlyChanged: true }));
        // (0.9.24) Travel times the reply's story just said, against the map, the moment it
        // arrives: a warning with a Fix that puts the map's figure into the reply.
        const wrong = worldPack() ? wrongDistances(worldPack(), situationAt(index, sceneTextAt(index)).place, visibleText(chat[index])) : [];
        lastFindings.push(...wrong.map(entry => ({ kind: 'distance', severity: 'warn', key: entry.place, message: distanceMessage(entry) })));
        wrong.slice(0, 2).forEach(entry => toastDistance(index, entry));
        const serious = lastFindings.filter(finding => finding.severity !== 'info' && finding.kind !== 'distance');
        if (serious.length) {
            // A problem's wording names agendas and plans; while hidden, only say there is one.
            const message = isLocked()
                ? `${serious.length} ${serious.length === 1 ? 'problem' : 'problems'} with the last reply's changes (see the Director tab).`
                : serious.slice(0, 3).map(finding => finding.message).join(' · ');
            notify('warning', message);
        }
        // Not while another extension keeps the timeline: its own Off-Screen list is the truth.
        if (settings(ctx).mirrorOffscreen && isSource('timeline', settings(ctx))) await mirror(index, after);
        // After the mirror: it rewrites the reply's scene block, which changes its signature.
        lastFindingsKey = findingsKey(index);
        if (settings(ctx).arc.trigger === 'auto') void maybePlanAutomatically(after);
    } catch (error) {
        console.error('[Story Director] reply check failed', error);
    }
    sb.refresh?.();
}

// (0.9.24) "“three days” to Ledgerford: by the map it is 18–33 days from Bluewatch Village (riding to wagon)."
function distanceMessage({ place, from, said, fastest, slowest, mode, days: tripDays }) {
    const days = value => (value < 3 ? Math.round(value * 2) / 2 : Math.round(value));
    const range = days(fastest.days) === days(slowest.days) ? `${days(fastest.days)} days by ${fastest.mode}` : `${days(fastest.days)}–${days(slowest.days)} days (${fastest.mode} to ${slowest.mode})`;
    // The way the sentence meant ("downstream": by boat), when it is not the quickest.
    const meant = mode && mode !== fastest.mode && Number.isFinite(tripDays) ? `; by ${mode}, ${days(tripDays)}` : '';
    return `“${said.text}” to ${place}: by the map it is ${range} from ${from}${meant}.`;
}

const htmlText = text => String(text ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

function toastDistance(index, entry) {
    const html = `${htmlText(distanceMessage(entry))}<div class="story-director-toast-actions"><button type="button" class="menu_button story-director-fix-distance">Fix: “${htmlText(entry.fix)}”</button></div>`;
    const toast = notify('warning', html, { escapeHtml: false, timeOut: 20000, extendedTimeOut: 8000, closeButton: true });
    try {
        const button = toast?.find?.('.story-director-fix-distance');
        button?.on?.('click', event => {
            event?.stopPropagation?.();
            void fixDistance(index, entry);
            globalThis.toastr?.clear?.(toast);
        });
    } catch (error) {
        console.warn('[Story Director] the distance fix could not be offered', error);
    }
}

/** The latest reply's distances off the map, as Director tab warnings with their Fix. */
function distanceFindings(index) {
    const pack = worldPack();
    const message = context()?.chat?.[index];
    if (!pack || !isAssistant(message)) return [];
    try {
        return wrongDistances(pack, situationAt(index, sceneTextAt(index)).place, visibleText(message)).map(entry => ({
            kind: 'distance', severity: 'warn', key: entry.place, message: distanceMessage(entry),
            fix: { label: `Fix: “${entry.fix}”`, onFix: () => void fixDistance(index, entry).then(() => storyBlock()?.refresh?.()) },
        }));
    } catch (error) {
        console.warn('[Story Director] distances could not be checked', error);
        return [];
    }
}

/** The reader's Fix: the map's figure written into the reply where the story put its own. */
async function fixDistance(index, entry) {
    const ctx = context();
    const message = ctx?.chat?.[index];
    const text = isAssistant(message) ? withFixedDistance(message.mes, entry) : null;
    if (text === null) {
        notify('info', 'That reply has changed since; nothing was fixed.');
        return;
    }
    message.mes = text;
    if (Array.isArray(message.swipes) && message.swipes.length) message.swipes[Number(message.swipe_id) || 0] = text;
    try {
        ctx.updateMessageBlock?.(index, message);
        await ctx.saveChat?.();
        const events = ctx.eventTypes ?? ctx.event_types ?? {};
        if (events.MESSAGE_EDITED) await ctx.eventSource?.emit?.(events.MESSAGE_EDITED, index);
        notify('success', `Fixed: ${entry.place} is now ${entry.fix} away in the story.`);
    } catch (error) {
        console.error('[Story Director] the distance fix failed', error);
        notify('error', 'The fix could not be saved.');
    }
}

function findingsKey(index) {
    const ctx = context();
    return `${chatIdOf(ctx)}:${index}:${signature(ctx?.chat?.[index])}`;
}

async function mirror(index, tracker) {
    // Until tracking has started (seeded, or a first record written), the Off-Screen lines
    // are still the model's own: overwriting them would lose what was never tracked.
    if (!tracker.records.length) return;
    const sb = storyBlock();
    const own = settings();
    const scene = sb.blockInText(context()?.chat?.[index]?.mes, own.sceneTag);
    if (!scene) return;
    // (0.9.26) Every agenda, closed ones too: the mirror writes the active ones and keeps the
    // story's own lines only for people the tracker has no agenda for.
    const next = mirrorOffscreen(scene.text, tracker.records.filter(record => record.kind === 'agenda'));
    if (next !== scene.text) await sb.setBlockText(index, own.sceneTag, next);
}

// ---------------------------------------------------------------------------
// Seeding from an existing World_State block

function latestAssistantIndex(chat) {
    for (let index = chat.length - 1; index >= 0; index--) if (isAssistant(chat[index])) return index;
    return -1;
}

function canSeed() {
    const scene = storyBlock()?.getBlock?.(settings().sceneTag);
    return Boolean(scene && seedFromWorldState(scene.text).ops.length);
}

async function seed() {
    const ctx = context();
    const sb = storyBlock();
    if (!ctx || !sb || !chatIdOf(ctx)) return notify('warning', 'Open a chat first.');
    const own = settings(ctx);
    const scene = sb.getBlock(own.sceneTag);
    if (!scene) return notify('info', `No ${own.sceneTag} block in this chat to seed from.`);
    const { ops, counts } = seedFromWorldState(scene.text);
    if (!ops.length) return notify('info', `The latest ${own.sceneTag} block has no Off-Screen, World, Hooks or Clocks lines.`);
    const target = latestAssistantIndex(ctx.chat ?? []);
    if (target < 0) return notify('warning', 'There is no reply to attach the tracker to yet.');

    const summary = Object.entries(counts)
        .filter(([, count]) => count)
        .map(([kind, count]) => `${count} ${kind}${count === 1 ? '' : 's'}`)
        .join(', ');
    const question = `Start tracking ${summary} from the latest ${own.sceneTag} block? They are written into the latest reply, so deleting that reply undoes this.`;
    const confirmed = typeof ctx.callGenericPopup === 'function'
        ? await ctx.callGenericPopup(question, ctx.POPUP_TYPE?.CONFIRM ?? 2)
        : globalThis.confirm?.(question);
    if (!confirmed) return;

    const existing = sb.blockInText(ctx.chat[target].mes, BLOCK.tag)?.text ?? '';
    const lines = ops.map(formatOp).join('\n');
    try {
        await sb.setBlockText(target, BLOCK.tag, existing ? `${existing}\n${lines}` : lines);
        notify('success', `Tracking ${summary}.`);
    } catch (error) {
        notify('error', `Could not seed: ${error instanceof Error ? error.message : String(error)}`);
    }
}

// ---------------------------------------------------------------------------
// The sidebar tab

function tabKey() {
    const ctx = context();
    const chat = ctx?.chat ?? [];
    // The world pack can be large and only changes with its summary.
    const { worldPack: pack, ...rest } = settings();
    const draft = arcDraft();
    return [chatIdOf(ctx), chat.length, signature(chat.at(-1)), [...pins()].join(','), lastFindingsKey, JSON.stringify(rest), pack ? packSummary(worldPack()) : '', planning, planError, draft?.key ?? '', isLocked()].join('|');
}

// Places the route tool offers: the world pack's, and any the story mapped with coordinates.
function routePlaces(book) {
    const names = new Set(Object.keys(worldPack()?.places ?? {}));
    for (const place of book?.places ?? []) if (place.coords) names.add(place.name);
    return [...names].sort((a, b) => a.localeCompare(b));
}

function isLocked(ctx = context()) {
    return settings(ctx).spoilerGuard !== false && !revealed.has(chatIdOf(ctx));
}

function setRevealed(show) {
    const chatId = chatIdOf(context());
    if (!chatId) return;
    if (show) revealed.add(chatId);
    else revealed.delete(chatId);
    storyBlock()?.refresh?.();
}

function renderDirectorTab(pane) {
    const cal = calendar();
    const { selection, now, place, tracker, upTo } = situation('normal');
    const book = placeBookAt(upTo);
    const chat = context()?.chat ?? [];
    const current = lastFindingsKey === findingsKey(latestAssistantIndex(chat));
    renderTab(pane, {
        timeText: now === null ? '' : cal.format(now),
        place,
        selection,
        // (0.9.25) Distances off the map are read from the latest reply now, so they show (with
        // their Fix) after a reload too, and go once fixed or swiped away.
        findings: [...(current ? lastFindings.filter(finding => finding.kind !== 'distance') : []), ...distanceFindings(latestAssistantIndex(chat))],
        canSeed: !tracker.records.length && canSeed(),
        onSeed: () => void seed(),
        onPin: (id, pinned) => setPin(id, pinned),
        route: routePlaces(book).length > 1 ? { places: routePlaces(book), era: travelEra(), onRoute: (from, to, mode) => routeText(from, to, { mode }) } : null,
        places: { book, map: settings().map, formatTime: time => (time === null ? '' : cal.format(time)) },
        arc: arcView(selection, tracker),
        spoiler: settings().spoilerGuard !== false
            ? { locked: isLocked(), onReveal: () => setRevealed(true), onHide: () => setRevealed(false) }
            : null,
        sent: () => notePreview(),
    });
}

// ---------------------------------------------------------------------------
// Arc planning (once per arc)

function arcDraft(ctx = context()) {
    const draft = chatMeta(ctx)?.[SETTINGS_KEY]?.draft;
    return draft && typeof draft === 'object' && draft.chatId === chatIdOf(ctx) ? draft : null;
}

function setArcDraft(draft) {
    const ctx = context();
    const meta = chatMeta(ctx);
    if (!meta) return;
    meta[SETTINGS_KEY] = { ...(meta[SETTINGS_KEY] ?? {}), draft: draft ?? null };
    ctx.saveMetadataDebounced?.();
}

// (0.9.19) Where the last plan was asked for: { chatId, message } (the latest reply then), so
// "running low" waits for the story to move on instead of asking again every reply.
function lastPlan(ctx = context()) {
    const mark = chatMeta(ctx)?.[SETTINGS_KEY]?.lastPlan;
    return mark && typeof mark === 'object' && mark.chatId === chatIdOf(ctx) && Number.isInteger(mark.message) ? mark : null;
}

function markPlanned(ctx = context()) {
    const meta = chatMeta(ctx);
    if (!meta) return;
    meta[SETTINGS_KEY] = { ...(meta[SETTINGS_KEY] ?? {}), lastPlan: { chatId: chatIdOf(ctx), message: latestAssistantIndex(ctx?.chat ?? []) } };
    ctx.saveMetadataDebounced?.();
}

// Replies written since the last plan; after a delete below that point, counted from the end.
function repliesSincePlan(ctx = context()) {
    const mark = lastPlan(ctx);
    if (!mark) return Infinity;
    const chat = ctx?.chat ?? [];
    const from = Math.min(mark.message, chat.length - 1);
    return chat.slice(from + 1).filter(isAssistant).length;
}

function arcView(selection, tracker) {
    const current = selection.arc ?? null;
    const draft = arcDraft();
    return {
        current,
        beats: current ? arcBeats(tracker, current) : null,
        draft: draft ? { key: draft.key, text: draft.text, findings: draft.findings ?? [] } : null,
        busy: planning,
        error: planError,
        onPlan: () => void planArc({ reason: 'manual' }),
        onEnd: () => void endArc(),
        onAccept: text => void acceptDraft(text),
        onDiscard: () => {
            setArcDraft(null);
            storyBlock()?.refresh?.();
        },
    };
}

function connectionProfiles() {
    const service = context()?.ConnectionManagerRequestService;
    try {
        return service?.getSupportedProfiles ? service.getSupportedProfiles().map(profile => ({ id: profile.id, name: profile.name })) : null;
    } catch {
        // Connection Manager switched off.
        return null;
    }
}

// "on Fast profile" for a connection profile, nothing for the chat's own model.
function modelLabel(model) {
    if (model?.source !== 'profile' || !model.profileId) return '';
    const profile = (connectionProfiles() ?? []).find(entry => entry.id === model.profileId);
    return profile?.name ? ` on ${profile.name}` : '';
}

// One call on the chosen model: a connection profile (its own API and model) or the chat's own.
async function sendToModel(messages, model, maxTokens) {
    const ctx = context();
    if (model?.source === 'profile' && model.profileId) {
        const service = ctx.ConnectionManagerRequestService;
        if (!service?.sendRequest) throw new Error('Connection Manager is not available; choose "Same as chat".');
        // A missing profile fails loudly; it never falls back to another model.
        const result = await service.sendRequest(model.profileId, messages, maxTokens);
        return typeof result === 'string' ? result : String(result?.content ?? '');
    }
    if (typeof ctx.generateRaw !== 'function') throw new Error('This SillyTavern cannot run a raw generation.');
    return String(await ctx.generateRaw({ systemPrompt: messages[0].content, prompt: messages[1].content, responseLength: maxTokens }) ?? '');
}

function recentChat(count) {
    const ctx = context();
    const chat = (ctx?.chat ?? []).filter(message => !message.is_system);
    return chat.slice(-Math.max(1, count)).map(message => `${message.name || (message.is_user ? 'User' : 'Narrator')}: ${visibleText(message)}`).join('\n\n');
}

/** Ask the planner for the next arc; the result waits in the tab (or is used at once). */
async function planArc({ reason = 'manual' } = {}) {
    const ctx = context();
    if (planning) {
        if (reason === 'manual') notify('info', 'The next arc is already being planned.');
        return;
    }
    if (!ctx || !chatIdOf(ctx) || !storyBlock()) return;
    const own = settings(ctx);
    planning = true;
    planError = '';
    // Asked for, whatever comes of it: a failed or discarded plan waits too.
    markPlanned(ctx);
    storyBlock()?.refresh?.();
    // Planning reads a long stretch of chat and can take a while: a toast stays up until it
    // is done, wherever the reader is (the tab may be closed or hidden).
    const progress = notify('info', `Planning the next arc${modelLabel(own.arc.model)}… this can take a minute.`, { timeOut: 0, extendedTimeOut: 0, tapToDismiss: false });
    try {
        const cal = calendar();
        const { tracker, now, place } = situation('normal');
        const previous = tracker.records.filter(record => record.kind === 'arc' && record.status !== 'active').at(-1);
        const subst = text => (typeof ctx.substituteParams === 'function' ? ctx.substituteParams(text) : text);
        const messages = buildPlannerMessages({
            template: own.arc.prompt || DEFAULT_PLANNER_PROMPT,
            recent: recentChat(Number(own.arc.recent) || 60),
            trackerSummary: summarizeTracker(tracker, { calendar: cal }),
            nowText: now === null ? '' : cal.format(now),
            place,
            nearby: nearbyPlaces(worldPack(), place).slice(1),
            directorNote: own.arc.note,
            genre: own.arc.genre,
            previousArc: previous ? `${previous.key}${previous.fields?.desc ? ` — ${previous.fields.desc}` : ''}` : '',
            npcPlansOnly: !isSource('npc', own),
        }).map(message => ({ ...message, content: subst(message.content) }));
        const answer = await sendToModel(messages, own.arc.model, Number(own.arc.maxTokens) || 1500);
        const plan = parsePlan(answer, { calendar: cal, now });
        const userName = String(ctx.name1 ?? '');
        const findings = validatePlan(plan, { calendar: cal, now, userName });
        if (findings.some(finding => finding.severity === 'error')) {
            planError = `The plan could not be used: ${findings.filter(finding => finding.severity === 'error').map(finding => finding.message).join('; ')}`;
            notify('error', planError);
            return;
        }
        const arcId = `arc-${Date.now().toString(36)}`;
        const text = planToOps(plan, { arcId }).map(formatOp).join('\n');
        // The note it was planned with: cleared once this arc is accepted (noteAfterAccept).
        const draft = { key: arcId, chatId: chatIdOf(ctx), text, findings, reason, note: String(own.arc.note ?? '') };
        if (own.arc.autoAccept) {
            await acceptDraft(text, draft);
        } else {
            setArcDraft(draft);
            notify('info', 'A new arc plan is ready in the Director tab.');
        }
    } catch (error) {
        const cause = error?.cause instanceof Error ? ` (${error.cause.message})` : '';
        planError = `Planning failed: ${error instanceof Error ? error.message : String(error)}${cause}`;
        console.error('[Story Director] planning failed', error);
        notify('error', planError);
    } finally {
        if (progress) globalThis.toastr?.clear?.(progress);
        planning = false;
        storyBlock()?.refresh?.();
    }
}

// Accepted lines are written into the latest reply's <Director> block, like a seed: deleting
// that reply undoes the plan, and replay picks it up everywhere else.
async function appendDirectorLines(lines) {
    const ctx = context();
    const sb = storyBlock();
    const target = latestAssistantIndex(ctx?.chat ?? []);
    if (target < 0) throw new Error('There is no reply to attach the plan to yet.');
    const existing = sb.blockInText(ctx.chat[target].mes, BLOCK.tag)?.text ?? '';
    await sb.setBlockText(target, BLOCK.tag, existing ? `${existing}\n${lines}` : lines);
}

/**
 * The Director's note is used once (0.8.7): once the arc it shaped is accepted it is cleared,
 * so a note written for one arc does not steer every later one (in every chat) unnoticed.
 * Kept with "Keep the note for every plan", or when it was changed after the plan was made.
 */
function spendNote(draft) {
    const ctx = context();
    const own = settings(ctx);
    const next = noteAfterAccept(own.arc.note, draft?.note, { keep: own.arc.keepNote === true });
    if (next === own.arc.note) return;
    own.arc.note = next;
    saveSettings(ctx);
    settingsPanel?.update(settings(ctx));
    notify('info', 'The Director’s note shaped this arc and is now cleared, so it will not steer the next one.');
}

async function acceptDraft(text, draft = arcDraft()) {
    const lines = String(text ?? draft?.text ?? '').trim();
    if (!lines) return;
    const { errors } = parseChanges(lines);
    if (errors.length) {
        planError = `Line ${errors[0].line} of the plan cannot be read: ${errors[0].message}`;
        storyBlock()?.refresh?.();
        return;
    }
    try {
        await appendDirectorLines(lines);
        setArcDraft(null);
        planError = '';
        notify('success', 'The new arc is being tracked.');
        spendNote(draft);
    } catch (error) {
        planError = error instanceof Error ? error.message : String(error);
    }
    storyBlock()?.refresh?.();
}

// ---------------------------------------------------------------------------
// Capture: a second call writes the change lines for one reply

async function capture(index) {
    const ctx = context();
    const sb = storyBlock();
    const own = settings(ctx);
    const chat = ctx?.chat ?? [];
    const reply = chat[index];
    if (!isAssistant(reply)) return;
    const user = [...chat.slice(0, index)].reverse().find(message => message.is_user);
    const before = trackerAt(index - 1).tracker;
    const cal = calendar();
    const scene = sb.blockInText(reply.mes, own.sceneTag);
    const sceneText = scene?.text ?? '';
    const parsed = sceneText ? cal.parse(sceneTimeText(sceneText), { reference: before.time }) : null;
    const now = parsed?.abs ?? before.time ?? null;
    const subst = text => (typeof ctx.substituteParams === 'function' ? ctx.substituteParams(text) : text);
    const messages = buildCaptureMessages({
        trackerSummary: summarizeTracker(before, { calendar: cal }),
        nowText: now === null ? '' : cal.format(now),
        place: scenePlace(sceneText),
        userText: user ? visibleText(user) : '',
        replyText: visibleText(reply),
        npcPlansOnly: !isSource('npc', own),
    }).map(message => ({ ...message, content: subst(message.content) }));
    reportStatus('Capturing the reply’s changes…');
    try {
        const answer = await sendToModel(messages, own.capture.model, Number(own.capture.maxTokens) || 800);
        // The chat may have moved on (a swipe, a delete) while the call ran.
        if (context()?.chat?.[index] !== reply) return;
        const result = parseCapture(answer, before);
        if (result.dropped.length) console.info('[Story Director] capture dropped', result.dropped);
        if (result.lines) await sb.setBlockText(index, BLOCK.tag, result.lines);
        reportStatus(`Last reply: captured ${result.ops.length} ${result.ops.length === 1 ? 'change' : 'changes'}${result.dropped.length ? `, dropped ${result.dropped.length}` : ''}.`);
    } catch (error) {
        const cause = error?.cause instanceof Error ? ` (${error.cause.message})` : '';
        notify('warning', `Capture failed: ${error instanceof Error ? error.message : String(error)}${cause}`);
        console.error('[Story Director] capture failed', error);
    }
}

// ---------------------------------------------------------------------------
// World State Alpha import

async function importWsa(text) {
    const ctx = context();
    if (!ctx || !chatIdOf(ctx) || !storyBlock()) return notify('warning', 'Open a chat first.');
    const { ops, counts, errors } = importWorldStateAlpha(text);
    if (errors.length) return notify('error', errors[0]);
    if (!ops.length) return notify('info', 'The export has no active records to import.');
    const question = `Track ${counts.facts} ${counts.facts === 1 ? 'fact' : 'facts'} and ${counts.developments} ${counts.developments === 1 ? 'development' : 'developments'} from World State Alpha as World records? They are written into the latest reply, so deleting that reply undoes this.`;
    const confirmed = typeof ctx.callGenericPopup === 'function'
        ? await ctx.callGenericPopup(question, ctx.POPUP_TYPE?.CONFIRM ?? 2)
        : globalThis.confirm?.(question);
    if (!confirmed) return;
    try {
        await appendDirectorLines(ops.map(formatOp).join('\n'));
        notify('success', `Imported ${ops.length} World ${ops.length === 1 ? 'record' : 'records'} from World State Alpha.`);
    } catch (error) {
        notify('error', `Could not import: ${error instanceof Error ? error.message : String(error)}`);
    }
}

async function endArc() {
    const { selection } = situation('normal');
    if (!selection.arc) return;
    try {
        await appendDirectorLines(`- ${selection.arc.key} — the arc ended`);
    } catch (error) {
        planError = error instanceof Error ? error.message : String(error);
        storyBlock()?.refresh?.();
        return;
    }
    if (settings().arc.trigger === 'auto') await planArc({ reason: 'arc-end' });
}

// Automatic: plan when there is no arc, when every beat of the arc is done, when no beat is
// due within the stall window, or (0.9.19) when open threads run low (autoPlanReason). Never
// while a plan waits for review.
async function maybePlanAutomatically(tracker) {
    if (planning || arcDraft()) return;
    const own = settings();
    const { selection, now } = situation('normal');
    const arc = selection.arc;
    const reason = autoPlanReason({
        tracker,
        arc,
        now,
        calendar: calendar(),
        stallDays: own.arc.stallDays,
        lowThreads: own.arc.lowThreads,
        repliesSincePlan: repliesSincePlan(),
    });
    if (!reason) return;
    if (reason === 'arc-end') await appendDirectorLines(`- ${arc.key} — every beat played out`).catch(() => {});
    await planArc({ reason });
}

// ---------------------------------------------------------------------------
// Routes: the tab's route tool and /route

// How travel is counted: a world pack's era wins; without one, Settings → Map & travel → Era.
function travelEra() {
    return worldPack()?.era ?? settings().map?.era ?? 'pre-modern';
}

const modesOf = era => (era === 'modern' ? MODERN_MODES : MODES);
// Every mode word /route takes: both eras', and the common ones they map to.
const ROUTE_MODE_WORDS = [...new Set([...MODES, ...MODERN_MODES, 'drive', 'taxi', 'fly', 'flight', 'walk'])];

/** A journey from the scene's current time: one readable line, or why there is none. */
function routeText(fromText, toText, { mode = 'foot', rate = null } = {}) {
    const pack = worldPack();
    const era = travelEra();
    const aliases = era === 'modern' ? { drive: 'car', taxi: 'car', fly: 'plane', flight: 'plane', walk: 'foot', boat: 'ferry' } : { walk: 'foot', fly: 'flight' };
    const word = aliases[mode] ?? mode;
    const travel = modesOf(era).includes(word) ? word : 'foot';
    const { now, upTo } = situation('normal');
    const cal = calendar();
    // Roads first: a world pack that knows both places plans by its roads.
    const from = pack ? findPlace(pack, fromText) : null;
    const to = pack ? findPlace(pack, toText) : null;
    if (from && to) {
        const plan = planRoute(pack, from, to, { mode: travel, rate, depart: now, calendar: cal });
        if (plan) return formatRoute(plan, cal);
    }
    // Otherwise the map's coordinates: a straight line times the road factor.
    const book = placeBookAt(upTo);
    const a = findBookPlace(book, fromText);
    const b = findBookPlace(book, toText);
    const missing = [[a, fromText], [b, toText]].find(([place]) => !place?.coords);
    if (missing) {
        const known = book.places.filter(place => place.coords).length;
        return `"${missing[1]}" has no map coordinates yet${known ? '' : ' (no place has any: coordinates come from the scene\'s location, like "[59.0, 110.0]", or a world pack)'}.`;
    }
    const map = { ...settings().map, era };
    const trip = estimateTrip(a, b, { map, mode: travel, rate, rules: pack?.rules });
    const arrive = now !== null && trip ? ` · arrive ${cal.format(now + Math.round(trip.days * 1440))}` : '';
    return `${formatTrip(trip, { map })}${arrive} (estimated from the map)`;
}

// `/route Shorn to Auvoth ride`, `/route Shorn → Auvoth mode=courier`, `/route from=Shorn to=Auvoth`.
function parseRouteArgs(named, unnamed) {
    let text = String(unnamed ?? '').trim();
    let mode = String(named?.mode ?? '').trim().toLowerCase();
    const lastWord = /\s+(\w+)$/.exec(text);
    if (!mode && lastWord && ROUTE_MODE_WORDS.includes(lastWord[1].toLowerCase())) {
        mode = lastWord[1].toLowerCase();
        text = text.slice(0, lastWord.index);
    }
    const [from, to] = named?.from && named?.to
        ? [named.from, named.to]
        : text.split(/\s+(?:to|→|->)\s+/i);
    const rate = Number(named?.rate);
    return { from: String(from ?? '').trim(), to: String(to ?? '').trim(), mode: mode || 'foot', rate: Number.isFinite(rate) && rate > 0 ? rate : null };
}

function registerSlashCommand() {
    const ctx = context();
    const { SlashCommandParser, SlashCommand, SlashCommandArgument, SlashCommandNamedArgument, ARGUMENT_TYPE } = ctx ?? {};
    if (!SlashCommandParser?.addCommandObject || !SlashCommand?.fromProps) return;
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'route',
        returns: 'the route, its days and arrival',
        callback: (named, unnamed) => {
            const args = parseRouteArgs(named, unnamed);
            const answer = args.from && args.to
                ? routeText(args.from, args.to, args)
                : `Usage: /route FROM to TO [${modesOf(travelEra()).join('|')}] [rate=N]`;
            globalThis.toastr?.info?.(answer, 'Route', { timeOut: 20000, extendedTimeOut: 10000 });
            return answer;
        },
        namedArgumentList: [
            SlashCommandNamedArgument.fromProps({ name: 'mode', description: 'foot, ride, wagon, boat or courier; modern: foot, bike, car, bus, train, ferry or plane', typeList: [ARGUMENT_TYPE.STRING], enumList: ROUTE_MODE_WORDS }),
            SlashCommandNamedArgument.fromProps({ name: 'rate', description: 'km per day (modern: km an hour), overriding the pace', typeList: [ARGUMENT_TYPE.NUMBER] }),
            SlashCommandNamedArgument.fromProps({ name: 'from', description: 'start place', typeList: [ARGUMENT_TYPE.STRING] }),
            SlashCommandNamedArgument.fromProps({ name: 'to', description: 'destination', typeList: [ARGUMENT_TYPE.STRING] }),
        ],
        unnamedArgumentList: [
            SlashCommandArgument.fromProps({ description: 'FROM to TO [mode]', typeList: [ARGUMENT_TYPE.STRING] }),
        ],
        helpString: 'Plans a journey over the Story Director world pack: hops, km, pace, days (each road rounded up to a half day, rest days on land; modern: hours to the quarter hour, boarding, nights on long drives) and the arrival from the scene\'s current time.',
    }));
}

// ---------------------------------------------------------------------------
// The Quests tab: the work {{user}} took on, always shown (quests are no spoiler)

function questRecords() {
    const { tracker, now } = situation('normal');
    const quests = tracker.records.filter(record => record.kind === 'quest');
    const active = quests.filter(record => record.status === 'active');
    const finished = quests.filter(record => record.status !== 'active')
        .sort((a, b) => (b.resolved?.message ?? -1) - (a.resolved?.message ?? -1));
    // (0.9.15) Jobs offered and not taken on yet: shown apart, until their deadline passes.
    const offered = tracker.records.filter(isOffer);
    return { active, finished, offered, now };
}

function questStatus(now) {
    const cal = calendar();
    const soonDays = Number(settings().dueSoonDays) || DEFAULTS.dueSoonDays;
    return record => {
        // (0.9.28) The work done and only the pay left: its time is when the pay can be had.
        if (waitsForPay(record)) return 'pay';
        if (now === null || !record.fields?.due) return '';
        const deadline = cal.parse(record.fields.due, { reference: now });
        if (!deadline) return '';
        // (0.9.11) A deadline without a time of day runs to the end of that day.
        const end = deadline.hasTime ? deadline.abs : cal.addDays(deadline.abs, 1) - 1;
        if (end <= now) return 'overdue';
        return end <= cal.addDays(now, soonDays) ? 'soon' : '';
    };
}

function questsTabKey() {
    const ctx = context();
    const chat = ctx?.chat ?? [];
    return [chatIdOf(ctx), chat.length, signature(chat.at(-1)), settings().dueSoonDays, JSON.stringify(settings().calendar), [...pendingAbandons(ctx)].join(','), JSON.stringify(abandonState(ctx) ?? null)].join('|');
}

// (0.9.36) NPC State Delta's present cast (names), when it is here: the second source for who
// is in the scene, after the scene block's NPCs Present. Null when it is not, or says nothing.
function npcStateDeltaPresent() {
    try {
        const list = globalThis.NPCStateDelta?.injectionPreview?.()?.presentNpcs;
        return Array.isArray(list) ? list.map(String) : null;
    } catch {
        return null;
    }
}

// (0.9.37) Whether an offer can be taken on here: the story in the settlement it was offered
// in, or its giver in the scene (presence.js). Null with the setting off, or nothing to tell.
function offerHere(record, where) {
    if (settings().giverPresent === false) return null;
    return offerPresence(record, where);
}

function renderQuestsTab(pane) {
    const { active, finished, offered, now } = questRecords();
    const chat = context()?.chat ?? [];
    const latest = latestAssistantIndex(chat);
    const upTo = chat.length - 1;
    const scene = storyBlock()?.getBlock?.(settings().sceneTag)?.text ?? '';
    const where = {
        place: scenePlace(scene),
        visits: upTo >= 0 ? visitsUpTo(upTo) : [],
        scene,
        present: npcStateDeltaPresent(),
        reply: latest >= 0 ? visibleText(chat[latest]) : '',
    };
    // (0.9.12) Each deadline at the clock time the calendar sets: "Goldwane 12 sunset" reads
    // "Goldwane 12, 07:00 pm", a date alone its last minute.
    const cal = calendar();
    const formatDate = value => cal.withClock(value, { reference: now });
    const status = questStatus(now);
    // (0.9.27) An offer the reader spoke of stays in view past its date, for its grace (lapses.js).
    renderQuests(pane, { quests: active, finished, offered: offered.filter(record => record.engaged || status(record) !== 'overdue'), formatDate, status, abandoning: pendingAbandons(), onAbandon: id => abandonQuest(id), onKeep: id => keepQuest(id), choosing: pendingOffers(), onTake: id => chooseOffer(id, 'take'), onDecline: id => chooseOffer(id, 'decline'), onUndo: id => undoOffer(id), presence: record => offerHere(record, where) });
}

// (0.9.19) The Journal: what {{user}}'s character saw and heard, from every message's tracker
// in the replay cache and the place book, up to the newest message on screen.
function journalData() {
    const ctx = context();
    const chat = ctx?.chat ?? [];
    if (!storyBlock() || !chatIdOf(ctx) || !chat.length) return buildJournal({});
    const last = chat.length - 1;
    const book = placeBookAt(last);
    const trackers = cache.entries.slice(0, last + 1).map(entry => entry?.tracker ?? null);
    return buildJournal({ trackers, places: book?.places ?? [], calendar: calendar(), base: cache.base });
}

// Another chat, another reply or a changed one, or a calendar that names days differently.
function journalTabKey() {
    const ctx = context();
    const chat = ctx?.chat ?? [];
    const pack = worldPack();
    return [chatIdOf(ctx), chat.length, signature(chat.at(-1)), settings().sceneTag, JSON.stringify(settings().calendar), pack ? packSummary(pack) : ''].join('|');
}

function renderJournalTab(pane) {
    renderJournal(pane, journalData());
}

/**
 * (0.9.5) The reader gives a quest up from the Quests tab, the one quest choice with a button.
 * (0.9.15) Like RPG Battle's fight hand-off, behind the scenes: the click (asked twice) marks
 * it, the next reply's note tells the story that {{user}} gives it up, and that reply records
 * it (`- Key — abandoned`, written for the story if it left the line out; a failure, so no
 * quest XP) with the reader's choice stamped on the message. A swipe of that reply is told
 * again; deleting it takes the abandon back. Until the reply comes, a second click keeps it.
 * State: chatMetadata[SETTINGS_KEY].abandon = { keys: [record id], attachedTo, sentFor }.
 */
// (0.9.33) Offers taken on or turned down with the Quests tab's buttons go the same way:
// `take` and `decline` beside `keys` (the quests given up), stamped on the reply as
// `taken` and (with what was given up) `abandoned`.
function abandonedStamp(message) {
    const list = message?.extra?.storyDirector?.abandoned;
    return Array.isArray(list) ? list.map(String) : [];
}

function takenStamp(message) {
    const list = message?.extra?.storyDirector?.taken;
    return Array.isArray(list) ? list.map(String) : [];
}

const idList = value => (Array.isArray(value) ? value.map(String) : []);
const anyChoice = state => Boolean(state && (state.keys?.length || state.take?.length || state.decline?.length));

function abandonState(ctx = context()) {
    const meta = chatMeta(ctx);
    const state = meta?.[SETTINGS_KEY]?.abandon;
    if (!anyChoice(state)) return null;
    const attachedTo = Number.isInteger(state.attachedTo) ? state.attachedTo : null;
    // The reply it went with was deleted: the choice is taken back.
    if (attachedTo !== null && !isAssistant(ctx?.chat?.[attachedTo])) {
        setAbandonState(null, ctx);
        return null;
    }
    return { keys: idList(state.keys), take: idList(state.take), decline: idList(state.decline), attachedTo, sentFor: Number.isInteger(state.sentFor) ? state.sentFor : null };
}

function setAbandonState(state, ctx = context()) {
    const meta = chatMeta(ctx);
    if (!meta) return;
    meta[SETTINGS_KEY] = { ...(meta[SETTINGS_KEY] ?? {}), abandon: anyChoice(state) ? state : null };
    ctx.saveMetadataDebounced?.();
}

/** Quests the reader is giving up with the next reply (not yet sent with one). */
function pendingAbandons(ctx = context()) {
    const state = abandonState(ctx);
    return new Set(state && state.attachedTo === null ? state.keys : []);
}

/** (0.9.33) Offers the reader is taking on or turning down with the next reply: { take, decline } (Sets). */
function pendingOffers(ctx = context()) {
    const state = abandonState(ctx);
    const open = state && state.attachedTo === null;
    return { take: new Set(open ? state.take : []), decline: new Set(open ? state.decline : []) };
}

/** (0.9.33) Take on (`choice` 'take') or turn down ('decline') an offer with the next reply. */
function chooseOffer(id, choice) {
    const record = questRecords().offered.find(entry => entry.id === id);
    if (!record) return;
    const state = abandonState() ?? { keys: [], take: [], decline: [], attachedTo: null, sentFor: null };
    const fresh = state.attachedTo === null ? state : { keys: [], take: [], decline: [], attachedTo: null, sentFor: null };
    const take = fresh.take.filter(key => key !== id);
    const decline = fresh.decline.filter(key => key !== id);
    (choice === 'take' ? take : decline).push(id);
    setAbandonState({ ...fresh, take, decline, attachedTo: null, sentFor: null });
    notify('info', `${record.key}: ${choice === 'take' ? 'taken on' : 'turned down'} with your next reply. Click Undo on it to change your mind.`);
    storyBlock()?.refresh?.();
}

function undoOffer(id) {
    const state = abandonState();
    if (!state || state.attachedTo !== null) return;
    setAbandonState({ ...state, take: state.take.filter(key => key !== id), decline: state.decline.filter(key => key !== id) });
    storyBlock()?.refresh?.();
}

function abandonQuest(id) {
    const record = questRecords().active.find(entry => entry.id === id);
    if (!record) return;
    const state = abandonState() ?? { keys: [], attachedTo: null, sentFor: null };
    // A new choice after the last one was sent starts afresh.
    const open = state.attachedTo === null;
    const keys = open ? state.keys : [];
    if (!keys.includes(record.id)) keys.push(record.id);
    setAbandonState({ keys, take: open ? state.take : [], decline: open ? state.decline : [], attachedTo: null, sentFor: null });
    notify('info', `${record.key} is given up with your next reply. Click Keep on it to change your mind.`);
    storyBlock()?.refresh?.();
}

function keepQuest(id) {
    const state = abandonState();
    if (!state || state.attachedTo !== null) return;
    setAbandonState({ ...state, keys: state.keys.filter(key => key !== id) });
    storyBlock()?.refresh?.();
}

/**
 * The quests the reply being generated (at chat index `slot`) gives up: [key], for the note.
 * A pending choice goes with the next reply; one already sent goes again with a swipe of its
 * reply, and is done once a later reply is written.
 */
function choicesFor(slot, tracker, { peek = false } = {}) {
    const none = { abandoning: [], takingOn: [], turningDown: [] };
    const state = abandonState();
    if (!state) return none;
    if (state.attachedTo !== null && slot > state.attachedTo) {
        if (!peek) setAbandonState(null);
        return none;
    }
    if (state.attachedTo !== null && slot !== state.attachedTo) return none;
    // (0.9.34) `peek`: for What's sent, which shows the note without sending it.
    if (!peek && state.sentFor !== slot) setAbandonState({ ...state, sentFor: slot });
    const keys = list => list.map(id => findRecord(tracker, id)?.key).filter(Boolean);
    return { abandoning: keys(state.keys), takingOn: keys(state.take), turningDown: keys(state.decline) };
}

/** After the reply the abandon went with: stamp the reader's choice, and close what the story left open. */
async function closeAbandoned(index) {
    const ctx = context();
    const sb = storyBlock();
    const state = abandonState(ctx);
    if (!state || state.sentFor !== index) return false;
    const message = ctx.chat[index];
    // A turned-down offer is the reader's choice as a given-up quest is: stamped with them.
    message.extra = { ...(message.extra ?? {}), storyDirector: { ...(message.extra?.storyDirector ?? {}), abandoned: [...state.keys, ...state.decline], taken: state.take } };
    setAbandonState({ ...state, attachedTo: index }, ctx);
    const { tracker } = trackerAt(index);
    const still = ids => ids.map(id => findRecord(tracker, id)).filter(record => record && record.status === 'active');
    // What the story left out is written for it: a choice made with a button always holds.
    const lines = [
        ...still(state.keys).map(record => `- ${record.key} — abandoned`),
        ...still(state.take).filter(record => record.kind !== 'quest').map(record => `~ ${record.key} — accepted`),
        ...still(state.decline).map(record => `- ${record.key} — declined`),
    ].join('\n');
    if (lines) {
        const existing = sb.blockInText(message.mes, BLOCK.tag)?.text ?? '';
        await sb.setBlockText(index, BLOCK.tag, existing ? `${existing}\n${lines}` : lines);
    } else {
        await ctx.saveChat?.();
    }
    return true;
}

/**
 * (0.9.19) After the latest reply: the beats its story time left more than SLIP_GRACE_DAYS
 * behind without firing them, and the offers whose deadline it passed, are closed in its own
 * Director block (`- Key — slipped`, `- Key — offer lapsed`), so deleting or swiping the reply
 * takes the closing back. Neither is a choice of the reader's, nor a quest's outcome.
 */
async function closeLapsed(index) {
    const ctx = context();
    const sb = storyBlock();
    const chat = ctx?.chat ?? [];
    // Only the newest reply: an older one edited later keeps what it said.
    if (index !== latestAssistantIndex(chat)) return false;
    const { tracker } = trackerAt(index);
    const options = { calendar: calendar(), now: tracker.time };
    const lines = lapseLines({ slipped: slippedBeats(tracker, options), lapsed: lapsedOffers(tracker, options) });
    if (!lines.length) return false;
    const existing = sb.blockInText(chat[index].mes, BLOCK.tag)?.text ?? '';
    await sb.setBlockText(index, BLOCK.tag, existing ? `${existing}\n${lines.join('\n')}` : lines.join('\n'));
    return true;
}

function tabBadge() {
    try {
        const { selection } = situation('normal');
        return selection.due.length + selection.arriving.length;
    } catch {
        return 0;
    }
}

// ---------------------------------------------------------------------------
// Settings panel

// The Story Suite's shared panel styles (src/suite.css, identical in the four extensions):
// linked once per page, by whichever extension comes first.
const SUITE_CSS_ID = 'story-suite-css';
function loadSuiteCss(documentRef) {
    try {
        if (!documentRef?.head || documentRef.getElementById?.(SUITE_CSS_ID)) return;
        const link = documentRef.createElement('link');
        link.id = SUITE_CSS_ID;
        link.rel = 'stylesheet';
        link.href = new URL('./src/suite.css', import.meta.url).href;
        documentRef.head.appendChild(link);
    } catch {
        // Unstyled is still usable.
    }
}

function addSettingsPanel(documentRef) {
    loadSuiteCss(documentRef);
    if (documentRef.querySelector(`#${PANEL_ID}`)) return true;
    const host = documentRef.querySelector('#extensions_settings2') ?? documentRef.querySelector('#extensions_settings');
    if (!host) return false;
    const wrapper = documentRef.createElement('div');
    wrapper.id = PANEL_ID;
    host.appendChild(wrapper);
    const sb = storyBlock();
    settingsPanel = renderSettings(wrapper, {
        settings: settings(),
        blocks: (sb?.listBlocks?.() ?? []).filter(block => block.tag !== BLOCK.tag).map(({ tag, name }) => ({ tag, name })),
        onChange: applySettings,
        onSeed: () => void seed(),
        onPlanArc: () => void planArc({ reason: 'manual' }),
        version: `v${VERSION}`,
        status: sb ? '' : 'Needs Story Block 0.6 or newer.',
        profiles: connectionProfiles(),
        defaultPlannerPrompt: DEFAULT_PLANNER_PROMPT,
        onImportWsa: text => void importWsa(text),
        packSummary: worldPack() ? packSummary(worldPack()) : '',
        onImportPack: importPack,
        onClearPack: clearPack,
        others: otherSuiteNames(),
        suiteLink: suiteLinkShown(),
        onOpenSuite: openSuite,
        storyNow,
    });
    return true;
}

// (0.9.21) The story time of the latest message, for Settings → Today is; null without one.
function storyNow() {
    try {
        const time = trackerAt((context()?.chat?.length ?? 0) - 1).tracker.time;
        return Number.isFinite(time) ? time : null;
    } catch {
        return null;
    }
}

// A full new settings object, from the panel or from Story Suite's overlay (api.manage).
function applySettings(next) {
    const ctx = context();
    if (!ctx?.extensionSettings) return;
    ctx.extensionSettings[SETTINGS_KEY] = { ...settings(ctx), ...next, calendar: normalizeCalendar(next.calendar), arc: { ...DEFAULT_SETTINGS.arc, ...(next.arc ?? {}) }, capture: { ...DEFAULT_SETTINGS.capture, ...(next.capture ?? {}) }, sourceOfTruth: sourceChoices(next.sourceOfTruth) };
    saveSettings(ctx);
    // The switch or a source-of-truth choice may change what we offer.
    announceToSuite();
    // The calendar or the scene block may have changed: every cached replay is stale.
    cache = { chatId: null, entries: [], base: -1 };
    storyBlock()?.refresh?.();
}

async function importPack(text) {
    const ctx = context();
    let json;
    try {
        json = JSON.parse(String(text ?? ''));
    } catch {
        return { message: 'That is not valid JSON.' };
    }
    const { pack, errors, warnings } = loadWorldPack(json);
    if (!pack) return { message: `Not imported: ${errors.join('; ') || 'not a world pack'}.` };
    const own = settings(ctx);
    own.worldPack = json;
    let adopted = '';
    // A pack that brings its calendar offers it; the reader's own calendar is never replaced silently.
    if (pack.calendar) {
        const question = 'This world pack has its own calendar. Use it for reading dates?';
        const yes = typeof ctx.callGenericPopup === 'function'
            ? await ctx.callGenericPopup(question, ctx.POPUP_TYPE?.CONFIRM ?? 2)
            : globalThis.confirm?.(question);
        if (yes) {
            own.calendar = normalizeCalendar(pack.calendar);
            adopted = ' Calendar taken from the pack.';
        }
    }
    // A pack's map scale is how its coordinates read.
    if (pack.scaleKmPerUnit && pack.scaleKmPerUnit !== own.map?.kmPerUnit) {
        own.map = mapSettings({ ...own.map, kmPerUnit: pack.scaleKmPerUnit });
        adopted += ` Map scale set to ${pack.scaleKmPerUnit} km per unit.`;
    }
    saveSettings(ctx);
    cache = { chatId: null, entries: [], base: -1 };
    // The panel holds its own copy of the settings; give it the adopted calendar so its next
    // edit does not write the old one back.
    if (adopted) settingsPanel?.update(settings(ctx), { packSummary: packSummary(pack) });
    storyBlock()?.refresh?.();
    // The first few notes in full: a pack a model wrote is fixed from them.
    const shown = warnings.slice(0, 5).join(' ');
    const more = warnings.length > 5 ? ` …and ${warnings.length - 5} more.` : '';
    const note = warnings.length ? ` ${warnings.length} ${warnings.length === 1 ? 'note' : 'notes'}: ${shown}${more}` : '';
    return { summary: packSummary(pack), message: `Imported ${packSummary(pack)}.${adopted}${note}` };
}

async function clearPack() {
    const ctx = context();
    delete settings(ctx).worldPack;
    saveSettings(ctx);
    storyBlock()?.refresh?.();
    return { summary: '', message: 'World pack cleared.' };
}

function registerWithStoryBlock() {
    if (registered) return true;
    const sb = storyBlock();
    if (!sb) return false;
    const block = sb.registerBlock(BLOCK);
    if (!block.ok) {
        notify('error', `Story Director could not register its <${BLOCK.tag}> block: ${block.error}`);
        registered = true;
        return true;
    }
    sb.registerTab({
        id: TAB_ID,
        label: 'Director',
        icon: BLOCK.icon,
        order: 90,
        isAvailable: () => settings().enabled,
        key: tabKey,
        badge: tabBadge,
        render: pane => renderDirectorTab(pane),
    });
    // Only once the story has a quest or an offer, so a chat without any is not given an empty tab.
    sb.registerTab({
        id: QUESTS_TAB_ID,
        label: 'Quests',
        icon: '📜',
        order: 89,
        isAvailable: () => {
            try {
                if (!settings().enabled) return false;
                // (0.9.27) Or a job on offer, so an offer has somewhere to be seen.
                const { active, finished, offered } = questRecords();
                return active.length + finished.length + offered.length > 0;
            } catch {
                return false;
            }
        },
        key: questsTabKey,
        badge: () => {
            try {
                return questRecords().active.length;
            } catch {
                return 0;
            }
        },
        render: pane => renderQuestsTab(pane),
    });
    // (0.9.19) The player's side of the story: always there, with an empty state to begin with.
    sb.registerTab({
        id: JOURNAL_TAB_ID,
        label: 'Journal',
        icon: '📖',
        order: 88,
        isAvailable: () => {
            try {
                return Boolean(settings().enabled);
            } catch {
                return false;
            }
        },
        key: journalTabKey,
        render: pane => renderJournalTab(pane),
    });
    sb.onReply(payload => void onReply(payload));
    registered = true;
    return true;
}

// The settings panel needs SillyTavern's drawer, the rest needs Story Block; either can be
// late on a slow load, so keep trying until both are in place.
function ensureUi() {
    const panel = addSettingsPanel(document);
    const linked = registerWithStoryBlock();
    // Story Block may be late, and the saved settings (the switch) too.
    announceToSuite();
    if (panel && linked) {
        if (uiRetry) clearTimeout(uiRetry);
        uiRetry = null;
        return;
    }
    if (!uiRetry) uiRetry = setTimeout(() => {
        uiRetry = null;
        ensureUi();
    }, 300);
}

// ---------------------------------------------------------------------------
// Start

function registerEvents() {
    const ctx = context();
    const events = ctx?.eventTypes ?? ctx?.event_types ?? {};
    if (events.CHAT_CHANGED) {
        ctx.eventSource.on(events.CHAT_CHANGED, () => {
            cache = { chatId: null, entries: [], base: -1 };
            lastFindings = [];
            lastFindingsKey = '';
            setNote('');
        });
    }
    for (const event of [events.APP_READY, events.EXTENSION_SETTINGS_LOADED]) {
        if (event) ctx.eventSource.on(event, ensureUi);
    }
    // (0.9.34) The note is for the reply it was built for: once that reply is in (or the reader
    // stopped it), it goes, so a background call (another extension's quiet prompt, a capture
    // pass) never carries it and nothing in it is told twice. The next reply builds its own. Not
    // on GENERATION_ENDED: a quiet call another extension makes while the reply is being put
    // together ends too, and would take the note away before the reply is sent.
    for (const event of [events.MESSAGE_RECEIVED, events.GENERATION_STOPPED]) {
        if (event) ctx.eventSource.on(event, () => setNote(''));
    }
}

export async function init() {
    if (initialized) return;
    if (!globalThis.SillyTavern?.getContext) {
        setTimeout(() => void init(), 100);
        return;
    }
    initialized = true;
    setNote('');
    registerEvents();
    registerSlashCommand();
    watchSuite();
    ensureUi();
    console.info(`[Story Director] v${VERSION} loaded.`);
}

void init();
