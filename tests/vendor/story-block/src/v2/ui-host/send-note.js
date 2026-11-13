// The "Send pending" note (approved mockup: sendmock): a pill just above SillyTavern's message box that appears only when a Send would
// otherwise be lost, and never changes what the reader typed. It watches Send (a click on #send_but, or Enter in the box) without
// taking it over: SillyTavern always handles the press itself. Three things start a round (send-pending.js):
//   * the story is busy at the press (SillyTavern's Stop button is showing, or the story's own reply is still being finished);
//   * a fight start holds the Send (the Fight board's pause swallows it; the note offers "Open fight board");
//   * the press was free and reached SillyTavern, but it took no notice: the text is still in the box after `verifyMs` and Generate was never entered (no GENERATION_AFTER_COMMANDS / STARTED).
//     (A press another handler swallowed first, such as the "Make your character first" hold or a fight start's pause, never reaches the page's
//     bubble phase, so it is not re-sent: that handler owns it.)
// The one re-send is a click on #send_but when the story is free. UI only: no payload, no prompt, no chat data. Text is set with
// textContent; the icons are fixed paths. The setting "Send pending note" (host setting `sendPending`, on by default) turns it off.

import { createSendPending } from './send-pending.js';

const SVG = 'http://www.w3.org/2000/svg';
const CALM = 3;
const RETRIES = 2;
export const SEND_NOTE_TEXT = Object.freeze({
    label: 'Send status',
    pending: 'Sends when the story is ready',
    cancel: 'Cancel the pending send',
    stalled: 'Not sent yet: the story is still busy',
    again: 'Send again',
    dismiss: 'Dismiss',
    fightHeld: 'Your fight hasn\'t been sent yet',
    openBoard: 'Open fight board',
    sent: 'Sent',
});
// One path per state's icon (the mockup's own).
const ICONS = Object.freeze({
    pending: 'M12 3a9 9 0 1 1-9 9',
    fightHeld: 'M14.5 17.5L3 6V3h3l11.5 11.5M13 19l6-6M16 16l4 4M19 21l2-2',
    sent: 'M5 12.5l4.5 4.5L19 7.5',
});

