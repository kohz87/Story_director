// Chronicle part on the real Story Block v2 host (the vendored runtime and testkit), merged into the
// module with the other parts by src/v2/module.js: replies with <Changes> blocks, the
// interceptor's beforeGenerate, swipes and deletes. World lines are the chronicle's and `event`
// lines stay the tracker's; times come from the Director's clock; a swipe or a delete takes the
// reply's lines back (replay equals rebuild); the tail's pick is made once per reply and kept on a
// swipe; the static part never changes.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createHost } from '../../vendor/story-block/testkit/index.js';
import { createModule } from '../../../src/v2/module.js';
import { TAIL_HEADER } from '../../../src/v2/chronicle/note.js';
import { fakeRpgBattle } from '../integration/helpers/fake-rpg.js';
import { seenOf, surfacedOf } from '../../../src/v2/chronicle/domain.js';

const STATIC_KEY = 'story_suite_static';
const TAIL_KEY = 'story_suite_tail_1';
const sent = (host, key) => host.st.promptLog.filter(entry => entry.key === key && entry.value).map(entry => entry.value);
const reply = (text, lines = []) => (lines.length ? `${text}\n<Changes>\n${lines.join('\n')}\n</Changes>` : text);
const receipts = host => host.sdk.receipts().map(entry => entry.receipt);
const worldLines = tail => (tail ?? '').split('\n').filter(line => line.startsWith('- ') && tail.includes(TAIL_HEADER)).map(line => line.match(/^- ([^(:.]+?)(?: \(|:|\.)/)[1]);

async function newHost() {
    let host = null;
    const module = createModule({ host: { settings: id => host?.sdk.settings(id) ?? null, substitute: text => host?.sdk.substitute(text) } });
    host = await createHost({ modules: [fakeRpgBattle(), module] });
    return host;
}

const SIX = ['Border War', 'Red Plague', 'Dragon Calamity', 'Grain Shortage', 'Long Winter', 'Guild Strike']
    .map((name, i) => `+ world ${name} — trouble number ${i + 1}`);

test('on the host: world and faction lines are the chronicle\'s, event lines the tracker\'s; times from the clock', async () => {
    const host = await newHost();
    await host.send('Evening.', reply('Smoke over the ridge.', [
        '~ time June 3, 1200, 08:00 pm',
        '+ world Dragon Calamity — awakens near Dragonfang | state: ongoing | place: Dragonfang | factions: Ashen Court',
        '+ faction Ashen Court — the old nobility | area: Northmarch | stance: wary',
        '+ event Harvest Fair — the town square | then: closes | on: June 5, 1200',
    ]));
    const [dragon] = host.sdk.query('chronicle.events');
    assert.deepEqual([dragon.name, dragon.state, dragon.place, dragon.sinceText], ['Dragon Calamity', 'ongoing', 'Dragonfang', 'June 3, 1200, 08:00 pm']);
    const minutes = host.sdk.query('director.time').minutes;
    assert.equal(dragon.since, minutes);
    assert.deepEqual(host.sdk.query('chronicle.factions').map(faction => [faction.name, faction.eventsText]), [['Ashen Court', 'Dragon Calamity']]);
    // The tracker's event line is still a tracker thread, and not in the chronicle.
    assert.deepEqual(host.sdk.query('director.threads', { kind: 'event' }).map(thread => thread.key), ['Harvest Fair']);
    assert.equal(host.sdk.query('chronicle.event', { name: 'Harvest Fair' }), null);
    const capture = receipts(host).filter(receipt => receipt.type.startsWith('capture.') || receipt.cause === 'story');
    assert.ok(capture.length > 0);

    // Two days on, the dragon is slain: updated is the clock then, since stays.
    await host.send('Onward.', reply('News from the pass.', ['! time +2d', '~ world Dragon Calamity | state: resolved — slain at the pass']));
    const slain = host.sdk.query('chronicle.event', { name: 'Dragon Calamity' });
    assert.deepEqual([slain.state, slain.summary, slain.since, slain.updated], ['resolved', 'slain at the pass', minutes, minutes + 2 * 1440]);
    // The next reply is told nothing of it: nothing is under way.
    await host.send('And now?', reply('Quiet.'));
    assert.ok(!sent(host, TAIL_KEY).at(-1)?.includes(TAIL_HEADER));
    host.close();
});

test('on the host: a swipe or a delete takes the reply\'s world lines back; replay equals rebuild', async () => {
    const host = await newHost();
    await host.send('Begin.', reply('The war starts.', ['~ time June 3, 1200, 08:00 pm', '+ world Border War — raids on the river']));
    // The world lines only: the day digest's notes of the first reply are kept on it before the next one.
    const lines = () => { const { dayFacts: _facts, noted: _noted, ...rest } = host.head().domains.chronicle; return JSON.stringify(rest); };
    const before = lines();
    await host.send('What news?', reply('The plague.', ['+ world Red Plague — coughing in the docks', '~ world Border War | state: resolved — a truce']));
    assert.equal(host.sdk.query('chronicle.event', { name: 'Border War' }).state, 'resolved');
    const head = JSON.stringify(host.head());
    host.store.rebuild();
    assert.equal(JSON.stringify(host.head()), head, 'replay equals rebuild');

    await host.swipe(reply('Nothing new.'));
    assert.equal(lines(), before, 'the swipe took both lines back');
    assert.equal(host.sdk.query('chronicle.event', { name: 'Border War' }).state, 'ongoing');
    assert.equal(host.sdk.query('chronicle.event', { name: 'Red Plague' }), null);

    await host.swipe(reply('The plague after all.', ['+ world Red Plague — coughing in the docks']));
    assert.ok(host.sdk.query('chronicle.event', { name: 'Red Plague' }));
    await host.st.deleteMessage(host.ctx.chat.length - 1);
    assert.equal(host.sdk.query('chronicle.event', { name: 'Red Plague' }), null, 'the delete took it back');
    host.close();
});

test('on the host: more than three under way — one pick per reply, kept on a swipe, rotated on the next reply', async () => {
    const host = await newHost();
    await host.send('Begin.', reply('Troubled times.', ['~ time June 3, 1200, 08:00 pm', ...SIX]));
    await host.send('What news?', reply('Rumours.'));
    const surfaces = () => receipts(host).filter(receipt => receipt.type === 'chronicle.surface');
    assert.equal(surfaces().length, 1);
    assert.equal(surfaces()[0].cause, 'system');
    const first = worldLines(sent(host, TAIL_KEY).at(-1));
    assert.equal(first.length, 3);
    assert.deepEqual(first, surfacedOf(host.head().domains.chronicle).ids.map(id => host.head().domains.chronicle.events[id].name));

    // A swipe of that reply: the same pick, no second receipt.
    await host.swipe(reply('Other rumours.'));
    assert.deepEqual(worldLines(sent(host, TAIL_KEY).at(-1)), first);
    assert.equal(surfaces().length, 1);
    await host.regenerate(reply('Rumours again.'));
    assert.deepEqual(worldLines(sent(host, TAIL_KEY).at(-1)), first);

    // The next reply: the three left out.
    await host.send('More?', reply('Yes.'));
    const second = worldLines(sent(host, TAIL_KEY).at(-1));
    assert.equal(surfaces().length, 2);
    assert.equal(new Set([...first, ...second]).size, 6);

    // The reader's edits are ui commands; the pick is not a click.
    const war = host.sdk.query('chronicle.event', { name: 'Border War' });
    const edited = await host.sdk.command('chronicle.edit', { id: war.id, state: 'resolved' }, { cause: 'ui' });
    assert.equal(edited.ok, true, edited.message);
    assert.equal(host.sdk.query('chronicle.event', { id: war.id }).state, 'resolved');
    const click = await host.sdk.command('chronicle.surface', { at: 1 }, { cause: 'ui' });
    assert.deepEqual([click.ok, click.code], [false, 'REFUSED']);

    // The static part never changed.
    assert.equal(new Set(sent(host, STATIC_KEY)).size, 1);
    assert.match(sent(host, STATIC_KEY)[0], /\+ world Name — what is changing in the wider world/);
    assert.match(sent(host, STATIC_KEY)[0], /Under \[World\] are events still under way/);
    const head = JSON.stringify(host.head());
    host.store.rebuild();
    assert.equal(JSON.stringify(host.head()), head, 'replay equals rebuild with the picks');
    host.close();
});
