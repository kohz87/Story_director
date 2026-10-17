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
//   mirrored into the scene block's Off-Screen section for NPC State Delta.

import { PRESETS, makeCalendar, normalizeCalendar } from './src/calendar.js';
import { formatOp, parseChanges } from './src/changes.js';
import { activeRecords, emptyTracker, replay } from './src/tracker.js';
import { seedFromWorldState } from './src/seed.js';
import { mirrorOffscreen } from './src/mirror.js';
import { DEFAULTS, classify, estimateTokens } from './src/relevance.js';
import { buildNote } from './src/note.js';
import { checkReply } from './src/checks.js';
import { renderSettings } from './src/ui/settings.js';
import { renderTab } from './src/ui/tab.js';

const VERSION = '0.1.0';
const SETTINGS_KEY = 'storyDirector';
const PROMPT_KEY = 'story_director';
const BLOCK = { id: 'story-director', tag: 'Director', name: 'Story Director', icon: '🎬' };
const TAB_ID = 'story-director';
const EXTENSION_PROMPT_IN_CHAT = 1;
const EXTENSION_PROMPT_ROLE_SYSTEM = 0;
const MIN_STORY_BLOCK_API = 1;

const DEFAULT_SETTINGS = Object.freeze({
    enabled: true,
    sceneTag: 'World_State',
    depth: 1,
    budgetTokens: DEFAULTS.budgetTokens,
    dormantReplies: DEFAULTS.dormantReplies,
    dormantDays: DEFAULTS.dormantDays,
    dueSoonDays: DEFAULTS.dueSoonDays,
    mirrorOffscreen: true,
    calendar: PRESETS.gregorian,
});

let initialized = false;
let registered = false;
let uiRetry = null;
let lastFindings = [];
let lastFindingsKey = '';
// Replay cache: one entry per message of the active chat, { sig, tracker, problems, … }.
let cache = { chatId: null, entries: [] };

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

function notify(level, message) {
    globalThis.toastr?.[level]?.(message, 'Story Director');
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
    store[SETTINGS_KEY] = { ...DEFAULT_SETTINGS, ...saved, calendar: normalizeCalendar(saved.calendar ?? DEFAULT_SETTINGS.calendar) };
    return store[SETTINGS_KEY];
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
    return `${message?.is_user ? 'u' : 'a'}:${text.length}:${hash}`;
}

// One replay entry per message: its change lines (assistant replies only), its narration
// (for "seen"), and the story time its scene block states.
function entryFor(message, index, sb, cal, own, reference) {
    const assistant = isAssistant(message);
    const block = assistant ? sb.blockInText(message.mes, BLOCK.tag) : null;
    const parsed = block ? parseChanges(block.text) : { ops: [], errors: [] };
    const scene = assistant ? sb.blockInText(message.mes, own.sceneTag) : null;
    const timeText = scene ? sceneTimeText(scene.text) : '';
    const date = timeText ? cal.parse(timeText, { reference }) : null;
    return {
        entry: { message: index, ops: block ? parsed.ops : null, text: visibleText(message), time: date ? date.abs : null },
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
        const read = entryFor(chat[index], index, sb, cal, own, seed.time ?? null);
        const result = replay([read.entry], { seed });
        cache.entries[index] = {
            sig: signature(chat[index]),
            tracker: result.tracker,
            problems: result.problems,
            hadBlock: read.hadBlock,
            parseErrors: read.parseErrors,
        };
    }
    const at = last >= 0 ? cache.entries[last] : null;
    return { tracker: at?.tracker ?? emptyTracker(), problems: at?.problems ?? [], info: at ?? null };
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
    const cal = calendar();
    const replacing = replacesLastReply(chat, type);
    const upTo = replacing ? chat.length - 2 : chat.length - 1;
    const { tracker } = trackerAt(upTo);
    const scene = sb?.blockForGeneration?.(own.sceneTag, type) ?? null;
    const sceneText = scene?.text ?? '';
    const parsed = sceneText ? cal.parse(sceneTimeText(sceneText), { reference: tracker.time }) : null;
    const now = parsed?.abs ?? tracker.time ?? null;
    const recent = chat.slice(Math.max(0, upTo - 1), upTo + 1).map(visibleText).join('\n');
    const place = scenePlace(sceneText);
    const selection = classify(withPins(tracker), {
        calendar: cal,
        now,
        message: Math.max(upTo, 0),
        place,
        sceneText,
        recentText: recent,
        settings: relevanceSettings(own),
    });
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

async function onGenerationInterceptor(_chat, _contextSize, _abort, type = 'normal') {
    try {
        if (isBackground(type)) return;
        const ctx = context();
        if (!ctx || !chatIdOf(ctx) || !storyBlock() || !settings(ctx).enabled) {
            setNote('');
            return;
        }
        const { selection } = situation(type);
        const note = buildNote(selection, { calendar: calendar(), budgetTokens: relevanceSettings().budgetTokens });
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
        const serious = lastFindings.filter(finding => finding.severity !== 'info');
        if (serious.length) notify('warning', serious.slice(0, 3).map(finding => finding.message).join(' · '));
        if (settings(ctx).mirrorOffscreen) await mirror(index, after);
        // After the mirror: it rewrites the reply's scene block, which changes its signature.
        lastFindingsKey = findingsKey(index);
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
    return [chatIdOf(ctx), chat.length, signature(chat.at(-1)), [...pins()].join(','), lastFindingsKey, JSON.stringify(settings())].join('|');
}

function renderDirectorTab(pane) {
    const cal = calendar();
    const { selection, now, place, tracker } = situation('normal');
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
    });
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

function addSettingsPanel(documentRef) {
    if (documentRef.querySelector('#story_director_settings')) return true;
    const host = documentRef.querySelector('#extensions_settings2') ?? documentRef.querySelector('#extensions_settings');
    if (!host) return false;
    const wrapper = documentRef.createElement('div');
    wrapper.id = 'story_director_settings';
    host.appendChild(wrapper);
    const sb = storyBlock();
    renderSettings(wrapper, {
        settings: settings(),
        blocks: (sb?.listBlocks?.() ?? []).filter(block => block.tag !== BLOCK.tag).map(({ tag, name }) => ({ tag, name })),
        onChange: next => {
            const ctx = context();
            ctx.extensionSettings[SETTINGS_KEY] = { ...settings(ctx), ...next, calendar: normalizeCalendar(next.calendar) };
            saveSettings(ctx);
            // The calendar or the scene block may have changed: every cached replay is stale.
            cache = { chatId: null, entries: [] };
            storyBlock()?.refresh?.();
        },
        onSeed: () => void seed(),
        status: sb ? `v${VERSION}` : `v${VERSION} · needs Story Block 0.6 or newer`,
    });
    return true;
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
    sb.onReply(payload => void onReply(payload));
    registered = true;
    return true;
}

// The settings panel needs SillyTavern's drawer, the rest needs Story Block; either can be
// late on a slow load, so keep trying until both are in place.
function ensureUi() {
    const panel = addSettingsPanel(document);
    const linked = registerWithStoryBlock();
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
    ensureUi();
    console.info(`[Story Director] v${VERSION} loaded.`);
}

void init();
