// Story Director v2, part **cast**: keeps the card of a reply that brought someone in where the reader can see it.
//
// SillyTavern scrolls the chat to the newest message when it lands; Story Block draws the reply's "This reply" card a moment later, under
// it, so a card under the newest reply can sit just below the visible chat until the next reply scrolls it into view. For a reply a person
// arrived in that hides the card that says who and why ("Paths crossed: ..."). So, when the reader was at the bottom of the chat as the
// reply landed, the chat is scrolled to the bottom again once the card is there (a few tries, never after the reader scrolls up).

const NEAR = 400;
const TRIES = 12;
const EVERY_MS = 350;

const chatOf = doc => { try { return doc?.querySelector?.('#chat') ?? null; } catch { return null; } };
const gap = chat => chat.scrollHeight - chat.scrollTop - chat.clientHeight;

/** Whether the chat is at (or near) its bottom now. */
export const atBottom = chat => Boolean(chat) && Number.isFinite(gap(chat)) && gap(chat) < NEAR;

/**
 * One look: the newest message's card is below the visible chat → scroll to the bottom. → 'none' (no card yet), 'seen' (it is in view)
 * or 'moved'.
 */
export function revealNewestCard(chat) {
    const messages = chat?.querySelectorAll?.('.mes') ?? [];
    const last = messages[messages.length - 1];
    const card = last?.querySelector?.('.ss-card');
    if (!card) return 'none';
    const at = card.getBoundingClientRect?.();
    const room = chat.getBoundingClientRect?.();
    if (!at || !room || !Number.isFinite(at.bottom) || !Number.isFinite(room.bottom)) return 'seen';
    if (at.bottom <= room.bottom + 1) return 'seen';
    chat.scrollTop = chat.scrollHeight;
    return 'moved';
}

/**
 * The follower for one page: `follow()` is called when a reply with a cast note lands. `deps` (tests): { doc, setTimeout, clearTimeout }.
 * Only a reader who was at the bottom is followed; a second reply while one is being followed starts over.
 */
export function createFollow({ doc = () => globalThis.document, timers = { setTimeout: (...args) => globalThis.setTimeout(...args), clearTimeout: id => globalThis.clearTimeout(id) } } = {}) {
    let timer = null;
    return function follow() {
        const chat = chatOf(doc());
        if (!atBottom(chat)) return false;
        if (timer !== null) timers.clearTimeout(timer);
        let tries = 0;
        const look = () => {
            timer = null;
            tries += 1;
            // The reader scrolled up meanwhile: leave them where they are.
            if (!atBottom(chat) && tries > 1) return;
            const seen = revealNewestCard(chat);
            if (seen === 'moved') tries = Math.max(tries, TRIES - 2);
            if (seen !== 'seen' && tries < TRIES) timer = timers.setTimeout(look, EVERY_MS);
        };
        timer = timers.setTimeout(look, EVERY_MS);
        return true;
    };
}
