// The "Quests" tab in Story Block's sidebar: the work {{user}} has taken on.
//
// Quests are promises the reader's character made, so unlike the Director tab nothing here
// is behind the scenes: it is always shown in full. Active quests are grouped by their type
// (main, side, bounty, contract…), each with its goal, step, giver, reward and deadline, and
// its difficulty when it is not normal; a deadline that has passed or is close is marked. Finished quests fold away
// underneath. A quest closes when the story closes it; the reader's one decision here is to
// Abandon one (0.9.5, asked twice): (0.9.15) it is given up with the next reply, told behind
// the scenes; until then the flag reads Keep, and deleting that reply takes it back. Jobs only offered (0.9.15)
// fold away under Offered; (0.9.33) each with Take on and Turn down, made the same way: the
// choice goes with the next reply, which tells it, and until then it reads Undo. Saying it in
// the story still works too.
// Everything arrives as parameters; this module only draws, and fills every node through
// textContent (the values are written by the model).

import { questDifficulty } from '../changes.js';
import { el, icon, sub } from './dom.js';

const TYPE_ORDER = ['main', 'side', 'bounty', 'contract', 'mission', 'favour'];
const TYPE_LABELS = { main: 'Main', side: 'Side', bounty: 'Bounties', contract: 'Contracts', mission: 'Missions', favour: 'Favours' };
// The quiet line under the goal and step, in this order.
const META = {
    giver: { label: 'giver', icon: 'fa-user' },
    reward: { label: 'reward', icon: 'fa-coins' },
    due: { label: 'deadline', icon: 'fa-hourglass-half' },
    place: { label: 'place', icon: 'fa-location-dot' },
};
const FINISHED_SHOWN = 20;

const text = value => String(value ?? '').trim();
// "Bounties" and "bounty" are one group; "quest" says nothing beyond being a quest.
const TYPE_SPELLINGS = { bounties: 'bounty', contracts: 'contract', missions: 'mission', favours: 'favour', favors: 'favour', favor: 'favour', quest: '', quests: '' };
function typeKey(record) {
    const type = text(record?.fields?.type).toLowerCase().replace(/\s+/g, ' ');
    return Object.hasOwn(TYPE_SPELLINGS, type) ? TYPE_SPELLINGS[type] : type;
}

// The Finished and Offered folds stay open across redraws once opened.
let finishedOpen = false;
let offeredOpen = false;
// The quest whose Abandon asks again.
let abandonArmed = null;
let lastArgs = null;

// Here the title is only a tooltip: the visible label stays each button's accessible name.
function button(label, className, { iconName, title, onClick } = {}) {
    const node = el('button', { className: `menu_button ${className}`, attrs: title ? { title } : {} });
    node.type = 'button';
    if (iconName) node.append(icon(iconName));
    if (label) node.append(el('span', { text: label }));
    if (onClick) node.addEventListener('click', onClick);
    return node;
}

function typeLabel(type) {
    if (!type) return 'Quests';
    return TYPE_LABELS[type] ?? type.replace(/^./, first => first.toUpperCase());
}

// Groups in a fixed order for the known types, then the rest by name, untyped last.
function groups(quests) {
    const byType = new Map();
    for (const quest of quests) {
        const type = typeKey(quest);
        if (!byType.has(type)) byType.set(type, []);
        byType.get(type).push(quest);
    }
    const rank = type => {
        if (!type) return [2, ''];
        const known = TYPE_ORDER.indexOf(type);
        return known >= 0 ? [0, String(known).padStart(2, '0')] : [1, type];
    };
    return [...byType.entries()].sort(([a], [b]) => {
        const [ra, ka] = rank(a);
        const [rb, kb] = rank(b);
        return ra - rb || ka.localeCompare(kb);
    });
}

// Normal says nothing a quest without the tag would not, so only the others are shown (0.9.11).
function difficultyTag(record) {
    const difficulty = questDifficulty(record.fields?.difficulty);
    if (difficulty === 'normal') return null;
    return el('span', { className: `story-director-tag is-difficulty is-${difficulty}`, text: difficulty, attrs: { title: 'difficulty' } });
}

