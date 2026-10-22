// Story Director alone (WAVE rule 11): Story Block and Story Director, no RPG Battle (a dating sim, a
// mystery: no fights, stats or levels). Quests are taken on by the story's + quest and turned in by the
// story; a kill goal nobody can count is the story's word; a quest with no level known pays as the
// lowest rank and says so; the day digest, the Days board, the atlas, the chronicle, director.advance
// and the tail all work; the fixed prompt asks for no fights and is the same bytes every reply.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createHost } from '../../vendor/story-block/testkit/index.js';
import { createModule, fightRunner } from '../../../src/v2/module.js';
import { DIGEST } from '../../../src/v2/chronicle/days.js';

const STATIC_KEY = 'story_suite_static';
const TAIL_KEY = 'story_suite_tail_1';
const sent = (host, key) => host.st.promptLog.filter(entry => entry.key === key && entry.value).map(entry => entry.value);
const reply = (text, lines = []) => (lines.length ? `${text}\n<Changes>\n${lines.join('\n')}\n</Changes>` : text);
const receipts = host => host.sdk.receipts().map(entry => entry.receipt);
const quest = (host, key) => host.sdk.query('director.threads', { kind: 'quest' }).find(thread => thread.key === key);

async function alone() {
    let host = null;
    const module = createModule({ host: { settings: id => host?.sdk.settings(id) ?? null, substitute: text => host?.sdk.substitute(text) } });
    host = await createHost({ modules: [module] });
    return host;
}

test('alone: take a quest, turn it in, cross a day, get a digest; no fights asked for, nothing thrown', async t => {
    t.mock.method(console, 'warn', () => {});
    const host = await alone();
    assert.deepEqual(host.sdk.modules().map(entry => entry.id).filter(id => id !== 'story-block'), ['story-director']);
    await host.send('Hello.', reply('Harrow square at dawn.', [
        '~ time June 3, 1200, 08:00 am', '~ place Harrow | kind: settlement', '+ present Orsa',
        '+ world Red Plague — coughing in the docks | state: looming',
        '+ beat Ambush — bandits on the road | on: June 3, 1200, 09:00 am | encounter: 3 Bandit',
    ]));
    assert.equal(fightRunner({ query: (name, args) => host.sdk.query(name, args) }), false, 'no module runs fights');
    await host.send("I'll take it, I'll find your letter.", reply('Orsa nods.', ['+ quest Lost Letter — Orsa lost a letter | giver: Orsa | goal: Find the letter | reward: 30 gold']));
    const letter = quest(host, 'Lost Letter');
    assert.ok(letter.taken, 'taken in the reader\'s own words');
    const take = receipts(host).find(receipt => receipt.type === 'quest.take' || receipt.data?.taken === true);
    assert.ok(take, 'a take receipt');
    const details = host.sdk.query('quest.details', { id: letter.id });
    assert.equal(details.terms.level, 'no character level is known, so it pays as F-rank, the lowest');
    await host.send("I'll take the wolf job.", reply('Orsa points at the farm.', ['+ quest Wolf Cull — wolves at the farm | giver: Orsa | goal: Kill 3 wolves | reward: 40 gold']));
    const wolves = quest(host, 'Wolf Cull');
    const progress = host.sdk.query('quest.progress', { id: wolves.id });
    assert.deepEqual([progress.countable, progress.met, progress.source], [false, false, 'story'], 'a kill goal nobody counts is the story\'s word');
    // The tail asks the story to judge it, as any goal code cannot count.
    assert.match(sent(host, TAIL_KEY).at(-1) ?? '', /Quest goal the story judges: Lost Letter/);
    await host.send('I find it and give it to Orsa.', reply('Orsa pays.', ['~ quest Lost Letter | met: yes', '- quest Lost Letter — turned in']));
    assert.equal(quest(host, 'Lost Letter').status, 'resolved');
    await host.send('The wolves are dead.', reply('Orsa pays again.', ['- quest Wolf Cull — turned in', '! time +20h']));
    const turnIns = receipts(host).filter(receipt => /turns in/.test(receipt.summary));
    assert.deepEqual(turnIns.map(receipt => receipt.summary), [
        'The party turns in Lost Letter: goal met (Find the letter), 30 gold paid.',
        'The party turns in Wolf Cull: goal met (Kill 3 wolves) on the story\'s word (no fights are counted), 40 gold paid.',
    ]);
    assert.deepEqual(host.sdk.query('inventory.wallet', {}), { coin: 70 });

    // A rule moves the clock (as crafting would); then the next reply writes the day.
    const advanced = await host.bus.command('director.advance', { minutes: 30, cause: 'rest', reason: 'A short rest' }, { cause: 'system' });
    assert.ok(advanced.ok, advanced.message);
    await host.send('Morning.', reply('Day two.'));
    assert.equal(receipts(host).filter(receipt => receipt.type === DIGEST).length, 1);
    const [day] = host.sdk.query('chronicle.days');
    assert.equal(day.line, 'June 3, 1200: to Harrow; took on Lost Letter, Wolf Cull; finished Lost Letter, Wolf Cull; 70 gold in; 1 world event.');
    assert.deepEqual(day.fights, { count: 0, won: 0, lost: 0, fled: 0 });
    const board = host.sdk.query('chronicle.dayBoard');
    assert.equal(board.count, 1);
    // The atlas and the chronicle are there as ever.
    assert.equal(host.sdk.query('atlas.here', {})?.name ?? host.sdk.query('atlas.place', { name: 'Harrow' })?.name, 'Harrow');
    assert.deepEqual(host.sdk.query('chronicle.events').map(event => event.name), ['Red Plague']);

    // The fixed prompt: no fights, the same bytes every reply.
    const statics = sent(host, STATIC_KEY);
    assert.equal(new Set(statics).size, 1, 'the static part never changed');
    assert.ok(statics[0].includes('+ beat'));
    assert.doesNotMatch(statics[0], /encounter|\bfights?\b|\bfoes?\b|\bXP\b/i);
    // The beat came due without a fight cue; its encounter stays on the thread as plain data.
    for (const tail of sent(host, TAIL_KEY)) assert.doesNotMatch(tail, /first blow|resolved outside the story|fight: 3 Bandit|fought off-screen/);
    assert.equal(host.sdk.query('director.threads', { kind: 'beat' })[0].fields.encounter, '3 Bandit');
    assert.deepEqual(host.store.problems(), []);
    host.close();
});
