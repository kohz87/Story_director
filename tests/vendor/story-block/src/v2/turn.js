// A turn (docs/v2/SPEC.md §4, §5): Story Suite's SillyTavern wiring.
//
// Before the reply (the generation interceptor, for normal, swipe, regenerate and continue):
// flush pending saves, let modules add cues (beforeGenerate), collect the untold receipts and
// assemble the two prompt texts; the static part goes in-prompt, this reply's part in-chat at
// depth 0. The interceptor's context size holds them to a share of it (prompt.js contextFit): the
// tail is cut to fit (what modules send under their own keys, their `ownPrompt` hooks, counts toward it
// too), and when the static part alone is too big the reader is told once per chat. Quiet and impersonate generations (and any other kind) get both slots emptied.
// At prompt-ready: hidden change blocks leave the prompt history, and when the preset left out
// the Main Prompt (SillyTavern then drops in-prompt text) the static part is put back at the
// start of this reply's part, for the story's own prompt only.
// A module's canGenerate hook may stop a story generation first (the interceptor's abort).
// After the reply (MESSAGE_RECEIVED for the carrier the interceptor prepared): read its
// <Changes> block, run each line as its owner's capture command (cause 'story'), append what
// was accepted, run each module's afterCapture hook once after the reply's last story line (its
// commands as `system` steps kept on the reply), record what the reply was told, save once. A line no module takes, or one its
// owner rejects, goes to the Problems list; nothing is thrown at the reader.
// A failed save (before or after the reply) is told and logged but never drops the turn: the state
// stays in memory, marked unsaved, and the save is tried again after the reply.
//
// turn.js receives the SillyTavern context and the host parts; it never imports the store or
// the command bus (their interfaces are docs/v2/SPEC.md §12).

import { adoptLegacy, continuation, cutLine, defangMarker, extractBlock, hideBlock, markOff, parseChanges, withAssist } from './capture.js';
import { notWritten } from './assist/extractor.js';
import { PRECHECK } from './assist/classifier.js';
import { refusedWhy } from './assist/safety.js';
import { readRecord, swipeLoading } from './persist.js';
import { ensureModules, makeView } from './sdk.js';
import { cutAt } from '../text.js';
import { SKILL_SLOTS_MAX } from './skill-slots.js';

// A story line that practises a skill (`practice-N`, data-modules/part.js): the lines a reply is marked for (see captureEach).
const PRACTICE_LINE = new RegExp(`\\|\\s*kind\\s*:\\s*practice-[1-${SKILL_SLOTS_MAX}]\\b`, 'iu');
import { contentText, contextRoom, within } from './turn/text.js';
import { createSession } from './turn/session.js';
import { createCaptureFlow } from './turn/capture-flow.js';
import { createReread } from './turn/reread.js';
import { createPromptBuild } from './turn/prompt-build.js';
import { createPromptHooks } from './turn/prompt-hooks.js';
export { QUIET_MARK_MIN, QUIET_WAIT_MS, MAX_NAME, stripBattleMarker, contextRoom, defuseMacros, flatName, substituteNames, quietMark, restoreMissing } from './turn/text.js';

