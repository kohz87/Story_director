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
// - With a world pack (the reader's map), travel legs are checked against its roads and
//   paces, corrections go into the next note, and /route plans a journey.
// - Optionally, a capture call (a model of its own) writes a reply's change lines when the
//   model did not, or always, for writers that skip or garble them.
// - Once per arc, the planner (one model call, on the chat's model or a connection profile)
//   turns the next arc into tracked records: an arc, dated beats, agendas, hooks, clocks and
//   secrets. A plan waits in the tab for the reader unless they chose to skip review.

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
import { MODES, findPlace, formatRoute, loadWorldPack, packSummary, planRoute } from './src/routes.js';
import { corrections, nearbyPlaces, travelFindings } from './src/travel.js';
import { DEFAULT_PLANNER_PROMPT, buildPlannerMessages, parsePlan, planToOps, summarizeTracker, validatePlan } from './src/planner.js';
import { buildCaptureMessages, parseCapture } from './src/capture.js';
import { importWorldStateAlpha } from './src/wsa.js';

const VERSION = '0.5.1';
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
    arc: Object.freeze({ trigger: 'manual', model: { source: 'chat' }, recent: 60, maxTokens: 1500, stallDays: 7, autoAccept: false, genre: '', note: '', prompt: '' }),
    capture: Object.freeze({ mode: 'off', model: { source: 'chat' }, maxTokens: 800 }),
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
    store[SETTINGS_KEY] = {
        ...DEFAULT_SETTINGS,
        ...saved,
        calendar: normalizeCalendar(saved.calendar ?? DEFAULT_SETTINGS.calendar),
        arc: { ...DEFAULT_SETTINGS.arc, ...(saved.arc && typeof saved.arc === 'object' ? saved.arc : {}) },
        capture: { ...DEFAULT_SETTINGS.capture, ...(saved.capture && typeof saved.capture === 'object' ? saved.capture : {}) },
    };
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
    // With a map, places one road away count as "here" for relevance.
    const nearby = nearbyPlaces(worldPack(), place);
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