// A quiet flag at the end of the key line; a click asks again, in words, before it writes.
function abandonButton(record, onAbandon, { pending = false, onKeep = null } = {}) {
    if (typeof onAbandon !== 'function') return null;
    // (0.9.15) Given up with the next reply: one click keeps it.
    if (pending) {
        return button('Keep', 'story-director-quest-keep', {
            iconName: 'fa-rotate-left',
            title: `${record.key} is given up with your next reply. Click to keep it.`,
            onClick: () => onKeep?.(record.id),
        });
    }
    const armed = abandonArmed === record.id;
    return button(armed ? 'Abandon?' : '', `story-director-quest-abandon${armed ? ' is-armed' : ''}`, {
        iconName: 'fa-flag',
        title: armed
            ? `Click again to give up ${record.key} (no quest XP).`
            : `Abandon ${record.key}: your character gives it up in the next reply (no quest XP). Delete that reply to take it back.`,
        onClick: () => {
            if (!armed) {
                abandonArmed = record.id;
                if (lastArgs) renderQuests(...lastArgs);
                return;
            }
            abandonArmed = null;
            onAbandon(record.id);
        },
    });
}

function metaPart(field, value) {
    return el('span', { className: `story-director-quest-meta-part is-${field}`, attrs: { title: META[field].label } }, [
        icon(META[field].icon),
        el('span', { text: value }),
    ]);
}

/*
 * (0.9.11) A card reads top to bottom as what matters first: the goal (or the description
 * when there is no goal), the next step, then who, what for, by when and where on one quiet
 * line, and a longer description last, cut to two lines until it is clicked.
 */
function renderQuest(record, { formatDate, status, onAbandon, abandoning = null, onKeep = null }) {
    const state = status?.(record) ?? '';
    const pending = Boolean(abandoning?.has?.(record.id));
    const item = el('li', { className: `story-director-record is-quest${state ? ` is-${state}` : ''}` });
    item.dataset.recordId = record.id;
    item.append(el('div', { className: 'story-director-record-head' }, [
        el('span', { className: 'story-director-record-key', text: record.key }),
        difficultyTag(record),
        state === 'overdue' ? el('span', { className: 'story-director-tag is-overdue', text: 'deadline passed' }) : null,
        state === 'soon' ? el('span', { className: 'story-director-tag is-soon', text: 'deadline soon' }) : null,
        state === 'pay' ? el('span', { className: 'story-director-tag is-pay', text: 'pay waiting', attrs: { title: 'The work is done; only the pay is left to collect.' } }) : null,
        pending ? el('span', { className: 'story-director-tag is-giving-up', text: 'giving up' }) : null,
        abandonButton(record, onAbandon, { pending, onKeep }),
    ]));
    const goal = text(record.fields?.goal);
    const desc = text(record.fields?.desc);
    const lead = goal || desc;
    if (lead) item.append(el('div', { className: 'story-director-quest-goal', text: lead }));
    const step = text(record.fields?.step);
    if (step) {
        item.append(el('div', { className: 'story-director-quest-step', attrs: { title: 'next step' } }, [
            icon('fa-arrow-right'),
            el('span', { text: step }),
        ]));
    }
    const parts = [];
    for (const field of Object.keys(META)) {
        let value = text(record.fields?.[field]);
        if (!value) continue;
        if (field === 'due' && typeof formatDate === 'function') {
            try {
                value = String(formatDate(value, { record, field }) || value);
            } catch {
                // The date as written.
            }
        }
        parts.push(metaPart(field, value));
    }
    if (parts.length) item.append(el('div', { className: 'story-director-quest-meta' }, parts));
    if (goal && desc && desc !== goal) {
        const more = el('div', { className: 'story-director-quest-desc', text: desc, attrs: { title: 'Click to show it all' } });
        more.addEventListener('click', () => more.classList.toggle('is-open'));
        item.append(more);
    }
    return item;
}

/**
 * (0.9.15) Jobs offered and not taken on: the same card as a quest (goal, giver, reward,
 * deadline), no Abandon and no difficulty, folded. Saying yes or no is the story's business.
 */
// (0.9.35) Offers whose Take on asked "take it anyway?" (the giver not in the scene): the
// question stays until it is answered or the tab is drawn for another chat.
const confirming = new Set();

