// Story Director v2, tracker part: the Director tab, a plain renderer from the head state.
//
// Minimal on purpose: Story Block's screens (SPEC §13) will replace hand-built tabs. Threads are
// grouped by kind (open first, then closed), then the Problems list, newest first. Secrets show
// by name only. Built with the element's own document, so a fake DOM can test it.

import { orderedThreads } from './convert.js';

const GROUPS = [
    ['quest', 'Quests'], ['hook', 'Hooks'], ['agenda', 'Off-screen'], ['event', 'World'],
    ['clock', 'Clocks'], ['beat', 'Beats'], ['secret', 'Secrets'],
];
const SHOWN_PROBLEMS = 20;

function threadText(thread) {
    if (thread.kind === 'secret') return thread.key;
    const parts = [thread.key];
    if (thread.offer) parts.push('(offered)');
    const said = thread.summary || thread.fields?.step || thread.fields?.now || '';
    let line = parts.join(' ');
    if (said) line += ` — ${said}`;
    if (thread.status !== 'active') line += ` [${thread.ended?.outcome ?? 'closed'}]`;
    return line;
}

function list(doc, items, className) {
    const ul = doc.createElement('ul');
    ul.className = className;
    for (const text of items) {
        const li = doc.createElement('li');
        li.textContent = text;
        ul.appendChild(li);
    }
    return ul;
}

function section(doc, title, ul, kind) {
    const box = doc.createElement('section');
    box.setAttribute('data-kind', kind);
    const head = doc.createElement('h4');
    head.textContent = title;
    box.appendChild(head);
    box.appendChild(ul);
    return box;
}

/** `render(el, view, api)` for the Director tab. */
export function renderDirectorTab(el, view) {
    const doc = el.ownerDocument ?? globalThis.document;
    const director = view?.state?.domains?.director;
    const root = doc.createElement('div');
    root.className = 'sd-director';
    const threads = orderedThreads(director);
    for (const [kind, title] of GROUPS) {
        const own = threads.filter(thread => thread.kind === kind);
        const sorted = [...own.filter(thread => thread.status === 'active'), ...own.filter(thread => thread.status !== 'active')];
        if (sorted.length) root.appendChild(section(doc, title, list(doc, sorted.map(threadText), 'sd-threads'), kind));
    }
    const problems = [...(director?.problems ?? [])].reverse().slice(0, SHOWN_PROBLEMS).map(problem => problem.text);
    if (problems.length) root.appendChild(section(doc, 'Problems', list(doc, problems, 'sd-problems'), 'problems'));
    if (!root.childNodes.length) {
        const empty = doc.createElement('p');
        empty.textContent = 'Nothing tracked yet.';
        root.appendChild(empty);
    }
    el.replaceChildren(root);
}