async function onGenerationInterceptor(_chat, _contextSize, _abort, type = 'normal') {
    try {
        if (isBackground(type)) return;
        const ctx = context();
        if (!ctx || !chatIdOf(ctx) || !storyBlock() || !settings(ctx).enabled) {
            setNote('');
            return;
        }
        const { selection, tracker } = situation(type);
        const cal = calendar();
        const fixes = corrections(travelFindings(tracker, { pack: worldPack(), calendar: cal }));
        // With capture writing every reply's changes, the model is not asked to.
        const instructionless = settings(ctx).capture.mode === 'always' ? { instruction: '' } : {};
        const note = buildNote(selection, { calendar: cal, budgetTokens: relevanceSettings().budgetTokens, corrections: fixes, ...instructionless });
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
        // Capture first, so the checks below see the changes it wrote.
        if (settings(ctx).capture.mode !== 'off' && !sb.blockInText(chat[index].mes, BLOCK.tag)) await capture(index);
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
        if (serious.length) notify('warning', serious.slice(0, 3).map(finding => finding.message).join(' · '));
        if (settings(ctx).mirrorOffscreen) await mirror(index, after);
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
    return [chatIdOf(ctx), chat.length, signature(chat.at(-1)), [...pins()].join(','), lastFindingsKey, JSON.stringify(rest), pack ? packSummary(worldPack()) : '', planning, planError, draft?.key ?? ''].join('|');
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
        route: worldPack() ? { places: Object.keys(worldPack().places).sort(), onRoute: (from, to, mode) => routeText(from, to, { mode }) } : null,
        arc: arcView(selection, tracker),
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

// The planner's one call: a connection profile (its own API and model) or the chat's own.
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
    if (planning || !ctx || !chatIdOf(ctx) || !storyBlock()) return;
    const own = settings(ctx);
    planning = true;
    planError = '';
    storyBlock()?.refresh?.();
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
        }).map(message => ({ ...message, content: subst(message.content) }));
        if (reason !== 'manual') notify('info', 'Planning the next arc…');
        const answer = await sendToModel(messages, own.arc.model, Number(own.arc.maxTokens) || 1500);
        const plan = parsePlan(answer, { calendar: cal, now });
        const userName = String(ctx.name1 ?? '');
        const findings = validatePlan(plan, { calendar: cal, now, userName });
        if (findings.some(finding => finding.severity === 'error')) {
            planError = `The plan could not be used: ${findings.filter(finding => finding.severity === 'error').map(finding => finding.message).join('; ')}`;
            return;
        }
        const arcId = `arc-${Date.now().toString(36)}`;
        const text = planToOps(plan, { arcId }).map(formatOp).join('\n');
        const draft = { key: arcId, chatId: chatIdOf(ctx), text, findings, reason };
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
    } finally {
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

/** A journey from the scene's current time: one readable line, or why there is none. */
function routeText(fromText, toText, { mode = 'foot', rate = null } = {}) {
    const pack = worldPack();
    if (!pack) return 'No world pack is loaded (Extensions → Story Director → World pack).';
    const from = findPlace(pack, fromText);
    const to = findPlace(pack, toText);
    if (!from) return `"${fromText}" is not a place in the world pack.`;
    if (!to) return `"${toText}" is not a place in the world pack.`;
    const travel = MODES.includes(mode) ? mode : 'foot';
    const { now } = situation('normal');
    const cal = calendar();
    const plan = planRoute(pack, from, to, { mode: travel, rate, depart: now, calendar: cal });
    return plan ? formatRoute(plan, cal) : `No ${travel} route from ${from} to ${to}.`;
}

// `/route Shorn to Auvoth ride`, `/route Shorn → Auvoth mode=courier`, `/route from=Shorn to=Auvoth`.
function parseRouteArgs(named, unnamed) {
    let text = String(unnamed ?? '').trim();
    let mode = String(named?.mode ?? '').trim().toLowerCase();
    const lastWord = /\s+(\w+)$/.exec(text);
    if (!mode && lastWord && MODES.includes(lastWord[1].toLowerCase())) {
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
                : 'Usage: /route FROM to TO [foot|ride|wagon|boat|courier] [rate=N]';
            globalThis.toastr?.info?.(answer, 'Route', { timeOut: 20000, extendedTimeOut: 10000 });
            return answer;
        },
        namedArgumentList: [
            SlashCommandNamedArgument.fromProps({ name: 'mode', description: 'foot, ride, wagon, boat or courier', typeList: [ARGUMENT_TYPE.STRING], enumList: MODES }),
            SlashCommandNamedArgument.fromProps({ name: 'rate', description: 'km per day, overriding the pace', typeList: [ARGUMENT_TYPE.NUMBER] }),
            SlashCommandNamedArgument.fromProps({ name: 'from', description: 'start place', typeList: [ARGUMENT_TYPE.STRING] }),
            SlashCommandNamedArgument.fromProps({ name: 'to', description: 'destination', typeList: [ARGUMENT_TYPE.STRING] }),
        ],
        unnamedArgumentList: [
            SlashCommandArgument.fromProps({ description: 'FROM to TO [mode]', typeList: [ARGUMENT_TYPE.STRING] }),
        ],
        helpString: 'Plans a journey over the Story Director world pack: hops, km, pace, days (each road rounded up to a half day, rest days on land) and the arrival from the scene\'s current time.',
    }));
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
    settingsPanel = renderSettings(wrapper, {
        settings: settings(),
        blocks: (sb?.listBlocks?.() ?? []).filter(block => block.tag !== BLOCK.tag).map(({ tag, name }) => ({ tag, name })),
        onChange: next => {
            const ctx = context();
            ctx.extensionSettings[SETTINGS_KEY] = { ...settings(ctx), ...next, calendar: normalizeCalendar(next.calendar), arc: { ...DEFAULT_SETTINGS.arc, ...(next.arc ?? {}) }, capture: { ...DEFAULT_SETTINGS.capture, ...(next.capture ?? {}) } };
            saveSettings(ctx);
            // The calendar or the scene block may have changed: every cached replay is stale.
            cache = { chatId: null, entries: [] };
            storyBlock()?.refresh?.();
        },
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
    });
    return true;
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
    saveSettings(ctx);
    cache = { chatId: null, entries: [] };
    // The panel holds its own copy of the settings; give it the adopted calendar so its next
    // edit does not write the old one back.
    if (adopted) settingsPanel?.update(settings(ctx), { packSummary: packSummary(pack) });
    storyBlock()?.refresh?.();
    const note = warnings.length ? ` ${warnings.length} ${warnings.length === 1 ? 'note' : 'notes'} (e.g. ${warnings[0]}).` : '';
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
    registerSlashCommand();
    ensureUi();
    console.info(`[Story Director] v${VERSION} loaded.`);
}

void init();