// (0.9.33) Take on / Turn down under an offer, or, once chosen, what goes with the next reply and Undo.
// (0.9.37) `presence(record)`: { here, badge, ask } (where it was offered, or its giver), null
// when nothing tells. Take on is always there; while not here it asks once, inline, before it takes.
function offerActions(record, { choosing = null, onTake = null, onDecline = null, onUndo = null, presence = null } = {}) {
    if (typeof onTake !== 'function' && typeof onDecline !== 'function') return null;
    const taking = choosing?.take?.has?.(record.id);
    const declining = choosing?.decline?.has?.(record.id);
    if (taking || declining) {
        confirming.delete(record.id);
        return el('div', { className: 'story-director-offer-actions is-chosen' }, [
            el('span', { className: `story-director-tag ${taking ? 'is-taking' : 'is-turning-down'}`, text: taking ? 'taken on with your next reply' : 'turned down with your next reply' }),
            button('Undo', 'story-director-offer-undo', { iconName: 'fa-rotate-left', title: 'Change your mind before the next reply.', onClick: () => onUndo?.(record.id) }),
        ]);
    }
    const where = typeof presence === 'function' ? presence(record) : null;
    const redraw = () => { if (lastArgs) renderQuests(...lastArgs); };
    const take = () => {
        confirming.delete(record.id);
        onTake?.(record.id);
    };
    if (confirming.has(record.id) && where && !where.here) {
        return el('div', { className: 'story-director-offer-actions is-confirming' }, [
            el('span', { className: 'story-director-offer-ask', text: where.ask }),
            button('Take on', 'story-director-offer-take is-confirm', { iconName: 'fa-check', onClick: take }),
            button('Cancel', 'story-director-offer-cancel', { onClick: () => { confirming.delete(record.id); redraw(); } }),
        ]);
    }
    return el('div', { className: 'story-director-offer-actions' }, [
        button('Take on', 'story-director-offer-take', {
            iconName: 'fa-check',
            title: `Take on ${record.key}: your next reply tells it, and it becomes your quest.`,
            onClick: () => {
                if (where && !where.here) {
                    confirming.add(record.id);
                    redraw();
                    return;
                }
                take();
            },
        }),
        button('Turn down', 'story-director-offer-decline', { iconName: 'fa-xmark', title: `Turn down ${record.key}: your next reply tells it.`, onClick: () => onDecline?.(record.id) }),
    ]);
}

function renderOffered(offered, { formatDate, status, choosing = null, onTake = null, onDecline = null, onUndo = null, presence = null }) {
    const buttons = typeof onTake === 'function' || typeof onDecline === 'function';
    const body = el('div', { className: 'story-director-fold-body' }, [
        el('p', { className: 'story-director-empty-hint', text: buttons ? 'Take one on or turn it down here, or say so in the story.' : 'Offered, not taken on. Say in the story that your character takes one on, or turns it down.' }),
        el('ul', { className: 'story-director-records' }, offered.map(record => {
            const item = renderQuest(record, { formatDate, status, onAbandon: null });
            item.classList.add('is-offered');
            item.querySelector('.story-director-tag.is-difficulty')?.remove();
            // (0.9.35) Whether the giver is in the scene, as a badge on the card.
            // (0.9.37) Where it was offered, or its giver: "Bluewatch Village · here" / "offered in Bluewatch Village".
            const where = typeof presence === 'function' ? presence(record) : null;
            if (where) {
                item.querySelector('.story-director-record-head')?.append(el('span', {
                    className: `story-director-tag is-giver ${where.here ? 'is-here' : 'is-away'}`,
                    text: where.badge,
                    attrs: { title: where.here ? 'You can take it on here.' : 'Take on asks first: you are not where it was offered.' },
                }));
            }
            const actions = offerActions(record, { choosing, onTake, onDecline, onUndo, presence });
            if (actions) item.append(actions);
            return item;
        })),
    ]);
    // A choice waiting for the next reply keeps the fold open, so it stays in sight.
    if (choosing?.take?.size || choosing?.decline?.size) offeredOpen = true;
    const details = el('details', { className: 'story-director-fold is-offered' }, [
        el('summary', { className: 'story-director-fold-summary' }, [sub('Offered', 'fa-hand-holding', offered.length)]),
        body,
    ]);
    if (offeredOpen) details.open = true;
    details.addEventListener('toggle', () => { offeredOpen = Boolean(details.open); });
    return details;
}

