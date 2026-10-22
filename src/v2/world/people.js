// Story Director v2, part **world**: the people in the scene, widget `story-director.people` (MODULES §F9),
// on the World screen's Here. Bound to `director.world.here` (props.value): one chip per person present.
// With NPC State Delta there, a chip shows the person's stance (their ladder rank, disposition or stage)
// and, when they have a dossier, opens it (NPC State Delta's own `openDossier`, a page call it offers;
// nothing is sent to the story). Without it, the chip is the plain name. Text goes in as text only.

import { maker } from '../screens/dom.js';
import { FEATURE } from './known.js';

export const PEOPLE_WIDGET = 'story-director.people';

/** NPC State Delta's `openDossier(name)` on this page, or null. */
export function dossierOpener() {
    try {
        const api = globalThis.NPCStateDelta;
        return typeof api?.openDossier === 'function' ? name => api.openDossier(name) : null;
    } catch {
        return null;
    }
}

function render(el, props, { open = dossierOpener } = {}) {
    const doc = el.ownerDocument ?? globalThis.document;
    const make = maker(doc);
    const root = make('ul', 'wv-people', undefined, { 'aria-label': 'People here' });
    el.replaceChildren(root);
    const draw = value => {
        const people = Array.isArray(value?.people) ? value.people : [];
        const opener = open?.() ?? null;
        root.replaceChildren(...people.filter(person => person && typeof person.name === 'string' && person.name).map(person => {
            const item = make('li', 'wv-person');
            const link = value?.nsd === true && person.dossier === true && opener;
            const chip = link
                ? make('button', 'menu_button wv-chip wv-link', undefined, { type: 'button', title: `Open ${person.name}'s dossier` })
                : make('span', 'wv-chip');
            if (link) {
                chip.append(make('i', 'fa-solid fa-address-card', undefined, { 'aria-hidden': 'true' }), ' ');
                chip.addEventListener('click', event => {
                    event?.stopPropagation?.();
                    try { opener(person.name); } catch { /* the dossier could not open; nothing else to do */ }
                });
            }
            chip.append(make('span', 'wv-name', person.name));
            if (typeof person.stance === 'string' && person.stance) chip.append(' ', make('span', 'wv-stance', person.stance));
            item.append(chip);
            return item;
        }));
    };
    draw(props?.value ?? null);
    return {
        update(next) { draw(next?.value ?? null); },
        destroy() { root.remove(); },
    };
}

/** The widget; `open` (tests): () → a function opening one dossier by name, or null. */
export function createPeopleWidget({ open = dossierOpener } = {}) {
    return Object.freeze({
        props: Object.freeze({ value: Object.freeze({ type: 'object', default: null }) }),
        primary: 'value',
        feature: FEATURE,
        validate: props => (props?.value !== undefined && props.value !== null && typeof props.value !== 'object' ? ['value must be the director.world.here data.'] : []),
        render: (el, props) => render(el, props, { open }),
    });
}

export const peopleWidget = createPeopleWidget();
