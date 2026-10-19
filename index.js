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
import { activeRecords, emptyTracker, findRecord, givenUpIn, isOffer, offersChosenIn, questsDoneIn, replay, untrackedCorrections } from './src/tracker.js';
import { seedFromWorldState } from './src/seed.js';
import { mirrorOffscreen } from './src/mirror.js';
import { DEFAULTS, classify, encountersIn, estimateTokens } from './src/relevance.js';
import { buildNote, noteParts, noteTokens } from './src/note.js';
import { checkReply } from './src/checks.js';
import { renderSettings } from './src/ui/settings.js';
import { renderTab } from './src/ui/tab.js';
import { renderQuests } from './src/ui/quests.js';
import { MODERN_MODES, MODES, findPlace, formatRoute, loadWorldPack, packSummary, planRoute } from './src/routes.js';
import { corrections, nearbyPlaces, travelFindings } from './src/travel.js';
import { buildPlannerMessages, DEFAULT_PLANNER_PROMPT, noteAfterAccept, parsePlan, planToOps, summarizeTracker, validatePlan } from './src/planner.js';
import { buildCaptureMessages, parseCapture } from './src/capture.js';
import { importWorldStateAlpha } from './src/wsa.js';
import { DEFAULT_MAP, buildPlaceBook, estimateTrip, findBookPlace, formatTrip, mapSettings, nearbyByCoords } from './src/places.js';
import { isSourceOfTruth, storySuite } from './src/suite.js';
import { makeManage, sourceChoices as validSourceChoices, suiteAnnouncement, suiteOpener } from './src/manage.js';

const VERSION = '0.9.17';
const SETTINGS_KEY = 'storyDirector';
const PROMPT_KEY = 'story_director';
const BLOCK = { id: 'story-director', tag: 'Director', name: 'Story Director', icon: '🎬' };
const TAB_ID = 'story-director';
const QUESTS_TAB_ID = 'story-director-quests';
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
    depth: 1,
    budgetTokens: DEFAULTS.budgetTokens,
    dormantReplies: DEFAULTS.dormantReplies,
    dormantDays: DEFAULTS.dormantDays,
    dueSoonDays: DEFAULTS.dueSoonDays,
    mirrorOffscreen: true,
    // The tracker is the story behind the scenes: hidden in the tab until the reader asks.
    spoilerGuard: true,
    calendar: PRESETS.gregorian,
    arc: Object.freeze({ trigger: 'manual', model: { source: 'chat' }, recent: 60, maxTokens: 1500, stallDays: 7, autoAccept: false, genre: '', note: '', keepNote: false, prompt: '' }),
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
let cache = { chatId: null, entries: [] };
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
    store[SETTINGS_KEY] = {
        ...DEFAULT_SETTINGS,
        ...saved,
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
    const stamp = abandonedStamp(message).join('|');
    return `${message?.is_user ? 'u' : 'a'}:${text.length}:${hash}${stamp ? `:${stamp}` : ''}`;
}

// One replay entry per message: its change lines (assistant replies only), its narration
// (for "seen"), and the story time its scene block states.
// (0.9.15) The reader's message(s) a reply answers: every user message since the reply before
// it, or null when there is none (a greeting, a reply after another reply).
function saidBefore(chat, index) {
    const said = [];
    for (let at = index - 1; at >= 0 && !isAssistant(chat[at]); at--) {
        if (chat[at]?.is_user) said.unshift(visibleText(chat[at]));
    }
    return said.length ? said.join('\n') : null;
}

function entryFor(message, index, sb, cal, own, reference, said = null) {
    const assistant = isAssistant(message);
    const block = assistant ? sb.blockInText(message.mes, BLOCK.tag) : null;
    const parsed = block ? parseChanges(block.text) : { ops: [], errors: [] };
    const scene = assistant ? sb.blockInText(message.mes, own.sceneTag) : null;
    const timeText = scene ? sceneTimeText(scene.text) : '';
    const date = timeText ? cal.parse(timeText, { reference }) : null;
    return {
        entry: { message: index, ops: block ? parsed.ops : null, text: visibleText(message), time: date ? date.abs : null, ...(assistant ? { said, chosen: abandonedStamp(message) } : {}) },
        location: scene ? headerCell(scene.text, 'loc|location|place') : '',
        hadBlock: Boolean(block),
        parseErrors: parsed.errors,
    };
}

/**
 * The tracker after message `upTo` (inclusive), replaying only what changed since the last
 * call: { tracker, problems (from that message), info (its cache entry) }.
 */
