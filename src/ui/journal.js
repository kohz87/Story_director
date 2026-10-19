// (0.9.19) The "Journal" tab in Story Block's sidebar: what {{user}}'s character saw and heard,
// day by day, newest first, for a reader coming back after a break.
//
// Like the Quests tab it is player-facing, so it is always shown in full: the builder
// (src/journal.js) has already left out everything behind the scenes. Each story day lists
// the places first visited, what happened, and the work taken on and how it ended; older days
// fold away under Earlier days. Everything arrives as parameters; this module only draws, and
// fills every node through textContent (the values are written by the model).

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

function el(tag, { className, text, attrs } = {}, children = []) {
    const node = globalThis.document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    for (const [name, value] of Object.entries(attrs ?? {})) node.setAttribute(name, value);
    for (const child of children) if (child) node.append(child);
    return node;
}

function icon(name) {
    return el('i', { className: `fa-solid ${name}`, attrs: { 'aria-hidden': 'true' } });
}

function sub(label, iconName, count = null) {
    return el('div', { className: 'story-director-sub' }, [
        icon(iconName),
        el('span', { text: label }),
        count === null ? null : el('span', { className: 'story-director-count', text: String(count) }),
    ]);
}

const text = value => String(value ?? '').trim();

// The Earlier days fold stays open across redraws once opened.
let earlierOpen = false;

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
    }
    for (const day of shown.slice(0, DAYS_SHOWN)) root.append(renderDay(day));
    if (shown.length > DAYS_SHOWN) root.append(renderEarlier(shown.slice(DAYS_SHOWN)));
    pane.replaceChildren(root);
}
