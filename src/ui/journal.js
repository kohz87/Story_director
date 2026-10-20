// (0.9.19) The "Journal" tab in Story Block's sidebar: what {{user}}'s character saw and heard,
// day by day, newest first, for a reader coming back after a break.
//
// Like the Quests tab it is player-facing, so it is always shown in full: the builder
// (src/journal.js) has already left out everything behind the scenes. Each story day lists
// the places first visited, what happened, and the work taken on and how it ended; older days
// fold away under Earlier days. (0.9.39) Past SEARCH_AFTER entries a search box filters them as
// you type. Everything arrives as parameters; this module only draws, and fills every node
// through textContent (the values are written by the model).

import { el, icon, sub } from './dom.js';

// The most recent days drawn open; the rest fold away.
const DAYS_SHOWN = 7;
// The quiet word after the key, and its icon, by what the item is.
const LOOK = {
    'place:visited': { tag: 'first visit', icon: 'fa-location-dot' },
    'event:fired': { tag: '', icon: 'fa-bolt' },
    'event:closed': { tag: 'ended', icon: 'fa-circle-check' },
    'event:sign': { tag: 'a sign', icon: 'fa-eye' },
    'quest:taken': { tag: 'quest taken on', icon: 'fa-scroll' },
    'quest:progress': { tag: 'quest', icon: 'fa-arrow-right' },
    'quest:done': { tag: 'quest done', icon: 'fa-circle-check' },
    'quest:failed': { tag: 'quest failed', icon: 'fa-circle-xmark' },
    'quest:abandoned': { tag: 'quest abandoned', icon: 'fa-flag' },
};
const FALLBACK = { tag: '', icon: 'fa-feather' };

const text = value => String(value ?? '').trim();

// The Earlier days fold stays open across redraws once opened.
let earlierOpen = false;
// (0.9.39) The search box shows once the journal holds more entries than this; what was typed
// stays across redraws (a new reply redraws the tab).
const SEARCH_AFTER = 15;
let query = '';

// Case and accents do not matter: "Hollis" finds "hollis", "cafe" finds "café".
const fold = value => String(value ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** Whether `item` (on `day`) holds every word of `wanted` in its key, text, giver or date. */
export function journalMatches(item, day, wanted) {
    const words = fold(wanted).split(/\s+/).filter(Boolean);
    if (!words.length) return true;
    const hay = fold([item?.key, item?.text, item?.giver, day?.label].filter(Boolean).join(' '));
    return words.every(word => hay.includes(word));
}

function renderItem(item) {
    const look = LOOK[`${item.type}:${item.how}`] ?? FALLBACK;
    const node = el('li', { className: `story-director-record is-journal-item is-${item.type} is-${item.how}` });
    node.append(el('div', { className: 'story-director-record-head' }, [
        el('span', { className: 'story-director-journal-icon' }, [icon(look.icon)]),
        el('span', { className: 'story-director-record-key', text: item.key }),
        look.tag ? el('span', { className: 'story-director-tag', text: look.tag }) : null,
    ]));
    const said = text(item.text);
    if (said) node.append(el('div', { className: 'story-director-journal-text', text: said }));
    const giver = text(item.giver);
    if (giver) {
        node.append(el('div', { className: 'story-director-quest-meta' }, [
            el('span', { className: 'story-director-quest-meta-part is-giver', attrs: { title: 'giver' } }, [icon('fa-user'), el('span', { text: giver })]),
        ]));
    }
    return node;
}

function renderDay(day) {
    return el('section', { className: `story-director-section is-journal-day${day.key === 'undated' ? ' is-undated' : ''}` }, [
        sub(day.label, day.key === 'undated' ? 'fa-feather' : 'fa-calendar-day', day.items.length),
        el('ul', { className: 'story-director-records' }, day.items.map(renderItem)),
    ]);
}

function renderEarlier(days) {
    const count = days.reduce((sum, day) => sum + day.items.length, 0);
    const details = el('details', { className: 'story-director-fold is-journal-earlier' }, [
        el('summary', { className: 'story-director-fold-summary' }, [sub('Earlier days', 'fa-clock-rotate-left', count)]),
        el('div', { className: 'story-director-fold-body' }, days.map(renderDay)),
    ]);
    if (earlierOpen) details.open = true;
    details.addEventListener('toggle', () => { earlierOpen = Boolean(details.open); });
    return details;
}

/**
 * Draws the Journal tab into `pane` from `buildJournal`'s `{ days }`: each day a section,
 * newest first, the oldest past the first few folded under Earlier days; an empty journal
 * says what will land here.
 */
export function renderJournal(pane, { days = [] } = {}) {
    const root = el('div', { className: 'story-director-tab story-director-journal' });
    const shown = days.filter(day => day?.items?.length);
    if (!shown.length) {
        root.append(el('div', { className: 'story-director-empty' }, [
            el('p', { className: 'story-director-empty-text', text: 'Nothing recorded yet…' }),
            el('p', { className: 'story-director-empty-hint', text: 'What your character sees and hears lands here, day by day: what happened, the work taken on and how it ended, the places visited. What the story has only planned stays out.' }),
        ]));
        pane.replaceChildren(root);
        return;
    }
    const total = shown.reduce((sum, day) => sum + day.items.length, 0);
    const find = total > SEARCH_AFTER ? searchRow(root, shown, total) : null;
    if (find) root.append(find);
    else query = '';
    drawDays(root, shown, total);
    pane.replaceChildren(root);
}

// (0.9.39) The days after the search line, or with something typed only the entries that
// match, every matching day open.
function drawDays(root, shown, total) {
    const find = root.querySelector('.story-director-journal-find');
    const count = find?.querySelector('.story-director-journal-count') ?? null;
    let nodes;
    if (!query.trim()) {
        nodes = [...shown.slice(0, DAYS_SHOWN).map(renderDay), ...(shown.length > DAYS_SHOWN ? [renderEarlier(shown.slice(DAYS_SHOWN))] : [])];
        if (count) count.textContent = '';
    } else {
        const days = shown.map(day => ({ ...day, items: day.items.filter(item => journalMatches(item, day, query)) })).filter(day => day.items.length);
        const found = days.reduce((sum, day) => sum + day.items.length, 0);
        if (count) count.textContent = `${found} of ${total}`;
        nodes = days.length
            ? days.map(renderDay)
            : [el('p', { className: 'story-director-empty-hint is-journal-none', text: `Nothing in the journal matches “${query.trim()}”.` })];
    }
    // The search box stays where it is (re-inserting it would take its focus mid-typing).
    for (const child of [...root.childNodes]) if (child !== find) child.remove();
    root.append(...nodes);
}

function searchRow(root, shown, total) {
    const input = el('input', { className: 'text_pole story-director-journal-search', attrs: { type: 'search', placeholder: 'Search the journal', 'aria-label': 'Search the journal', autocomplete: 'off', spellcheck: 'false' } });
    input.value = query;
    const count = el('span', { className: 'story-director-journal-count', attrs: { 'aria-live': 'polite' } });
    input.addEventListener('input', () => {
        query = input.value;
        drawDays(root, shown, total);
    });
    input.addEventListener('keydown', event => {
        if (event.key !== 'Escape' || !input.value) return;
        // Esc clears the search first; a second Esc is the sidebar's.
        event.stopPropagation();
        input.value = '';
        query = '';
        drawDays(root, shown, total);
    });
    return el('div', { className: 'story-director-journal-find' }, [icon('fa-magnifying-glass'), input, count]);
}