function icon(doc, state) {
    const svg = doc.createElementNS(SVG, 'svg');
    for (const [name, value] of Object.entries({ width: '16', height: '16', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': state === 'fightHeld' ? '2' : '2.4', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(name, value);
    svg.setAttribute('class', `ss-send-note-icon ss-send-note-icon-${state}`);
    const path = doc.createElementNS(SVG, 'path');
    path.setAttribute('d', ICONS[state]);
    svg.appendChild(path);
    return svg;
}

/**
 * createSendNote({ doc, ctx, enabled, busy, held, openBoard, verifyMs, timers }) → { state(), destroy() }.
 * `enabled()` the setting; `busy()` the story's own busy flag (SillyTavern's Stop button is read here); `held()` a fight start holds
 * the Send; `openBoard()` opens the fight board. `ctx` gives the event source (GENERATION_STARTED) the verify step listens to.
 */
export function createSendNote({ doc, ctx = null, enabled = () => true, busy = () => false, held = () => false, openBoard = () => false, verifyMs = 1500, timers } = {}) {
    const view = doc.defaultView ?? null;
    const box = () => doc.getElementById?.('send_textarea') ?? null;
    const read = () => String(box()?.value ?? '');
    const stopShown = () => {
        const stop = doc.getElementById?.('mes_stop');
        if (!stop) return false;
        return (view?.getComputedStyle ? view.getComputedStyle(stop).display : stop.style?.display) !== 'none' && stop.style?.display !== 'none' && stop.hidden !== true;
    };
    let root = null, started = false, reached = false, verify = null, resending = false, retries = 0;
    const clock = timers ?? { setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms), clearTimeout: h => globalThis.clearTimeout(h) };
    // SillyTavern hides its Stop button a little before it takes a Send again (the last reply's listeners still run), so the story counts as
    // free only after `CALM` polls in a row with nothing busy; a Send clicked in that gap would be ignored.
    let quiet = 0;
    let flying = false, flightTimer = null;
    const land = () => { flying = false; if (flightTimer !== null) clock.clearTimeout(flightTimer); flightTimer = null; };
    const takeoff = () => { land(); flying = true; flightTimer = clock.setTimeout(() => { flightTimer = null; flying = false; }, verifyMs); };
    const rawBusy = () => stopShown() || busy() === true;
    const calm = () => { quiet = rawBusy() ? 0 : quiet + 1; return quiet < CALM; };
    const sp = createSendPending({
        readText: read,
        // The note's own click goes through this page's listeners too: `resending` keeps it from counting as a new press.
        clickSend: () => { resending = true; try { doc.getElementById?.('send_but')?.click?.(); } finally { resending = false; } },
        // One guard for every path: a Send already on its way (the reader's Enter or click, not yet started) counts as busy.
        isBusy: () => { if (flying) { quiet = 0; return true; } return calm(); },
        fightHeld: () => held() === true,
        openBoard: () => openBoard() === true,
        onChange: ({ state }) => { if (state === 'idle') retries = 0; draw(state); if (state === 'sending') checkTaken(); },
        timers: clock,
    });

    const button = (label, aria, solid, act) => {
        const b = doc.createElement('button');
        b.type = 'button';
        b.className = `ss-send-note-btn${solid ? ' ss-send-note-btn-solid' : ''}`;
        b.textContent = label;
        if (aria) b.setAttribute('aria-label', aria);
        b.addEventListener('click', event => { event.preventDefault(); act(); });
        return b;
    };
    function draw(shown) {
        const state = shown === 'sending' ? 'pending' : shown;
        if (state === 'idle' || !enabled()) { root?.remove(); root = null; return; }
        const anchor = doc.getElementById?.('send_form');
        if (!anchor?.parentNode) return;
        if (!root) {
            root = doc.createElement('div');
            root.className = 'ss-send-note';
        }
        const pill = doc.createElement('div');
        pill.className = `ss-send-note-pill ss-send-note-${state}`;
        pill.setAttribute('role', 'status');
        pill.setAttribute('aria-label', SEND_NOTE_TEXT.label);
        const text = doc.createElement('span');
        text.className = 'ss-send-note-text';
        text.textContent = SEND_NOTE_TEXT[state];
        if (ICONS[state]) pill.appendChild(icon(doc, state));
        pill.appendChild(text);
        if (state === 'pending') pill.appendChild(button('✕', SEND_NOTE_TEXT.cancel, false, () => sp.cancel()));
        if (state === 'stalled') pill.append(button(SEND_NOTE_TEXT.again, '', true, () => { retries = 0; sp.press(); }), button('✕', SEND_NOTE_TEXT.dismiss, false, () => sp.cancel()));
        if (state === 'fightHeld') pill.appendChild(button(SEND_NOTE_TEXT.openBoard, '', true, () => sp.openBoard()));
        root.replaceChildren(pill);
        root.setAttribute('data-state', state);
        if (root.parentNode !== anchor.parentNode || root.nextElementSibling !== anchor) anchor.parentNode.insertBefore(root, anchor);
    }

    // After our click the note stays "pending" until SillyTavern really took it (Generate entered, via onStart, or the box emptied). If
    // neither happens in `verifyMs` the text still in the box means it was ignored too.
    function checkTaken() {
        const text = read();
        started = false;
        stopVerify();
        verify = clock.setTimeout(() => {
            verify = null;
            if (sp.state().state !== 'sending') return;
            if (started) { sp.taken(); return; }
            if (!read().trim()) { sp.cancel(); return; }
            if (read() !== text) { sp.cancel(); return; }
            if (!sp.fail()) return;
            // Not taken (SillyTavern was still closing the last reply): the same text goes again, at most RETRIES more times, then the note waits for the reader.
            if (retries < RETRIES) { retries += 1; quiet = 0; sp.press(); }
        }, verifyMs);
    }
    const stopVerify = () => { if (verify !== null) clock.clearTimeout(verify); verify = null; };
    // A Send press (capture phase, before SillyTavern's own handler). Busy or held: SillyTavern will ignore it, so a round starts now.
    // Free: SillyTavern should take it; if the text is still there after `verifyMs` and nothing began, it was ignored.
    const pressed = () => {
        if (!enabled() || resending) return;
        const text = read();
        if (!text.trim()) return;
        stopVerify();
        // Free and not held: SillyTavern takes this press itself, so no click of ours may start another Generate meanwhile.
        if (held() !== true && !rawBusy()) takeoff();
        if (held() === true || rawBusy() || sp.state().state !== 'idle') { quiet = 0; sp.press(); return; }
        started = false; reached = false;
        verify = clock.setTimeout(() => {
            verify = null;
            if (reached && !started && read() === text && !stopShown()) { quiet = 0; sp.press({ ignored: true }); }
        }, verifyMs);
    };
    const onClick = event => { if (event.target?.closest?.('#send_but')) pressed(); };
    const onKey = event => {
        if (event.key !== 'Enter' || event.shiftKey || event.altKey || event.isComposing || doc.activeElement !== box()) return;
        let sends = true;
        try { sends = globalThis.SillyTavern?.getContext?.()?.shouldSendOnEnter?.() !== false; } catch { /* the usual Enter action */ }
        if (sends) pressed();
    };
    // Typing clears the note. SillyTavern's own emptying of the box when it takes a Send also fires "input": that must not end "Sent".
    // Only the message box counts (not the fight board, a search field or settings); a box emptied during "sending" is SillyTavern taking it.
    const onInput = event => {
        if (event?.target?.id !== 'send_textarea') return;
        const now = sp.state().state;
        if (now === 'sent') return;
        if (now === 'sending' && !read().trim()) { if (started) sp.taken(); else sp.cancel(); return; }
        sp.typed();
    };
    // The bubble phase: reached only when nothing earlier stopped the press. SillyTavern's own Enter handler runs first and calls
    // preventDefault on every Enter it sends, so for keydown reaching this phase is enough; a click must also be undefaulted.
    const onBubble = event => { if (event.type === 'keydown' ? event.key === 'Enter' && doc.activeElement === box() : !event.defaultPrevented && event.target?.closest?.('#send_but')) reached = true; };
    const target = view ?? doc;
    target.addEventListener?.('click', onClick, true);
    target.addEventListener?.('keydown', onKey, true);
    doc.addEventListener?.('input', onInput, true);
    doc.addEventListener?.('click', onBubble, false);
    doc.addEventListener?.('keydown', onBubble, false);
    const types = ctx?.eventTypes ?? ctx?.event_types ?? {};
    // (type, params, dryRun): only the real user-message Generate is a Send being taken. SillyTavern's dry run (it counts the prompt's tokens about 1 s
    // after every reply on Chat Completion), quiet and background calls (Summarize, expressions), extension calls, and regenerate / swipe / continue /
    // impersonate (they never take the box text) must leave a waiting or sending round alone.
    const isSend = (type, params, dryRun) => dryRun !== true && (type === undefined || type === null || type === '' || type === 'normal')
        && !params?.quiet_prompt && !params?.automatic_trigger && !params?.quietToLoud;
    const onStart = (type, params, dryRun) => { if (!isSend(type, params, dryRun)) return; started = true; land(); sp.taken(); };
    // Generate was entered (AFTER_COMMANDS comes first, before any interceptor can hold the reply back; STARTED follows).
    const starts = [types.GENERATION_AFTER_COMMANDS, types.GENERATION_STARTED].filter(Boolean);
    for (const name of starts) ctx?.eventSource?.on?.(name, onStart);
    return {
        state: () => sp.state(),
        destroy() {
            stopVerify(); land(); sp.dispose(); root?.remove(); root = null;
            target.removeEventListener?.('click', onClick, true);
            target.removeEventListener?.('keydown', onKey, true);
            doc.removeEventListener?.('input', onInput, true);
            doc.removeEventListener?.('click', onBubble, false);
            doc.removeEventListener?.('keydown', onBubble, false);
            for (const name of starts) ctx?.eventSource?.removeListener?.(name, onStart);
        },
    };
}
