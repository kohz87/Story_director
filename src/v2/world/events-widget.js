// Story Director v2, part **world**: the Journal's "Show all N events" button, widget `story-director.journal-events`.
//
// A day's digest keeps a short pick of its events and only the count of the rest. This button, shown while a day has more than
// the pick, loads that day's whole list on tap (`director.journal.events { day }`, worked out from the chat's receipts by the same
// rules, stored nowhere) and shows it under the pick; a second tap folds it. Text goes in as text only.

import { maker } from '../screens/dom.js';
import { FEATURE } from './known.js';

export const EVENTS_WIDGET = 'story-director.journal-events';
export const EVENTS_QUERY = 'director.journal.events';

function render(el, props, api) {
    const doc = el.ownerDocument ?? globalThis.document;
    const make = maker(doc);
    const button = make('button', 'ss-button wv-more-btn', undefined, { type: 'button' });
    const list = make('ul', 'wv-events', undefined, { 'aria-label': 'All events of the day' });
    list.hidden = true;
    el.replaceChildren(button, list);
    let day = Number(props?.day);
    let total = Number(props?.total);
    let open = false;

    const load = () => {
        let events = [];
        try {
            const got = typeof api?.query === 'function' ? api.query(EVENTS_QUERY, { day }) : null;
            events = Array.isArray(got?.events) ? got.events.filter(item => typeof item === 'string' && item) : [];
        } catch { events = []; }
        return events;
    };
    const draw = () => {
        if (!open) {
            list.replaceChildren();
            list.hidden = true;
            button.textContent = Number.isSafeInteger(total) ? `Show all ${total} events` : 'Show all events';
            button.setAttribute('aria-expanded', 'false');
            return;
        }
        const events = load();
        list.replaceChildren(...(events.length ? events : ['No events of this day are left in the chat.']).map(text => make('li', events.length ? '' : 'wv-note', text)));
        list.hidden = false;
        button.textContent = events.length ? `Hide the ${events.length} events` : 'Hide';
        button.setAttribute('aria-expanded', 'true');
    };
    button.addEventListener('click', event => {
        event?.stopPropagation?.();
        open = !open;
        draw();
    });
    draw();
    return {
        update(next) {
            day = Number(next?.day);
            total = Number(next?.total);
            draw();
        },
        destroy() {
            button.remove();
            list.remove();
        },
    };
}

/** The widget (feature `story-director.world`). */
export const eventsWidget = Object.freeze({
    props: Object.freeze({ day: Object.freeze({ type: 'string', default: '' }), total: Object.freeze({ type: 'string', default: '' }) }),
    primary: 'day',
    feature: FEATURE,
    validate: () => [],
    render,
});