function trackerAt(upTo) {
    const ctx = context();
    const sb = storyBlock();
    const chat = ctx?.chat ?? [];
    const chatId = chatIdOf(ctx);
    if (!sb || !chatId) return { tracker: emptyTracker(), problems: [], info: null };
    if (cache.chatId !== chatId) cache = { chatId, entries: [] };
    const own = settings(ctx);
    const cal = calendar();
    const last = Math.min(Number(upTo), chat.length - 1);

    // Resume from the first message whose text (or role) changed.
    let start = 0;
    while (start <= last && cache.entries[start]?.sig === signature(chat[start])) start++;
    if (start < cache.entries.length) cache.entries.length = start;
    for (let index = start; index <= last; index++) {
        const seed = cache.entries[index - 1]?.tracker ?? emptyTracker();
        const read = entryFor(chat[index], index, sb, cal, own, seed.time ?? null, saidBefore(chat, index));
        const result = replay([read.entry], { seed });
        cache.entries[index] = {
            sig: signature(chat[index]),
            tracker: result.tracker,
            problems: result.problems,
            hadBlock: read.hadBlock,
            parseErrors: read.parseErrors,
            location: read.location ? { message: index, time: read.entry.time ?? seed.time ?? null, text: read.location } : null,
        };
    }
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
        const visits = cache.entries.slice(0, last + 1).map(entry => entry?.location).filter(Boolean);
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
        if (!isAssistant(chat[index])) continue;
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

function setNote(text) {
    const ctx = context();
    if (typeof ctx?.setExtensionPrompt !== 'function') return;
    const depth = Math.max(0, Math.min(20, Number(settings(ctx).depth) || 0));
    ctx.setExtensionPrompt(PROMPT_KEY, text, EXTENSION_PROMPT_IN_CHAT, depth, false, EXTENSION_PROMPT_ROLE_SYSTEM);
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

// How the note is built for a reply: the same for the injected note and for its token count.
function noteOptions(ctx, tracker, upTo) {
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
    return { calendar: cal, budgetTokens: relevanceSettings().budgetTokens, corrections: fixes, npcPlansOnly: !isSource('npc'), offscreenInBlock, givenUp, taking, declining, ...instructionless };
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
    const parts = noteParts(selection, noteOptions(ctx, tracker, upTo)).map(entry => ({ ...entry, text: substitute(entry.text) }));
    return noteTokens(parts);
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
        const note = buildNote(selection, { ...noteOptions(ctx, tracker, upTo), abandoning: abandoningFor(slot, tracker) });
        const text = typeof ctx.substituteParams === 'function' ? ctx.substituteParams(note) : note;
        setNote(text);
        const counted = selection.due.length + selection.arriving.length + selection.relevant.length;
        reportStatus(`Last reply: note sent (${counted} tracked ${counted === 1 ? 'item' : 'items'}, ~${estimateTokens(text)} tokens).`);
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
            return encountersIn(selection, { calendar: calendar(), now, dueSoonDays: relevanceSettings().dueSoonDays });
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
        const serious = lastFindings.filter(finding => finding.severity !== 'info');
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
    const next = mirrorOffscreen(scene.text, activeRecords(tracker, { kind: 'agenda' }));
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
        findings: current ? lastFindings : [],
        canSeed: !tracker.records.length && canSeed(),
        onSeed: () => void seed(),
        onPin: (id, pinned) => setPin(id, pinned),
        route: routePlaces(book).length > 1 ? { places: routePlaces(book), era: travelEra(), onRoute: (from, to, mode) => routeText(from, to, { mode }) } : null,
        places: { book, map: settings().map, formatTime: time => (time === null ? '' : cal.format(time)) },
        arc: arcView(selection, tracker),
        spoiler: settings().spoilerGuard !== false
            ? { locked: isLocked(), onReveal: () => setRevealed(true), onHide: () => setRevealed(false) }
            : null,
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

function arcBeats(tracker, arc) {
    const beats = tracker.records.filter(record => record.kind === 'beat' && arc && record.arc === arc.arc);
    return { done: beats.filter(record => record.status !== 'active').length, total: beats.length, active: beats.filter(record => record.status === 'active') };
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

// Automatic: plan when there is no arc, when every beat of the arc is done, or when no beat
// is due within the stall window. Never while a plan waits for review.
async function maybePlanAutomatically(tracker) {
    if (planning || arcDraft()) return;
    const own = settings();
    const cal = calendar();
    const { selection, now } = situation('normal');
    const arc = selection.arc;
    if (!arc) {
        // Only once the story has something to plan from.
        if (tracker.records.length) await planArc({ reason: 'no-arc' });
        return;
    }
    const { total, active } = arcBeats(tracker, arc);
    if (total && !active.length) {
        await appendDirectorLines(`- ${arc.key} — every beat played out`).catch(() => {});
        await planArc({ reason: 'arc-end' });
        return;
    }
    if (now === null || !active.length) return;
    const horizon = cal.addDays(now, Number(own.arc.stallDays) || 7);
    const upcoming = active.some(beat => {
        const date = beat.fields.on ? cal.parse(beat.fields.on, { reference: now }) : null;
        return !date || date.abs <= horizon;
    });
    if (!upcoming) await planArc({ reason: 'stalled' });
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
    return [chatIdOf(ctx), chat.length, signature(chat.at(-1)), settings().dueSoonDays, JSON.stringify(settings().calendar), [...pendingAbandons(ctx)].join(',')].join('|');
}

function renderQuestsTab(pane) {
    const { active, finished, offered, now } = questRecords();
    // (0.9.12) Each deadline at the clock time the calendar sets: "Goldwane 12 sunset" reads
    // "Goldwane 12, 07:00 pm", a date alone its last minute.
    const cal = calendar();
    const formatDate = value => cal.withClock(value, { reference: now });
    const status = questStatus(now);
    renderQuests(pane, { quests: active, finished, offered: offered.filter(record => status(record) !== 'overdue'), formatDate, status, abandoning: pendingAbandons(), onAbandon: id => abandonQuest(id), onKeep: id => keepQuest(id) });
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
function abandonedStamp(message) {
    const list = message?.extra?.storyDirector?.abandoned;
    return Array.isArray(list) ? list.map(String) : [];
}

function abandonState(ctx = context()) {
    const meta = chatMeta(ctx);
    const state = meta?.[SETTINGS_KEY]?.abandon;
    if (!state || !Array.isArray(state.keys) || !state.keys.length) return null;
    const attachedTo = Number.isInteger(state.attachedTo) ? state.attachedTo : null;
    // The reply it went with was deleted: the abandon is taken back.
    if (attachedTo !== null && !isAssistant(ctx?.chat?.[attachedTo])) {
        setAbandonState(null, ctx);
        return null;
    }
    return { keys: state.keys.map(String), attachedTo, sentFor: Number.isInteger(state.sentFor) ? state.sentFor : null };
}

function setAbandonState(state, ctx = context()) {
    const meta = chatMeta(ctx);
    if (!meta) return;
    meta[SETTINGS_KEY] = { ...(meta[SETTINGS_KEY] ?? {}), abandon: state && state.keys?.length ? state : null };
    ctx.saveMetadataDebounced?.();
}

/** Quests the reader is giving up with the next reply (not yet sent with one). */
function pendingAbandons(ctx = context()) {
    const state = abandonState(ctx);
    return new Set(state && state.attachedTo === null ? state.keys : []);
}

function abandonQuest(id) {
    const record = questRecords().active.find(entry => entry.id === id);
    if (!record) return;
    const state = abandonState() ?? { keys: [], attachedTo: null, sentFor: null };
    // A new choice after the last one was sent starts afresh.
    const keys = state.attachedTo === null ? state.keys : [];
    if (!keys.includes(record.id)) keys.push(record.id);
    setAbandonState({ keys, attachedTo: null, sentFor: null });
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
function abandoningFor(slot, tracker) {
    const state = abandonState();
    if (!state) return [];
    if (state.attachedTo !== null && slot > state.attachedTo) {
        setAbandonState(null);
        return [];
    }
    if (state.attachedTo !== null && slot !== state.attachedTo) return [];
    if (state.sentFor !== slot) setAbandonState({ ...state, sentFor: slot });
    return state.keys.map(id => findRecord(tracker, id)?.key).filter(Boolean);
}

/** After the reply the abandon went with: stamp the reader's choice, and close what the story left open. */
async function closeAbandoned(index) {
    const ctx = context();
    const sb = storyBlock();
    const state = abandonState(ctx);
    if (!state || state.sentFor !== index) return false;
    const message = ctx.chat[index];
    message.extra = { ...(message.extra ?? {}), storyDirector: { ...(message.extra?.storyDirector ?? {}), abandoned: state.keys } };
    setAbandonState({ ...state, attachedTo: index }, ctx);
    const { tracker } = trackerAt(index);
    const open = state.keys.map(id => findRecord(tracker, id)).filter(record => record && record.status === 'active');
    if (open.length) {
        const existing = sb.blockInText(message.mes, BLOCK.tag)?.text ?? '';
        const lines = open.map(record => `- ${record.key} — abandoned`).join('\n');
        await sb.setBlockText(index, BLOCK.tag, existing ? `${existing}\n${lines}` : lines);
    } else {
        await ctx.saveChat?.();
    }
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
    });
    return true;
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
    cache = { chatId: null, entries: [] };
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
    cache = { chatId: null, entries: [] };
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
    // Only once the story has a quest, so a chat without any is not given an empty tab.
    sb.registerTab({
        id: QUESTS_TAB_ID,
        label: 'Quests',
        icon: '📜',
        order: 89,
        isAvailable: () => {
            try {
                if (!settings().enabled) return false;
                const { active, finished } = questRecords();
                return active.length + finished.length > 0;
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
            cache = { chatId: null, entries: [] };
            lastFindings = [];
            lastFindingsKey = '';
            setNote('');
        });
    }
    for (const event of [events.APP_READY, events.EXTENSION_SETTINGS_LOADED]) {
        if (event) ctx.eventSource.on(event, ensureUi);
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