export const STATIC_KEY = 'story_suite_static';
export const TAIL_KEY = 'story_suite_tail_1';
// Story Block v1's keys (0.9.21+ and before), cleared on load so an old copy never lingers.
export const V1_KEYS = Object.freeze([
    ['story_suite_static_story_block', 'static'],
    ['story_suite_tail_1_story_block', 'tail'],
    ['story_block', 'static'],
]);
export const FOREGROUND = Object.freeze(['normal', 'swipe', 'regenerate', 'continue']);
// A module's `ownPrompt` hook: at most this many parts, each counted up to this many characters.
export const OWN_PROMPT_PARTS = 8;
export const OWN_PROMPT_CHARS = 200000;
export const INTERCEPTOR_NAME = 'storyBlockGenerationInterceptor';
// SillyTavern's extension_prompt_types and extension_prompt_roles, when the context lacks them.
const IN_PROMPT = 0;
const IN_CHAT = 1;
const ROLE_SYSTEM = 0;
const MAX_PROBLEMS = 200;
// How long a canGenerate or beforeGenerate hook may take before the reply goes on without it.
export const HOOK_TIMEOUT_MS = 2500;
// A hook may declare its own, longer limit (`fn.timeoutMs`): the RPG's planner makes a model call of up to 20 s.
export const hookTimeout = fn => (Number.isFinite(fn?.timeoutMs) && fn.timeoutMs > HOOK_TIMEOUT_MS ? fn.timeoutMs : HOOK_TIMEOUT_MS);
// A reply that never ends (no MESSAGE_RECEIVED, GENERATION_ENDED or STOPPED) stops counting as in progress
// after this long, so Story Suite's own model calls on the chat's connection are not held up for good.
export const REPLY_BUSY_MAX_MS = 5 * 60_000;
// How long a send waits for the Assist safety net still reading the last reply (MODULES §F123): briefly.
// Lines that come later are kept on that reply and applied on the next one, right after its own lines.
export const ASSIST_WAIT_MS = 1500;
// How long the RPG's code (rpg-lazy.js) may take to load before a reply or a chat goes on without it: a stalled import never holds a generation or a chat open.
export const RPG_LOAD_WAIT_MS = 4000;
// Stripped history texts kept between prompts (each is read again for every later prompt).
const STRIP_CACHE = 500;
const HAS_BLOCK = /<changes/i;
// Story Block v1's envelope (capture.js adoptLegacy): never sent to the model. In a text completion prompt only a closed
// one, and never across another comment's start, so one left open cannot take the rest of the prompt with it.
const HAS_LEGACY = /<!--\s*(?:STORY_BLOCKS_V1|INVENTORY_BLOCK_V05)/i;
const LEGACY_IN_PROMPT = /\s*<!--\s*(?:STORY_BLOCKS_V1_CUT|STORY_BLOCKS_V1|INVENTORY_BLOCK_V05)\b(?:(?!<!--)[\s\S])*?-->/gi;

const defaultNotify = reason => globalThis.toastr?.warning?.(reason, 'Story Suite');

// Why the state was rebuilt, as the head event tells it (the public API's `story:rebuilt`; 'edit' is not announced).
const REBUILD_REASONS = new Set(['delete', 'swipe', 'edit']);

export const normalizeType = type => String(type ?? 'normal').trim().toLowerCase() || 'normal';
const holdsIn = chat => mark => chat.some(message => contentText(message?.content).includes(mark));
const isCarrier = message => Boolean(message) && !message.is_user;

/**
 * Wires one SillyTavern context. `deps`: { ctx, live?() (SillyTavern's live context, for its API settings;
 * default ctx), store, bus, registry, settings, events?,
 * onBlocked?(reason, moduleId), notify?(reason, moduleId) (default: a toastr warning),
 * initial?() → the initial State for a chat with none (default registry.initialState(); the host
 * adds the packs' start, SPEC §2.6), ownPrompt?(eventData) → true for the prompt of Story Suite's own model
 * call on the chat's connection (model-call.js createOwnCalls().owns): never taken for the reply's }.
 * `settings` is createSettings() (settings() → host settings, settings(id) → a module's).
 * Returns { interceptor, install, uninstall, onGenerationStarted, onPromptReady, onTextPromptReady, onMessageReceived,
 * onChatChanged, seed, onChatRenamed, onTimelineChanged, onGenerationEnded, preview, report, problems, clearProblems, blocked, blockers, unblock,
 * session, replyBusy, whenIdle }.
 */
