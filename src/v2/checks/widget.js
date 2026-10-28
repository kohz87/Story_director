// Story Director v2, part **checks**: the Checks card on the Director screen, widget `story-director.checks` (bound to
// `checks.policy`). It is the reader's own setting for this chat's checks: who rolls them and that character's stat bonuses,
// saved through `checks.actor` (a reader action, cause `ui`, idempotent by its write id, compared with the policy's hash).
//
// With no character yet a check is the player's with no bonuses, and the card says so. Edit opens a small form: the
// character (when there are several, or to add one), a name, a bonus per stat from -30 to 30, and whether checks roll as
// this one. Topic bonuses an older chat set are kept as they are. A refusal (a stale policy, a bad name) is shown in the card.

import { BONUS_LIMIT, MAX_NAME } from './domain.js';
import { STATS } from './words.js';
import { button, maker, spaced } from '../screens/dom.js';

export const CHECKS_WIDGET = 'story-director.checks';
const NEW = '';

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function writeId() {
    const bytes = new Uint8Array(8);
    if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
    else for (let at = 0; at < bytes.length; at += 1) bytes[at] = Math.floor(Math.random() * 256);
    return `wr_${[...bytes].map(byte => '0123456789abcdefghijklmnopqrstuvwxyz'[byte % 36]).join('')}`;
}

const signed = amount => (amount >= 0 ? `+${amount}` : String(amount));

/** "DEX +2, STR -1" for an actor's stat bonuses (topics are not listed), or ''. */
export function bonusText(actor) {
    const bonuses = isRecord(actor?.bonuses) ? actor.bonuses : {};
    return STATS.filter(stat => Number.isSafeInteger(bonuses[stat]) && bonuses[stat] !== 0).map(stat => `${stat} ${signed(bonuses[stat])}`).join(', ');
}

