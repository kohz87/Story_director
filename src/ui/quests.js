// The "Quests" tab in Story Block's sidebar: the work {{user}} has taken on.
//
// Quests are promises the reader's character made, so unlike the Director tab nothing here
// is behind the scenes: it is always shown in full. Active quests are grouped by their type
// (main, side, bounty, contract…), each with its difficulty, goal, step, giver, reward and
// deadline; a deadline that has passed or is close is marked. Finished quests fold away
// underneath. Each open quest has Done and Failed (0.9.1): asked twice, then the glue writes
// the `-` line into the latest reply, so deleting or swiping that reply opens it again.
// Everything arrives as parameters; this module only draws, and fills every node through
// textContent (the values are written by the model).

import { questDifficulty } from '../changes.js';

const TYPE_ORDER = ['main', 'side', 'bounty', 'contract', 'mission', 'favour'];
const TYPE_LABELS = { main: 'Main', side: 'Side', bounty: 'Bounties', contract: 'Contracts', mission: 'Missions', favour: 'Favours' };
const ROWS = ['goal', 'step', 'giver', 'reward', 'due', 'place'];
const ROW_LABELS = { due: 'deadline' };
const FINISHED_SHOWN = 20;

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
// "Bounties" and "bounty" are one group; "quest" says nothing beyond being a quest.
const TYPE_SPELLINGS = { bounties: 'bounty', contracts: 'contract', missions: 'mission', favours: 'favour', favors: 'favour', favor: 'favour', quest: '', quests: '' };
function typeKey(record) {
    const type = text(record?.fields?.type).toLowerCase().replace(/\s+/g, ' ');
    return Object.hasOwn(TYPE_SPELLINGS, type) ? TYPE_SPELLINGS[type] : type;
}

// The Finished fold stays open across redraws once opened.
let finishedOpen = false;
// The quest and outcome whose button asks again: "id|done" or "id|failed".
let finishArmed = null;
let lastArgs = null;

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

function difficultyTag(record) {
    const difficulty = questDifficulty(record.fields?.difficulty);
    return el('span', { className: `story-director-tag is-difficulty is-${difficulty}`, text: difficulty, attrs: { title: 'difficulty' } });
}

function finishButtons(record, onFinish) {
    if (typeof onFinish !== 'function') return null;
    const one = (outcome, label, iconName, title) => {
        const key = `${record.id}|${outcome}`;
        const armed = finishArmed === key;
        return button(armed ? `${label}? Click again` : label, `story-director-quest-${outcome}${armed ? ' is-armed' : ''}`, {
            iconName,
            title,
            onClick: () => {
                if (!armed) {
                    finishArmed = key;
                    if (lastArgs) renderQuests(...lastArgs);
                    return;
                }
                finishArmed = null;
                onFinish(record.id, outcome);
            },
        });
    };
    return el('div', { className: 'story-director-quest-actions' }, [
        one('done', 'Done', 'fa-circle-check', `Mark ${record.key} finished: written into the latest reply`),
        one('failed', 'Failed', 'fa-circle-xmark', `Mark ${record.key} failed: written into the latest reply`),
    ]);
}

function renderQuest(record, { formatDate, status, onFinish }) {
    const state = status?.(record) ?? '';
    const item = el('li', { className: `story-director-record is-quest${state ? ` is-${state}` : ''}` });
    item.dataset.recordId = record.id;
    item.append(el('div', { className: 'story-director-record-head' }, [
        el('span', { className: 'story-director-record-key', text: record.key }),
        // Every quest has one (normal unless the story said otherwise), so it is always shown.
        difficultyTag(record),
        state === 'overdue' ? el('span', { className: 'story-director-tag is-overdue', text: 'deadline passed' }) : null,
        state === 'soon' ? el('span', { className: 'story-director-tag is-soon', text: 'deadline soon' }) : null,
    ]));
    const facts = el('dl', { className: 'story-director-facts' });
    const desc = text(record.fields?.desc);
    if (desc && desc !== text(record.fields?.goal)) facts.append(el('dd', { className: 'is-plain', text: desc }));
    for (const field of ROWS) {
        let value = text(record.fields?.[field]);
        if (!value) continue;
        if (field === 'due' && typeof formatDate === 'function') {
            try {
                value = String(formatDate(value, { record, field }) || value);
            } catch {
                // The date as written.
            }
        }
        facts.append(el('dt', { text: ROW_LABELS[field] ?? field }), el('dd', { text: value }));
    }
    if (facts.children.length) item.append(facts);
    const actions = finishButtons(record, onFinish);
    if (actions) item.append(actions);
    return item;
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
 * Draws the Quests tab into `pane`. `quests`: active quest records; `finished`: resolved
 * ones, most recent first; `status(record)` → 'overdue' | 'soon' | '' marks deadlines;
 * `onFinish(id, 'done' | 'failed')` when the reader closes one (no buttons without it).
 */
export function renderQuests(pane, { quests = [], finished = [], formatDate = null, status = null, onFinish = null } = {}) {
    lastArgs = [pane, { quests, finished, formatDate, status, onFinish }];
    const root = el('div', { className: 'story-director-tab story-director-quests' });
    if (!quests.length) {
        root.append(el('div', { className: 'story-director-empty' }, [
            el('p', { className: 'story-director-empty-text', text: 'No open quests.' }),
            el('p', { className: 'story-director-empty-hint', text: 'A quest starts when your character accepts one: a bounty, a contract, a favour owed. The story writes it as "+ quest …" and it stays here until it is done.' }),
        ]));
    }
    for (const [type, list] of groups(quests)) {
        root.append(el('section', { className: `story-director-section is-quest-group${type ? ` is-${type}` : ''}` }, [
            sub(typeLabel(type), type === 'bounty' ? 'fa-coins' : type === 'main' ? 'fa-crown' : 'fa-scroll', list.length),
            el('ul', { className: 'story-director-records' }, list.map(record => renderQuest(record, { formatDate, status, onFinish }))),
        ]));
    }
    if (finished.length) root.append(renderFinished(finished));
    pane.replaceChildren(root);
}
