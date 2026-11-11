// Story Director v2, part **keypeople**: the Key people section of the World screen's Now view, widget
// `story-director.key-people` (feature `story-director.key-people`), bound to `director.keyPeople.view`.
//
// One row per pinned person who is not in the scene (World's Elsewhere; the ones here are in People here): a star, their name, a
// pill (Away · back <date> or Not here), what an away person is doing now and how old their news is, and an Unpin button. Under the rows `+ Pin`
// opens the people {{user}} may pin (who is here, who the story's threads name, who NPC State Delta tracks), and an ⓘ fold
// says what the narrator is told and what it costs. Pin and Unpin are the reader's own tools (cause `ui`, on the latest reply):
// not story actions. Text goes in as text only (WAVE rule 7). The Pin list stays inside the card (a max height, scrolling there); opening it
// brings the card into view by moving its own scroller only (screens/scroll.js; never scrollIntoView).

import { button, maker } from '../screens/dom.js';
import { revealIn } from '../screens/scroll.js';
import { FEATURE } from './domain.js';

export const KEY_PEOPLE_WIDGET = 'story-director.key-people';

const SOURCES = Object.freeze({ here: 'here now', thread: 'in a quest or lead', cast: 'met from the cast', npc: 'a dossier' });

function render(el, props, api) {
    const doc = el.ownerDocument ?? globalThis.document;
    const make = maker(doc);
    const root = make('div', 'wv-key-body');
    el.replaceChildren(root);
    let value = props?.value ?? null;
    let choosing = false;
    let error = '';
    let busy = false;
    let gone = false;
    let reveal = false;

    async function run(type, payload) {
        if (busy || typeof api?.command !== 'function') return;
        busy = true;
        error = '';
        draw();
        try {
            const result = await api.command(type, payload);
            if (result && result.ok === false) error = String(result.message ?? result.error ?? 'That did not work.');
            else choosing = false;
        } catch (failure) {
            error = String(failure?.message ?? 'That did not work.');
        }
        busy = false;
        if (!gone) draw();
    }

    function row(person) {
        const item = make('li', 'wv-key-row', undefined, { 'data-key': person.key });
        const head = make('div', 'wv-key-head');
        head.append(make('span', 'wv-key-name', person.name), ' ', make('span', `wv-key-pill${person.away ? ' is-away' : person.here ? ' is-here' : ''}`, person.status));
        const unpin = make('button', 'wv-key-unpin', 'Unpin', { type: 'button', 'aria-label': `Unpin ${person.name}` });
        unpin.addEventListener('click', event => {
            event?.stopPropagation?.();
            void run('keypeople.unpin', { name: person.name });
        });
        const star = make('span', 'wv-key-star', '★', { 'aria-hidden': 'true' });
        item.append(star, head, unpin);
        // What they are doing now (an away person's own line; never a role, goal or Next), and how old the news is.
        if (person.away && person.doing) item.append(make('span', 'wv-key-sub wv-key-doing', person.doing));
        if (person.newsAgo) item.append(make('span', 'wv-key-sub wv-key-ago', `News ${person.newsAgo}`));
        return item;
    }

    function chooser(choices) {
        const box = make('div', 'wv-key-choose', undefined, { role: 'group', 'aria-label': 'People you can pin' });
        if (!choices.length) {
            box.append(make('p', 'wv-key-note', 'No one else is known to the story yet.'));
            return box;
        }
        const list = make('ul', 'wv-key-choices');
        for (const choice of choices) {
            const item = make('li', 'wv-key-choice');
            const pick = make('button', 'wv-key-pick', undefined, { type: 'button', 'aria-label': `Pin ${choice.name}` });
            pick.append(make('span', 'wv-key-name', choice.name), ' ', make('small', 'wv-key-from', SOURCES[choice.source] ?? ''));
            pick.addEventListener('click', event => {
                event?.stopPropagation?.();
                void run('keypeople.pin', { name: choice.name, ...(choice.aliases?.length ? { aliases: choice.aliases } : {}), ...(choice.nsd ? { nsd: true } : {}) });
            });
            item.append(pick);
            list.append(item);
        }
        box.append(list);
        return box;
    }

    function draw() {
        if (gone) return;
        const data = value && typeof value === 'object' ? value : {};
        // Elsewhere: the pinned people who are not in the scene (the ones who are show in People here).
        const people = (Array.isArray(data.people) ? data.people : []).filter(person => person && typeof person.name === 'string' && person.here !== true);
        const parts = [];
        if (people.length) {
            const list = make('ul', 'wv-key-list');
            list.append(...people.map(row));
            parts.push(list);
        } else {
            parts.push(make('p', 'sd-empty', data.hasPeople ? 'Everyone you pinned is here.' : 'No one is pinned yet. Pin someone to keep their story going while they are away.'));
        }
        const actions = make('div', 'wv-key-actions');
        const pin = button(make, choosing ? 'Close' : '+ Pin', 'ss-button-quiet wv-key-pin', null, () => {
            choosing = !choosing;
            reveal = choosing;
            draw();
        });
        if (data.full === true && !choosing) {
            pin.disabled = true;
            pin.setAttribute('title', data.limitText || `You can have ${data.cap} key people; unpin someone first.`);
        }
        actions.append(pin);
        parts.push(actions);
        if (choosing) parts.push(chooser(Array.isArray(data.choices) ? data.choices : []));
        if (error) parts.push(make('p', 'sd-reason', error, { role: 'alert' }));
        // The token note is a fold behind an ⓘ (its words are also the tooltip).
        if (data.note) {
            const info = make('details', 'wv-key-info');
            info.append(make('summary', 'wv-key-i', 'ⓘ', { title: data.note, 'aria-label': 'What the narrator is told' }), make('p', 'wv-key-note', data.note));
            parts.push(info);
        }
        root.replaceChildren(...parts);
        if (reveal) {
            reveal = false;
            if (choosing) revealIn(null, root.closest?.('.wv-key') ?? root, 'nearest');
        }
    }

    draw();
    return {
        update(next) {
            value = next?.value ?? null;
            draw();
        },
        destroy() {
            gone = true;
            root.remove();
        },
    };
}

/** The widget definition. */
export const keyPeopleWidget = Object.freeze({
    props: Object.freeze({ value: Object.freeze({ type: 'object', default: null }) }),
    primary: 'value',
    feature: FEATURE,
    validate: props => (props?.value !== undefined && props.value !== null && typeof props.value !== 'object' ? ['value must be the director.keyPeople.view data.'] : []),
    render,
});