function render(el, props, api) {
    const doc = el.ownerDocument ?? globalThis.document;
    const make = maker(doc);
    const root = make('section', 'sd-checks ss-listcard ss-glass', undefined, { 'data-kind': 'checks', 'aria-label': 'Checks' });
    el.replaceChildren(root);
    let value = props?.value ?? null;
    let editing = null;
    let busy = false;
    let error = '';

    const policy = () => (isRecord(value) && isRecord(value.actors) ? value : { actors: {}, defaultActor: null, hash: null });
    const actors = () => Object.values(policy().actors).sort((a, b) => String(a.name).localeCompare(String(b.name)));

    function startEdit(id) {
        const actor = id === NEW ? null : policy().actors[id] ?? null;
        const bonuses = isRecord(actor?.bonuses) ? actor.bonuses : {};
        editing = {
            id: actor ? actor.id : NEW,
            name: actor?.name ?? '',
            stats: Object.fromEntries(STATS.map(stat => [stat, Number.isSafeInteger(bonuses[stat]) ? bonuses[stat] : 0])),
            makeDefault: actor ? policy().defaultActor === actor.id : !actors().length,
        };
        error = '';
        draw();
    }

    async function save() {
        if (busy || !editing) return;
        const current = (() => { try { return api?.query?.('checks.policy', {}) ?? null; } catch { return null; } })();
        const now = isRecord(current) && typeof current.hash === 'string' ? current : policy();
        const known = editing.id !== NEW ? now.actors?.[editing.id] ?? null : null;
        // Topic bonuses have no field here: they are kept as the actor had them.
        const kept = Object.fromEntries(Object.entries(known?.bonuses ?? {}).filter(([key]) => key.startsWith('topic:')));
        const stats = Object.fromEntries(STATS.filter(stat => editing.stats[stat] !== 0).map(stat => [stat, editing.stats[stat]]));
        const payload = { write: writeId(), name: editing.name, bonuses: { ...kept, ...stats }, expectedHash: now.hash };
        if (editing.id !== NEW) payload.id = editing.id;
        if (editing.makeDefault && now.defaultActor !== editing.id) payload.makeDefault = true;
        busy = true;
        error = '';
        draw();
        let out;
        try { out = await api.command('checks.actor', payload); } catch (thrown) { out = { ok: false, message: String(thrown?.message ?? thrown) }; }
        busy = false;
        if (out && out.ok === false) error = out.message || 'The character could not be saved.';
        else editing = null;
        draw();
    }

    function form() {
        const box = make('div', 'sd-checks-form');
        const many = actors();
        if (many.length) {
            const label = make('label', 'sd-field', 'Character ');
            const select = make('select', 'ss-input sd-checks-who');
            for (const actor of many) select.append(make('option', '', actor.name, { value: actor.id }));
            select.append(make('option', '', 'New character', { value: NEW }));
            select.value = editing.id;
            select.addEventListener('change', () => startEdit(select.value));
            label.append(select);
            box.append(label);
        }
        const nameLabel = make('label', 'sd-field', 'Name ');
        const name = make('input', 'ss-input sd-checks-name', undefined, { type: 'text', maxlength: String(MAX_NAME), placeholder: 'Who rolls the checks?' });
        name.value = editing.name;
        name.addEventListener('input', () => { editing.name = name.value; });
        nameLabel.append(name);
        box.append(nameLabel);
        const grid = make('fieldset', 'sd-checks-stats');
        grid.append(make('legend', '', `Bonuses (${-BONUS_LIMIT} to ${BONUS_LIMIT})`));
        for (const stat of STATS) {
            const label = make('label', 'sd-field sd-checks-stat', `${stat} `);
            const input = make('input', 'ss-input', undefined, { type: 'number', min: String(-BONUS_LIMIT), max: String(BONUS_LIMIT), step: '1', 'data-stat': stat });
            input.value = String(editing.stats[stat]);
            input.addEventListener('input', () => {
                const number = Number(input.value);
                editing.stats[stat] = Number.isSafeInteger(number) ? number : 0;
            });
            label.append(input);
            grid.append(label);
        }
        box.append(grid);
        if (many.length && policy().defaultActor !== editing.id) {
            const label = make('label', 'sd-field sd-checks-default');
            const check = make('input', '', undefined, { type: 'checkbox' });
            check.checked = editing.makeDefault;
            check.addEventListener('change', () => { editing.makeDefault = check.checked; });
            label.append(check, ' Checks roll as this character');
            box.append(label);
        }
        const actions = make('div', 'sd-actions');
        const saveButton = button(make, busy ? 'Saving…' : 'Save', 'sd-checks-save', 'fa-check', () => void save());
        saveButton.disabled = busy;
        actions.append(saveButton, button(make, 'Cancel', 'ss-button-quiet sd-checks-cancel', 'fa-xmark', () => { editing = null; error = ''; draw(); }));
        box.append(actions);
        return box;
    }

    function draw() {
        const { actors: all, defaultActor } = policy();
        const actor = defaultActor ? all[defaultActor] ?? null : null;
        const parts = [make('h4', 'ss-label ss-listcard-head sd-h', 'Checks')];
        if (!actor) parts.push(make('p', 'sd-line sd-checks-who-line', 'Checks roll for you with no bonuses. Set a name and stat bonuses to use your own.'));
        else {
            const bonuses = bonusText(actor);
            parts.push(make('p', 'sd-line sd-checks-who-line', `Checks roll as ${actor.name}${bonuses ? `: ${bonuses}` : ', with no stat bonuses'}.`));
        }
        const canEdit = typeof api?.command === 'function';
        if (editing && canEdit) parts.push(form());
        else if (canEdit) {
            const actions = make('div', 'sd-actions');
            actions.append(button(make, actor ? 'Edit' : 'Set up', 'ss-button-quiet sd-checks-edit', 'fa-pen', () => startEdit(actor ? actor.id : NEW)));
            parts.push(actions);
        }
        if (error) parts.push(make('p', 'sd-reason sd-checks-error', error, { role: 'alert' }));
        root.replaceChildren(...spaced(parts));
    }

    draw();
    return {
        update(next) {
            value = next?.value ?? null;
            // A form being filled in is not redrawn under the reader's fingers.
            if (!editing) draw();
        },
        destroy() {
            root.remove();
        },
    };
}

export const checksWidget = Object.freeze({
    props: Object.freeze({ value: Object.freeze({ type: 'object', default: null }) }),
    primary: 'value',
    validate: props => (props?.value !== undefined && props.value !== null && typeof props.value !== 'object' ? ['value must be the checks.policy data.'] : []),
    render,
});