export function createTurn({ ctx, live = () => ctx, store, bus, registry, settings, events = null, onBlocked = null, notify = defaultNotify, initial = () => registry.initialState(), ownPrompt = () => false, timeline = null, prepare = null }) {
    const types = () => ctx?.extension_prompt_types ?? ctx?.extensionPromptTypes ?? {};
    const roles = () => ctx?.extension_prompt_roles ?? ctx?.extensionPromptRoles ?? {};
    const position = place => (place === 'static' ? types().IN_PROMPT ?? IN_PROMPT : types().IN_CHAT ?? IN_CHAT);
    const hostSettings = () => (typeof settings === 'function' ? settings() : settings ?? {});
    // Story Block's readers of earlier messages that this turn owns, each asked for by name from the timeline's active-history filter
    // (timeline/active.js): messages a restore faded are not a module's last reader message nor a source of late lines. (A request is not
    // filtered here: SillyTavern leaves the hidden messages out of it, and a restore hides what it faded.) A host without a timeline has none.
    const reader = name => (typeof timeline?.active === 'function' ? timeline.active(name) : null);
    const lateReader = reader('assist.late');
    const viewReader = reader('view.lastUser');
    const s = {
        session: null,
        deferred: false,   // cues committed before a reply, left for the reply's save (runCues)
        listeners: [],
        problemLog: [],
        blocks: [],
        lastSize: null,   // the context size the last interceptor call was handed
        // Quiet generations told by GENERATION_STARTED: { mark, claimed (its interceptor ran, at this time) }, oldest first.
        quiets: [],
        // What the two slots hold now (setPrompts).
        slots: { staticText: '', tailText: '' },
        toldSmall: new Set(),   // chats whose reader was told the context is too small
        // A reply in progress: from its interceptor until it is received, ended, stopped or held back (or the
        // chat changes). Story Suite's own model calls on the chat's connection wait for it (whenIdle).
        replyBusy: false,
        // The Assist safety net's runs on the last reply (afterReply), until they settle.
        assistPending: null,
        busyTimer: null,
        idleWaiters: [],
        // Every earlier reply is in every prompt: what its text is without blocks is remembered, and a
        // text with no "<changes" in it at all is passed by without reading it further.
        stripped: new Map(),
        offModules: null,
    };
    const liveContext = () => {
        try { return live() ?? ctx; } catch { return ctx; }
    };
    const contextNow = () => contextRoom(liveContext(), s.lastSize);
    const whenIdle = () => (s.replyBusy ? new Promise(resolve => s.idleWaiters.push(resolve)) : Promise.resolve());
    // Our own model call's prompt (model-call.js) is never the reply's.
    const isOwn = eventData => {
        try { return ownPrompt(eventData) === true; } catch { return false; }
    };

    const view = () => makeView({ store, registry, settings, chat: ctx?.chat, active: viewReader });
    const hasCarrier = () => (ctx?.chat ?? []).some(isCarrier);
    const lastCarrier = () => (ctx?.chat ?? []).findLastIndex(isCarrier);

    // The commands run as preludes: Assist's pre-roll, and any command a module marks `prelude` (registry.isPrelude).
    const isPrelude = type => type === PRECHECK || registry.isPrelude?.(type) === true;

    const refusal = (code, message) => ({ ok: false, code, message });

    // Session housekeeping and Re-read (turn/session.js, turn/reread.js): wired here, after every const they are given.
    const { markBusy, markIdle, setPrompt, setPrompts, clearPrompts, problem, trySave, ensureInitial, repairActions, repair, startOver, rebuild, planAgain, reconcileNow } = createSession(s, { ctx, store, bus, events, notify, initial, position, roles, hasCarrier, refusal, STATIC_KEY, TAIL_KEY, REPLY_BUSY_MAX_MS, MAX_PROBLEMS, ROLE_SYSTEM });
    // The capture flow (turn/capture-flow.js): wired here, after the session's `problem` it is given and before the Re-read that calls it.
    const { changeHeads, readBlock, strayProblems, legacyProblem, capped, assistRoom, lateLines, nowLines, captureLines, afterCapture, stepSeeds, captureEach, storySeeds, heldInReply, withCaps, LATE, NOW } = createCaptureFlow(s, { ctx, store, bus, registry, settings, events, hostSettings, view, viewReader, lateReader, problem, isCarrier, PRACTICE_LINE, HOOK_TIMEOUT_MS });
    const { reread, saveText, redraw } = createReread(s, { ctx, store, events, timeline, refusal, changeHeads, readBlock, strayProblems, capped, lateLines, assistRoom, nowLines, heldInReply, legacyProblem, storySeeds, afterCapture, captureEach, stepSeeds, withCaps, isPrelude, LATE, NOW, planAgain, problem, trySave });

    // The prompt side of a turn (turn/prompt-build.js, turn/prompt-hooks.js): wired here, after every const they are given. The interceptor asks for claimQuiet only when it runs.
    const { runCues, build, askCanGenerate, runOnBlocked, interceptor, battleOn, stripHistory, backgroundPrompt, foreignPrompt } = createPromptBuild(s, { ctx, store, bus, registry, settings, events, onBlocked, notify, initial, prepare, hostSettings, viewReader, view, contextNow, hasCarrier, lastCarrier, isPrelude, markBusy, markIdle, setPrompts, clearPrompts, problem, trySave, claimQuiet: () => claimQuiet(), FOREGROUND, HOOK_TIMEOUT_MS, ASSIST_WAIT_MS, RPG_LOAD_WAIT_MS, OWN_PROMPT_PARTS, OWN_PROMPT_CHARS, STRIP_CACHE, HAS_BLOCK, HAS_LEGACY, hookTimeout, normalizeType });
    const { onGenerationStarted, claimQuiet, onPromptReady, onTextPromptReady } = createPromptHooks(s, { isOwn, battleOn, stripHistory, backgroundPrompt, foreignPrompt, HAS_LEGACY, LEGACY_IN_PROMPT, holdsIn, normalizeType });

    /** MESSAGE_RECEIVED: (messageId, type). */
    async function onMessageReceived(messageId) {
        const id = Number(messageId);
        const current = s.session;
        if (!current || !Number.isInteger(id) || id !== current.index) return null;
        s.session = null;
        markIdle();
        clearPrompts();
        const message = ctx?.chat?.[id];
        if (!isCarrier(message)) return null;
        // The turn's save window opens now, so the capture's lines are not saved one by one (400 ms each).
        const idle = store.saveIdle?.() === true;
        try {
            if (store.headIndex() !== id) store.rebuild();
            ensureInitial();
            if (store.headIndex() !== id) {
                problem({ index: id, code: 'FAILED', message: 'The reply is not the last message that keeps the story, so its changes were not read.' });
                return null;
            }
            const written = String(message.mes ?? '');
            // A Continue: SillyTavern wrote the old text again, cleaned up, so it can be shorter than it
            // was; where the added text starts is found, not counted, or its block is left bare.
            const at = typeof current.base === 'string' ? continuation(current.base, written) : null;
            // C2-7: a copy of the hidden comment's marker the model wrote itself is defanged first, so the
            // reply is read live as Re-read will read the saved message.
            // A v1 envelope (capture.js adoptLegacy): read as the reply's block when it has none, else taken out unread.
            const adopted = adoptLegacy(defangMarker(written, at?.from ?? 0), { at });
            const text = adopted.text;
            let edited = false;
            if (text !== written) {
                message.mes = text;
                if (Array.isArray(message.swipes) && Number.isInteger(message.swipe_id)) message.swipes[message.swipe_id] = text;
                edited = true;
            }
            // The reader stopped it (GENERATION_STOPPED): an open block's unfinished last line is left out.
            const stopped = current.stopped === true;
            // Change lines written in the story near the block are read with it (capture.js strayLines).
            const heads = changeHeads();
            const block = extractBlock(text, 'Changes', at, { stopped, heads });
            const parsed = block === null ? { lines: [], problems: [] } : readBlock(id, block);
            const problems = [...parsed.problems, ...strayProblems(id, text, heads, { from: at?.from ?? 0, tail: at?.tail === true, stopped }, parsed.lines.map(line => line.raw))];
            if (adopted.legacy === 'read') problems.push(legacyProblem(id));
            const cut = block === null ? null : cutLine(text, 'Changes', at);
            if (cut) problems.push(problem({ index: id, line: cut, code: 'CUT_OFF', message: `The reply ended in the middle of the change line "${cutAt(cut, 80)}" (nothing after it on its line, and the block was not closed), so it was not used. Continue finishes it; or end the line and close the block by hand, then Re-read.` }));
            // The previous reply's safety-net lines that came after the reader sent (not for a Continue).
            const late = current.type === 'continue' ? [] : lateLines(id, parsed.lines.map(line => line.raw));
            const result = await captureLines(id, parsed.lines, at ? current.base : null, current.type, { late, prechecks: current.prechecks });
            problems.push(...result.problems);
            receivedHooks(id, current.type);

            // What this reply was told; a Continue keeps what the reply was told before.
            // (B-b2-timeline-9: read through readRecord, and only receipt IDs, whatever the chat holds.)
            const told = current.type === 'continue' ? readRecord(message)?.narrated ?? [] : [];
            const before = told.filter(id => typeof id === 'string');
            store.setNarrated(id, [...new Set([...before, ...current.untold, ...result.steps.filter(receipt => receipt.beforeGenerate === true).map(receipt => receipt.id)])], { reply: !(current.type === 'swipe' && id === 0) });   // (a swipe of the opening greeting is still a greeting)

            // Also with no block: the change lines left in the story are listed in the hidden comment, so a
            // Re-read leaves them too (B-a1-3, B-a1-10).
            let hidden = hideBlock(message.mes, 'Changes', { ...(at ?? {}), stopped, heads, legacy: adopted.legacy === 'read' });
            if (result.off.length) hidden = markOff(hidden, result.off, at?.from ?? 0);
            hidden = withCaps(hidden, at?.from ?? 0);
            if (hidden !== message.mes) {
                message.mes = hidden;
                if (Array.isArray(message.swipes) && Number.isInteger(message.swipe_id)) message.swipes[message.swipe_id] = hidden;
                edited = true;
            }
            if (timeline?.needsRecovery()) {
                const anchored = await timeline.recover();
                if (!anchored.ok) problem({ index: id, code: anchored.code, message: anchored.message });
            }
            s.deferred = false;
            // One write for the reply, its capture and the reader's actions after it (store.saveIdle).
            if (idle && store.dirty()) store.saveIdle();
            else if (store.dirty()) await trySave('after the reply');
            else if (edited) await saveText();
            // At MESSAGE_RECEIVED SillyTavern has not drawn the reply yet (it draws the text as saved), so
            // redrawing can fail; that is not a reason to lose the turn.
            if (edited) redraw(id, message);
            const turn = { index: id, type: current.type, receipts: result.receipts, steps: result.steps, problems, told: current.untold };
            events?.emit('turn', turn);
            afterReply(id, current.type, message, [...parsed.lines, ...late].map(line => line.raw));
            return turn;
        } catch (error) {
            problem({ index: id, code: 'FAILED', message: `The reply's changes could not be kept: ${error?.message ?? error}` });
            return null;
        }
    }

    // afterReply (the assist extractor): a reply that came without change lines may get them from a
    // module after all. Not awaited; a failure is logged. `capture(text, { index, swipe })` runs the
    // lines as story captures on that reply when it is still the head on the same swipe.
    // (The Assist safety net runs after every reply; `lines` are the change lines its capture read.) A send
    // waits for these runs briefly (assistPending, ASSIST_WAIT_MS).
    function afterReply(index, type, message, lines = []) {
        const swipe = Number.isInteger(message?.swipe_id) ? message.swipe_id : 0;
        const runs = [];
        for (const { moduleId, fn } of registry.hookEntries('afterReply')) {
            runs.push(Promise.resolve()
                .then(() => fn({ index, swipe, type, lines: [...lines], mes: String(message?.mes ?? ''), capture: (text, at = { index, swipe }, opts = {}) => captureLate(at, text, opts) }))
                .catch(error => problem({ module: moduleId, index, code: 'FAILED', message: `afterReply failed: ${error?.message ?? error}` }))
                // C2-ext: what the hook made of the reply (the extractor read it, or failed to) can change
                // the reply's note, so the notes are drawn again.
                .finally(() => { if (store.headIndex() === index) events?.emit('head', { index }); }));
        }
        if (!runs.length) return;
        const all = Promise.allSettled(runs).then(() => { if (s.assistPending === all) s.assistPending = null; });
        s.assistPending = all;
    }

    // afterReceive: every reply that arrives, with or without change lines, once its lines have been read and before it is
    // saved (the RPG lets go of the plan it held for the reply). Nothing is asked of it; a failure is a Problem.
    function receivedHooks(index, type) {
        for (const { moduleId, fn } of registry.hookEntries('afterReceive')) {
            try { fn(view(), { index, type }); } catch (error) {
                problem({ module: moduleId, index, code: 'FAILED', message: `afterReceive failed: ${error?.message ?? error}` });
            }
        }
    }

    /** Change lines found after the reply (afterReply): captured on it and kept in its hidden block. */
    async function captureLate({ index, swipe } = {}, text = '', { assist = false, refused = [] } = {}) {
        const message = ctx?.chat?.[index];
        if (assist) return captureAssist({ index, swipe }, text, message, refused);
        if (!isCarrier(message) || store.headIndex() !== index || (Number.isInteger(message.swipe_id) ? message.swipe_id : 0) !== swipe || s.session) {
            return { receipts: [], problems: ['The reply changed before its late change lines arrived; they were not used.'] };
        }
        const parsed = readBlock(index, String(text ?? ''));
        const problems = [...parsed.problems];
        const result = await captureLines(index, parsed.lines, String(message.mes ?? ''), 'late');
        problems.push(...result.problems);
        if (parsed.lines.length) {
            // Kept in a hidden block of their own after the reply's, so Re-read finds them too (and what the
            // reply's comment holds besides its block, the lines left in the story, stays as it was).
            const base = String(message.mes ?? '');
            const from = base.trimEnd().length;
            const mes = withCaps(markOff(hideBlock(`${base}\n\n<Changes>\n${parsed.lines.map(line => line.raw).join('\n')}\n</Changes>`, 'Changes', { from }), result.off, from), from);
            message.mes = mes;
            if (Array.isArray(message.swipes) && Number.isInteger(message.swipe_id)) message.swipes[message.swipe_id] = mes;
        }
        if (store.dirty()) {
            if (store.saveIdle?.() !== true) await trySave('after the late change lines');
        } else if (parsed.lines.length) await saveText();
        if (parsed.lines.length) redraw(index, message);
        const turn = { index, type: 'late', receipts: result.receipts, steps: result.steps, problems, told: [] };
        events?.emit('turn', turn);
        return turn;
    }

    /**
     * The Assist safety net's lines for reply `index` (MODULES §F123). Still the head on the same swipe and
     * no send begun: run now as story lines marked `assist: 'now'`, after the reply's own, and kept in its
     * <Changes-assist> section. A send already begun (the brief wait is over): kept on the reply as
     * <Changes-assist-next>, through the stricter wall, for the next reply to apply after its own lines;
     * nothing changes now. Anything else (swiped, deleted, the next reply already in): not used.
     */
    async function captureAssist({ index, swipe }, text, message, refused = []) {
        const same = isCarrier(message) && store.headIndex() === index && (Number.isInteger(message.swipe_id) ? message.swipe_id : 0) === swipe;
        if (!same) return { receipts: [], problems: ['The reply changed before the safety net\'s lines arrived; they were not used.'], dropped: true };
        // Lines the safety net wrote that code refused (an unknown name for a place the map has, a time with no clock time): a
        // Problems line each, so the reader sees what was left out and why; they are not applied and not kept on the reply.
        const refusals = (Array.isArray(refused) ? refused : []).filter(item => typeof item?.line === 'string' && item.line)
            .map(item => problem({ index, line: item.line, code: 'REFUSED', message: `"${item.line}" was not used: ${String(item.why ?? '').slice(0, 240)}.` }));
        const heads = changeHeads();
        const mes = String(message.mes ?? '');
        const block = extractBlock(mes, 'Changes', null, { heads });
        const blockLines = block === null ? [] : parseChanges(block).lines.map(line => line.raw);
        const own = [...blockLines, ...lateLines(index, []).map(line => line.raw)];
        const parsed = parseChanges(String(text ?? '')).lines;
        const fresh = new Set(notWritten(parsed.map(line => line.raw), own, { scene: blockLines }));
        const kept = parsed.filter(line => fresh.has(line.raw) && !refusedWhy(line, null, { late: Boolean(s.session || s.replyBusy) }));
        const store1 = mes2 => {
            message.mes = mes2;
            if (Array.isArray(message.swipes) && Number.isInteger(message.swipe_id)) message.swipes[message.swipe_id] = mes2;
        };
        if (s.session || s.replyBusy) {
            if (!kept.length) return { receipts: [], problems: refusals, deferred: true };
            // Saved with the next reply (its own save writes the chat).
            store1(withAssist(mes, kept.map(line => line.raw), { next: true }));
            redraw(index, message);
            return { receipts: [], problems: refusals, deferred: true, lines: kept.map(line => line.raw) };
        }
        if (!kept.length) return { index, type: 'late', receipts: [], steps: [], problems: refusals, told: [] };
        const used = block === null ? 0 : readBlock(index, block).lines.length;
        const result = await captureLines(index, [], mes, 'late', { assist: kept, used });
        store1(withCaps(markOff(withAssist(mes, kept.map(line => line.raw)), result.off, mes.trimEnd().length), mes.trimEnd().length));
        if (store.dirty()) {
            if (store.saveIdle?.() !== true) await trySave('after the safety net\'s lines');
        } else await saveText();
        redraw(index, message);
        const turn = { index, type: 'late', receipts: result.receipts, steps: result.steps, problems: [...refusals, ...result.problems], told: [] };
        events?.emit('turn', turn);
        return turn;
    }

    /** CHAT_CHANGED: a new chat (or the same one reloaded). */
    async function onChatChanged() {
        // The old chat's session and prompts go at once, before anything is awaited: a generation started while the RPG's code loads is the new chat's.
        s.session = null;
        s.quiets = [];
        markIdle();
        clearPrompts();
        // The RPG's code, when this chat needs it (the feature is on, or it holds the RPG's records), before anything is replayed (rpg-lazy.js); a stalled
        // import is waited for only RPG_LOAD_WAIT_MS (the guard mark then says the code is missing, so a later load makes the chat look again).
        if (typeof prepare === 'function') { try { await within(prepare(), RPG_LOAD_WAIT_MS); } catch { /* the loader reports its own failure */ } }
        rebuild({ publish: false });
        timeline?.settle();
        // A1-2: read-backs of a write that timed out before a reload of the page go on.
        try { store.resume?.(); } catch { /* only a guard */ }
        // A cue left for the reply's save (runCues) whose reply will not come here: saved now (into its
        // own chat's file when this is another chat, the store's rescue).
        if (s.deferred) {
            s.deferred = false;
            if (store.dirty?.()) store.scheduleSave?.();
        }
        await ensureModules({ store, bus, registry, events });
        events?.emit('head', { index: store.headIndex(), reason: 'chat' });
    }

    /**
     * A reader's action in a chat that has a message but no state yet (sdk.command): the state starts on its first carrier now, as
     * onChatChanged would. SillyTavern shows a new chat's greeting before it tells of the chat (CHAT_CHANGED comes after its save, and
     * after every listener ahead of Story Block's), and a message added with no event Story Block reads (/sendas into an empty chat)
     * starts nothing. No open chat, or no carrier: nothing to start. → true when the chat has a state.
     */
    function seed() {
        if (store.head()) return true;
        let open = true;
        try { open = typeof ctx?.getCurrentChatId !== 'function' || !!ctx.getCurrentChatId(); } catch { open = true; }
        if (!open || !hasCarrier()) return false;
        rebuild();
        return !!store.head();
    }

    /**
     * CHAT_RENAMED: { oldFileName, newFileName } (file names with ".jsonl"). SillyTavern 1.19 renames the
     * file, reads the open chat back (CHAT_CHANGED), then tells this; a change not saved yet goes into the
     * renamed file (store.renamed, B-b2-timeline-r2-2). The server may clean the new name up (characters
     * it does not allow in a file name); when the open chat's ID is that name cleaned up, it is the one.
     */
    function onChatRenamed(data) {
        const name = value => String(value ?? '').trim().replace(/\.jsonl$/i, '');
        const from = name(data?.oldFileName);
        let to = name(data?.newFileName);
        if (!from || !to) return false;
        let open = null;
        try { open = typeof ctx?.getCurrentChatId === 'function' ? ctx.getCurrentChatId() : null; } catch { open = null; }
        const loose = id => String(id).replace(/[\/?<>\\:*|"\u0000-\u001f\u0080-\u009f]/g, '').replace(/[. ]+$/, '');
        if (typeof open === 'string' && open && open !== from && open !== to && loose(open) === loose(to)) to = open;
        return store.renamed?.(from, to) ?? false;
    }

    /**
     * Deleted messages, swipes, a greeting picked: the state is rebuilt from what is stored. `reason` ('delete', 'swipe',
     * 'edit'; anything else is none) rides on the head event for the public API's `story:rebuilt`.
     */
    async function onTimelineChanged(reason) {
        rebuild({ publish: false });
        reconcileNow();
        timeline?.settle();
        if (timeline?.needsRecovery()) await timeline.recover();
        // one head, after the steps that follow the change are planned again
        events?.emit('head', { index: store.headIndex(), ...(REBUILD_REASONS.has(reason) ? { reason } : {}) });
    }

    /**
     * A deleted swipe. SillyTavern tells of the deletion of the swipe being shown before it shows the next one (`extra` is
     * still the deleted swipe's; MESSAGE_SWIPED follows). The shown swipe is told by whose record it holds, not by its text
     * (persist.js swipeLoading): while it is in flux nothing is rebuilt, restamped, reconciled or published, so no record is
     * written and no head is told of; the swipe load that follows does all of it once. Any other swipe deletion is a
     * change on its own.
     */
    function onSwipeDeleted(detail) {
        const live = ctx?.chat ?? [];
        const at = Number.isInteger(detail) ? detail : detail?.messageId;
        const message = live[Number.isInteger(at) ? at : live.length - 1];
        const deleted = Number.isInteger(detail?.swipeId) ? detail.swipeId : null;
        if (swipeLoading(message, deleted)) return;
        return onTimelineChanged('delete');
    }

    /** GENERATION_STOPPED: the reader stopped the reply being written (its last line may be unfinished). */
    function onGenerationStopped() {
        if (s.session) s.session.stopped = true;
        onGenerationEnded();
    }

    /** GENERATION_ENDED / GENERATION_STOPPED: a spent note never reaches a later prompt. */
    function onGenerationEnded() {
        if (s.session?.prompted) clearPrompts();
        s.deferred = false;
        markIdle();
        // A save that failed and was not made good after the reply (or the reply never came): again soon.
        if (store.dirty()) store.scheduleSave();
    }

    function install({ globalName = INTERCEPTOR_NAME } = {}) {
        for (const [key, place] of V1_KEYS) setPrompt(key, '', place);
        clearPrompts();
        if (globalName) globalThis[globalName] = interceptor;
        // A module turned ready or dormant: guarded blocks of its are asked again (store.lifecycleChanged).
        s.offModules?.();
        s.offModules = events?.on?.('modules', () => {
            if (store.lifecycleChanged?.()) events?.emit('head', { index: store.headIndex(), reason: 'module' });
        }) ?? null;
        const source = ctx?.eventSource;
        const names = ctx?.eventTypes ?? ctx?.event_types ?? {};
        const on = (event, fn) => {
            if (!event || typeof source?.on !== 'function') return;
            source.on(event, fn);
            s.listeners.push([event, fn]);
        };
        on(names.GENERATION_STARTED, onGenerationStarted);
        on(names.CHAT_COMPLETION_PROMPT_READY, onPromptReady);
        on(names.GENERATE_AFTER_COMBINE_PROMPTS, onTextPromptReady);
        on(names.MESSAGE_RECEIVED, onMessageReceived);
        on(names.GENERATION_ENDED, onGenerationEnded);
        on(names.GENERATION_STOPPED, onGenerationStopped);
        on(names.CHAT_CHANGED, onChatChanged);
        on(names.CHAT_RENAMED, onChatRenamed);
        // MESSAGE_EDITED too: a record's swipe mark follows an edit (persist.js restamp), so a Continue
        // after it still finds the record.
        for (const [event, reason] of [[names.MESSAGE_DELETED, 'delete'], [names.MESSAGE_SWIPED, 'swipe'], [names.CHARACTER_FIRST_MESSAGE_SELECTED, 'swipe'], [names.MESSAGE_EDITED, 'edit']]) on(event, () => onTimelineChanged(reason));
        on(names.MESSAGE_SWIPE_DELETED, onSwipeDeleted);
        return api;
    }

    function uninstall({ globalName = INTERCEPTOR_NAME } = {}) {
        s.offModules?.();
        s.offModules = null;
        const source = ctx?.eventSource;
        for (const [event, fn] of s.listeners) (source?.removeListener ?? source?.off)?.call(source, event, fn);
        s.listeners = [];
        if (globalName && globalThis[globalName] === interceptor) delete globalThis[globalName];
        clearPrompts();
        markIdle();
    }

    const api = {
        repairActions,
        repair,
        startOver,
        interceptor,
        install,
        uninstall,
        onGenerationStarted,
        onPromptReady,
        onTextPromptReady,
        onMessageReceived,
        onChatChanged,
        seed,
        onChatRenamed,
        onTimelineChanged,
        onGenerationEnded,
        reread,
        /** What the next ordinary reply would be sent, without changing anything (no cues run). */
        preview: () => build().parts,
        /**
         * The same with how it fits the context and what modules send on their own: { parts, fit, own }
         * (fit: prompt.js contextFit, or null; own: [{ module, label, place: 'own', text, tokens }]).
         */
        previewFit: () => {
            const built = build();
            return { parts: built.parts, fit: built.fit, own: built.own };
        },
        /** Adds { module?, code?, message, index?, line? } to the Problems list (and the console). */
        // (`toast`: told at once too, not only listed)
        report: entry => {
            const item = problem(entry);
            if (entry?.toast === true) { try { notify?.(item.message, item.module); } catch { /* a missing toastr is not an error */ } }
            return item;
        },
        /** The Problems list, oldest first; `moduleId` narrows it (null: the host's own). */
        problems: moduleId => s.problemLog.filter(item => moduleId === undefined || item.module === moduleId).map(item => ({ ...item })),
        clearProblems: () => { s.problemLog.length = 0; },
        /** Generations a canGenerate hook stopped: [{ moduleId, reason }], oldest first. */
        blocked: () => s.blocks.map(item => ({ ...item })),
        /**
         * Every module holding the story back now (each canGenerate asked, none logged):
         * Promise<[{ moduleId, name, reason, action, canOpen }]> (`action`: the module's button words, '' for
         * the host's own, false for no button; `canOpen`: it has an onBlocked hook to run).
         */
        blockers: () => askCanGenerate({ all: true }),
        /** Runs module `moduleId`'s onBlocked(reason, moduleId) hook (Home's button). → true when it ran. */
        unblock: (moduleId, reason = '') => runOnBlocked(moduleId, reason),
        /** The pending reply's session (for status and tests), or null. */
        session: () => (s.session ? { ...s.session } : null),
        /** Whether a reply is being built or awaited (its interceptor ran; not yet received, ended or stopped). */
        replyBusy: () => s.replyBusy,
        /** Resolves when no reply is in progress (at once when none is). */
        whenIdle,
    };
    return api;
}
