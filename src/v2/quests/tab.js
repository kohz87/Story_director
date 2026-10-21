// Story Director v2, quests part: a minimal, unstyled Quests tab (offers with Take on / Turn
// down, active quests with progress and Finish, finished ones). A stand-in until the screens
// of SPEC §13 replace hand-built tabs. Draws from the head state only, through textContent.

import { el, button } from '../../ui/dom.js';
import { placeRule, progressLabel, progressOf, questLists, stateQuery } from './progress.js';
import { rewardText, targetText } from './parse.js';

const text = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const FINISHED_SHOWN = 20;

/** Why Finish is off for a quest, or '' when it can be turned in now. */
export function finishBlock(thread, progress, scene) {
    if (!thread.taken) return 'Take it on first: fights count from then.';
    if (!thread.target) return 'No target code can count; the story decides when it is done.';
    if (!progress.met) return progress.reason || 'Not done yet.';
    return placeRule(thread, scene).reason;
}

/** `render(el, view, api)` for the Quests tab; `api.command(type, payload, { cause })` runs a command. */
export function renderQuestsTab(root, view, api) {
    const state = view?.state;
    const director = state?.domains?.director;
    const query = typeof view?.query === 'function' ? view.query : stateQuery(state);
    const send = api?.command ?? globalThis.StoryBlock?.sdk?.command;
    const status = el('p', { attrs: { role: 'status' } });
    const run = (type, id) => {
        if (typeof send !== 'function') return;
        Promise.resolve(send(type, { id }, { cause: 'ui' })).then(result => {
            status.textContent = result && result.ok === false ? text(result.message) : '';
        }, error => { status.textContent = text(error?.message) || 'That did not work.'; });
    };
    const { offers, active, finished } = questLists(director);
    const sections = [];

    if (offers.length) {
        sections.push(el('h4', { text: 'Offered' }), el('ul', {}, offers.map(thread => el('li', { attrs: { 'data-quest': thread.id } }, [
            el('div', { text: thread.key }),
            text(thread.fields?.goal) ? el('div', { text: text(thread.fields.goal) }) : null,
            text(thread.fields?.giver) ? el('div', { text: `giver: ${text(thread.fields.giver)}` }) : null,
            text(thread.fields?.reward) ? el('div', { text: `reward: ${text(thread.fields.reward)}` }) : null,
            button('Take on', 'story-director-quest-take', { title: `Take on ${thread.key}`, onClick: () => run('quest.take', thread.id) }),
            button('Turn down', 'story-director-quest-decline', { title: `Turn down ${thread.key}`, onClick: () => run('quest.decline', thread.id) }),
        ]))));
    }

    sections.push(el('h4', { text: 'Quests' }));
    if (!active.length) sections.push(el('p', { text: 'No quests taken on.' }));
    else {
        sections.push(el('ul', {}, active.map(thread => {
            const progress = progressOf(thread, query);
            const blocked = finishBlock(thread, progress, state?.domains?.scene);
            const finish = button('Finish', 'story-director-quest-finish', { title: blocked || `Turn in ${thread.key}`, onClick: () => { if (!finish.disabled) run('quest.finish', thread.id); } });
            finish.disabled = Boolean(blocked);
            const terms = [targetText(thread.target), rewardText(thread.reward, thread.target)].filter(Boolean).join('; ');
            return el('li', { attrs: { 'data-quest': thread.id } }, [
                el('div', { text: thread.key }),
                text(thread.fields?.goal) ? el('div', { text: text(thread.fields.goal) }) : null,
                terms ? el('div', { text: terms }) : null,
                thread.target ? el('div', { className: 'story-director-quest-progress', text: progressLabel(thread, progress) }) : null,
                thread.taken ? null : button('Take on', 'story-director-quest-take', { title: `Count toward ${thread.key} from now`, onClick: () => run('quest.take', thread.id) }),
                thread.target ? finish : null,
                blocked && thread.target ? el('div', { className: 'story-director-quest-reason', text: blocked }) : null,
                button('Abandon', 'story-director-quest-abandon', { title: `Give up ${thread.key}`, onClick: () => run('quest.abandon', thread.id) }),
            ]);
        })));
    }

    if (finished.length) {
        sections.push(el('h4', { text: 'Finished' }), el('ul', {}, finished.slice(0, FINISHED_SHOWN).map(thread => el('li', { attrs: { 'data-quest': thread.id } }, [
            el('span', { text: thread.key }),
            el('span', { text: ` — ${thread.ended?.outcome ?? 'done'}` }),
        ]))));
    }
    root.replaceChildren(el('div', { className: 'story-director-v2-quests' }, [...sections, status]));
}