function renderFinished(finished) {
    const shown = finished.slice(0, FINISHED_SHOWN);
    const body = el('div', { className: 'story-director-fold-body' }, [
        el('ul', { className: 'story-director-records' }, shown.map(record => {
            const outcome = record.status === 'superseded' ? 'superseded' : text(record.resolved?.reason) || 'done';
            return el('li', { className: 'story-director-record is-quest is-finished' }, [
                el('div', { className: 'story-director-record-head' }, [
                    el('span', { className: 'story-director-record-key', text: record.key }),
                    el('span', { className: 'story-director-tag', text: outcome }),
                ]),
            ]);
        })),
    ]);
    const details = el('details', { className: 'story-director-fold is-finished' }, [
        el('summary', { className: 'story-director-fold-summary' }, [sub('Finished', 'fa-circle-check', finished.length)]),
        body,
    ]);
    if (finishedOpen) details.open = true;
    details.addEventListener('toggle', () => { finishedOpen = Boolean(details.open); });
    return details;
}

/**
 * (0.9.39) The offers the tab shows, so its badge counts the same ones: those still open, and
 * one past its deadline only while the reader has spoken of it (lapses.js gives it a grace).
 */
export function offersShown(offered, status = null) {
    return (offered ?? []).filter(record => record?.engaged || typeof status !== 'function' || status(record) !== 'overdue');
}

/**
 * Draws the Quests tab into `pane`. `quests`: active quest records; `finished`: resolved
 * ones, most recent first; `offered`: jobs not taken on yet (0.9.15), folded under Offered;
 * `status(record)` → 'overdue' | 'soon' | 'pay' | '' marks deadlines ('pay': only the pay is left);
 * `onAbandon(id)` when the reader gives one up (no button without it); (0.9.33) `onTake(id)`,
 * `onDecline(id)` and `onUndo(id)` for an offer, `choosing`: { take, decline } (Sets of ids)
 * chosen for the next reply; (0.9.37) `presence(record)`: { here, badge, ask } for an offer (the
 * badge; Take on asks `ask` first while not here), null when nothing tells.
 */
export function renderQuests(pane, { quests = [], finished = [], offered = [], formatDate = null, status = null, abandoning = null, onAbandon = null, onKeep = null, choosing = null, onTake = null, onDecline = null, onUndo = null, presence = null } = {}) {
    lastArgs = [pane, { quests, finished, offered, formatDate, status, abandoning, onAbandon, onKeep, choosing, onTake, onDecline, onUndo, presence }];
    const root = el('div', { className: 'story-director-tab story-director-quests' });
    if (!quests.length && offered.length) {
        // (0.9.35) Not "no open quests" above a list of offers: say where they are.
        root.append(el('div', { className: 'story-director-empty' }, [
            el('p', { className: 'story-director-empty-text', text: `No quests yet — ${offered.length} ${offered.length === 1 ? 'offer' : 'offers'} below.` }),
        ]));
    } else if (!quests.length) {
        root.append(el('div', { className: 'story-director-empty' }, [
            el('p', { className: 'story-director-empty-text', text: 'No open quests.' }),
            el('p', { className: 'story-director-empty-hint', text: 'A quest starts when your character accepts one: a bounty, a contract, a favour owed. The story writes it as "+ quest …" and it stays here until it is done.' }),
        ]));
    }
    for (const [type, list] of groups(quests)) {
        root.append(el('section', { className: `story-director-section is-quest-group${type ? ` is-${type}` : ''}` }, [
            sub(typeLabel(type), type === 'bounty' ? 'fa-coins' : type === 'main' ? 'fa-crown' : 'fa-scroll', list.length),
            el('ul', { className: 'story-director-records' }, list.map(record => renderQuest(record, { formatDate, status, onAbandon, abandoning, onKeep }))),
        ]));
    }
    if (offered.length) root.append(renderOffered(offered, { formatDate, status, choosing, onTake, onDecline, onUndo, presence }));
    if (finished.length) root.append(renderFinished(finished));
    pane.replaceChildren(root);
}
