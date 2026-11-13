// The "Send pending" note: one Send press that SillyTavern could not take (its last reply still being made, or a fight start holding
// the Send). The typed text is never changed here. It goes once, by itself, when the story is free: at most one re-send per round,
// then "sent" for 2 s, then idle. A round still busy after 6 s stops waiting ("stalled"); a new press starts one more round. Changed or
// empty text, a cancel, or typing drops the round without sending. Pure logic: the page is injected (readText, isBusy, clickSend,
// fightHeld, openBoard) and so are the timers, so there is no DOM and no SillyTavern global here.
// States: idle | pending | sending | stalled | fightHeld | sent. `sending` (our click made, drawn as pending) becomes `sent` only when taken(); a press that goes straight through stays idle.

const LIVE = new Set(['pending', 'fightHeld']);
const defaultTimers = {
    setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
    clearTimeout: (h) => globalThis.clearTimeout(h),
};

export function createSendPending({
    readText = () => '', clickSend = () => {}, isBusy = () => false, fightHeld = () => false, openBoard = () => false,
    onChange = () => {}, timers = defaultTimers, pollMs = 250, stallMs = 6000, sentMs = 2000,
} = {}) {
    let state = 'idle', text = '';
    let stallTimer = null, pollTimer = null, sentTimer = null;
    const snapshot = () => ({ state, text });
    const set = (next) => { if (state === next) return; state = next; onChange(snapshot()); };
    const stop = (h) => { if (h !== null) timers.clearTimeout(h); };
    const clearAll = () => {
        stop(stallTimer); stop(pollTimer); stop(sentTimer);
        stallTimer = pollTimer = sentTimer = null;
    };
    const toIdle = () => { clearAll(); text = ''; set('idle'); };

    // Re-checks the round: text changed or empty drops it; a fight hold waits for the board; a busy story waits; free -> the one re-send.
    const tick = () => {
        if (!LIVE.has(state)) return;
        if (readText() !== text || !text.trim()) { toIdle(); return; }
        if (state === 'fightHeld') { if (!fightHeld()) toIdle(); return; }
        if (fightHeld()) { stop(stallTimer); stallTimer = null; set('fightHeld'); return; }
        if (isBusy()) return;
        // The one re-send of this round: the state moves to sending (shown like pending) before the click, so nothing can send it twice.
        // "sent" only comes from taken(), once SillyTavern really started on the message.
        stop(stallTimer); stop(pollTimer);
        stallTimer = pollTimer = null;
        set('sending');
        clickSend();
    };
    const poll = () => {
        pollTimer = timers.setTimeout(() => {
            pollTimer = null;
            tick();
            if (LIVE.has(state)) poll();
        }, pollMs);
    };
    const startRound = () => {
        clearAll();
        text = readText();
        set('pending');
        stallTimer = timers.setTimeout(() => {
            stallTimer = null;
            if (state !== 'pending') return;
            stop(pollTimer); pollTimer = null;
            set('stalled');
        }, stallMs);
        tick();
        if (LIVE.has(state)) poll();
    };

    return {
        // A Send press. Returns what happened: empty | waiting | pending | fightHeld | sent | passed. `ignored` says SillyTavern took no
        // notice of the click (the box still holds the text after the wait): the round starts, and re-sends at once when the story is free.
        press({ ignored = false } = {}) {
            const now = readText();
            if (!now.trim()) return 'empty';
            if (LIVE.has(state) || state === 'sending') return 'waiting';
            if (fightHeld() || isBusy() || state === 'stalled' || ignored) {
                startRound();
                return state === 'fightHeld' ? 'fightHeld' : state === 'pending' ? 'pending' : 'sent';
            }
            // Free and not held: SillyTavern's own send, once, with no note.
            clearAll(); text = '';
            set('idle');
            clickSend();
            return 'passed';
        },
        // SillyTavern started on the message (Generate entered or the box emptied): after our click this is "sent" for `sentMs`; a round
        // still waiting (the reader's own Enter got there first) just ends, with no click.
        taken() {
            if (state === 'sending') {
                clearAll();
                set('sent');
                sentTimer = timers.setTimeout(() => { sentTimer = null; toIdle(); }, sentMs);
                return true;
            }
            if (state === 'pending') { toIdle(); return true; }
            return false;
        },
        // The re-send was not taken (the text is still in the box and Generate was never entered): the note says
        // "Not sent yet" (stalled) and the reader can press Send again. The text is untouched.
        fail() {
            if (state !== 'sending') return false;
            clearAll();
            set('stalled');
            return true;
        },
        // ✕ on the note: leaves the text in the box and sends nothing.
        cancel() {
            if (state === 'idle') return false;
            toIdle();
            return true;
        },
        // Typing in the box clears the note (and a round, since its text no longer matches).
        typed() {
            if (state === 'idle') return false;
            toIdle();
            return true;
        },
        // The fight board's button, shown only while a fight start holds the Send.
        openBoard() {
            if (state !== 'fightHeld') return false;
            return openBoard() === true;
        },
        state: snapshot,
        dispose() { clearAll(); text = ''; state = 'idle'; },
    };
}
