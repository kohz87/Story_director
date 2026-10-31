// `chronicle.lasting` on the real Story Block v2 host (the vendored runtime and testkit): a pack's events
// write the chronicle through their `then` steps, a second event waits on the first with
// `query('chronicle.passed', …)` (the condition language has no sums, so "N days after" is asked of the
// chronicle), the story's own world lines cannot move the state of what an event wrote, and a swipe, a
// delete, a rebuild and a fresh load give the same chronicle. Nothing in a pack, a reply line or a
// button can call the command outside an event.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createHost } from '../../vendor/story-block/testkit/index.js';
import { packsFor } from '../../vendor/story-block/src/v2/runtime.js';
import { stCapabilities } from '../../vendor/story-block/src/v2/packs/st-adapter.js';
import { createModule } from '../../../src/v2/module.js';
import { TAIL_HEADER } from '../../../src/v2/chronicle/note.js';
import { validateChronicle } from '../../../src/v2/chronicle/domain.js';
import { fakeFightRunner } from '../integration/helpers/fake-fight-runner.js';

const TAIL_KEY = 'story_suite_tail_1';
const STATIC_KEY = 'story_suite_static';
const sent = (host, key) => host.st.promptLog.filter(entry => entry.key === key && entry.value).map(entry => entry.value);
const reply = (text, lines = []) => (lines.length ? `${text}\n<Changes>\n${lines.join('\n')}\n</Changes>` : text);
const receipts = host => host.sdk.receipts().map(entry => entry.receipt);

const CRACKS = 'Cracks in the seventh seal';
const PACK = JSON.stringify({
    id: 'seal-timeline',
    version: '1.0.0',
    name: 'The seventh seal',
    requires: { storyBlock: '^2' },
    content: {
        events: [
            {
                id: 'cracks-in-the-seventh-seal',
                once: true,
                when: 'time() != null',
                cue: 'Hairline cracks run through the seventh seal.',
                then: [{ command: 'chronicle.lasting', payload: { name: CRACKS, state: 'looming', place: 'Auvoth', factions: ['Sealwardens'], summary: 'The seal over Auvoth is cracking.', keep: true } }],
            },
            {
                id: 'the-seventh-seal-fails',
                after: 'cracks-in-the-seventh-seal',
                once: true,
                when: `query('chronicle.passed', { name: '${CRACKS}', minutes: 1440 })`,
                cue: 'The seventh seal has failed.',
                then: [{ command: 'chronicle.lasting', payload: { name: 'Seventh seal failed', state: 'ongoing', place: 'Auvoth', factions: ['Adventurer Guild', 'Sealwardens'], summary: 'The seal over Auvoth has failed.', keep: true } }],
            },
        ],
    },
});

async function newHost() {
    let host = null;
    const module = createModule({ host: { settings: id => host?.sdk.settings(id) ?? null, substitute: text => host?.sdk.substitute(text) } });
    host = await createHost({ modules: [fakeFightRunner(), module] });
    const installed = await host.packs.packs.install(PACK, { origin: 'pack.json' });
    assert.equal(installed.ok, true, JSON.stringify(installed.errors));
    return host;
}

const events = host => host.sdk.query('chronicle.events');
const named = (host, name) => host.sdk.query('chronicle.event', { name });
const chronicleOnly = host => { const { dayFacts: _facts, noted: _noted, ...rest } = host.head().domains.chronicle; return JSON.stringify(rest); };

test('on the host: an event\'s step writes the entry, a second event counts a day from its since, the story cannot move its state', async () => {
    const host = await newHost();
    // The clock is not set yet: nothing happens, however many replies.
    await host.send('Begin.', reply('Dust on the road.'));
    assert.deepEqual(events(host), []);
    await host.send('Go on.', reply('The inn.', ['~ time June 3, 1200, 08:00 pm']));
    assert.deepEqual(events(host), [], 'the event is checked before a reply, and the clock was set only in this one');

    // Before the next reply the first event fires: it writes the entry at the Director's clock.
    await host.send('Rest.', reply('A quiet night.'));
    const cracks = named(host, CRACKS);
    assert.deepEqual([cracks.state, cracks.place, cracks.locked, cracks.keep, cracks.factionsText], ['looming', 'Auvoth', true, true, 'Sealwardens']);
    assert.equal(cracks.since, host.sdk.query('director.time').minutes);
    const fired = receipts(host).filter(receipt => receipt.type === 'events.fire');
    assert.deepEqual(fired.map(receipt => receipt.data.event), ['pack.seal-timeline/cracks-in-the-seventh-seal']);
    assert.equal(host.head().domains.chronicle.events[cracks.id].by, 'event:pack.seal-timeline/cracks-in-the-seventh-seal');
    assert.deepEqual(validateChronicle(host.head().domains.chronicle), []);

    // Less than a day on: the second event waits.
    await host.send('Walk.', reply('Hours pass.', ['! time +10h']));
    await host.send('Walk more.', reply('More hours.'));
    assert.equal(named(host, 'Seventh seal failed'), null);
    assert.equal(host.sdk.query('chronicle.passed', { name: CRACKS, minutes: 1440 }), false);

    // A day after the cracks: the second event fires before the next reply.
    await host.send('Sleep.', reply('A long sleep.', ['! time +16h']));
    await host.send('Wake.', reply('The seal groans.'));
    const failed = named(host, 'Seventh seal failed');
    assert.ok(failed, 'the second event wrote its entry');
    assert.deepEqual([failed.state, failed.keep, failed.locked, failed.factionsText], ['ongoing', true, true, 'Adventurer Guild, Sealwardens']);
    assert.ok(failed.since >= cracks.since + 1440);
    assert.deepEqual(receipts(host).filter(receipt => receipt.type === 'events.fire').map(receipt => receipt.data.event), ['pack.seal-timeline/cracks-in-the-seventh-seal', 'pack.seal-timeline/the-seventh-seal-fails']);
    // Both are in the news and under way; the lasting entry is a world event like any other.
    assert.deepEqual(events(host).map(event => event.name).sort(), [CRACKS, 'Seventh seal failed']);
    assert.deepEqual(host.sdk.query('chronicle.events', { open: true }).length, 2);

    // The story's own lines: the state is held, a summary is added, and the card says so.
    const sentBefore = sent(host, TAIL_KEY).length;
    await host.send('Look.', reply('The seal is mended, they say.', [`~ world Seventh seal failed | state: resolved — the Guild claims it holds`, `~ world ${CRACKS} | state: resolved`]));
    assert.equal(named(host, 'Seventh seal failed').state, 'ongoing');
    assert.equal(named(host, CRACKS).state, 'looming');
    assert.match(named(host, 'Seventh seal failed').summary, /^The seal over Auvoth has failed\. the Guild claims it holds$/);
    const cards = receipts(host).filter(receipt => receipt.type === 'capture.world').map(receipt => receipt.summary);
    assert.ok(cards.includes('World: Seventh seal failed stays ongoing (set by the world\'s timeline); changed: summary.'), cards.join(' | '));
    assert.ok(cards.includes(`World: ${CRACKS} stays looming (set by the world's timeline).`), cards.join(' | '));

    // Keep in mind: both are in the next reply's tail.
    await host.send('And now?', reply('Quiet.'));
    const tail = sent(host, TAIL_KEY).at(-1);
    assert.ok(sent(host, TAIL_KEY).length > sentBefore);
    assert.ok(tail.includes(TAIL_HEADER));
    assert.match(tail, /- Seventh seal failed \(Auvoth\)/);
    assert.match(tail, new RegExp(`- ${CRACKS} \\(Auvoth\\)`));
    assert.equal(new Set(sent(host, STATIC_KEY)).size, 1, 'the static prompt did not change');

    // The reader can still change anything.
    const edited = await host.sdk.command('chronicle.edit', { id: failed.id, state: 'resolved', summary: 'Mended by the Guild.' }, { cause: 'ui' });
    assert.equal(edited.ok, true, edited.message);
    assert.equal(named(host, 'Seventh seal failed').state, 'resolved');
    // Nothing else can call the command: a button, a command of a module, or the bus without an event.
    for (const cause of ['ui', 'story', 'system']) {
        const run = await host.sdk.command('chronicle.lasting', { name: 'Sneaky', state: 'ongoing' }, { cause });
        assert.equal(run.ok, false, cause);
        assert.equal(run.code, 'REFUSED', `${cause}: ${run.message}`);
    }
    assert.equal(named(host, 'Sneaky'), null);
    await host.send('Hmm.', reply('Nothing.', ['+ world Sneaky — not a lasting change']));
    assert.equal(named(host, 'Sneaky').locked, undefined, 'a world line makes a plain entry');
    host.close();
});

test('on the host: a delete takes a lasting change back and the event happens again; rebuild, swipe and a fresh load agree', async () => {
    const host = await newHost();
    await host.send('Begin.', reply('Dust.', ['~ time June 3, 1200, 08:00 pm']));
    await host.send('Rest.', reply('A quiet night.'));
    assert.ok(named(host, CRACKS));
    await host.send('Next day.', reply('Dawn.', ['! time +1d']));
    await host.send('Wake.', reply('The seal groans.'));
    assert.ok(named(host, 'Seventh seal failed'));
    const live = JSON.stringify(host.head());
    host.store.rebuild();
    assert.equal(JSON.stringify(host.head()), live, 'rebuild equals live');
    const again = await createHost({ modules: [fakeFightRunner(), createModule()] });
    try {
        await again.st.loadChat(structuredClone(host.ctx.chat));
        assert.deepEqual(again.store.problems(), []);
        assert.equal(JSON.stringify(again.head().domains), JSON.stringify(host.head().domains), 'a fresh load agrees');
    } finally {
        again.close();
    }

    // A swipe of the last reply changes nothing of the chronicle: an event's changes are kept on the reply before it.
    const withFailure = chronicleOnly(host);
    await host.swipe(reply('The seal groans louder.'));
    assert.equal(chronicleOnly(host), withFailure);
    assert.equal(named(host, 'Seventh seal failed').locked, true);

    // Deleting the exchange that held the second event takes the entry (and the day) back; the first one stays.
    const held = receipts(host).findIndex(receipt => receipt.type === 'events.fire' && receipt.data.event.endsWith('the-seventh-seal-fails'));
    const at = host.sdk.receipts()[held].index;
    while (host.ctx.chat.length > at - 1) await host.st.deleteMessage(host.ctx.chat.length - 1);
    assert.equal(named(host, 'Seventh seal failed'), null);
    assert.ok(named(host, CRACKS));
    assert.equal(named(host, CRACKS).locked, true);
    const after = JSON.stringify(host.head());
    host.store.rebuild();
    assert.equal(JSON.stringify(host.head()), after, 'rebuild equals live after the delete');
    assert.deepEqual(validateChronicle(host.head().domains.chronicle), []);

    // The story goes on, and the event comes due again once a day has passed.
    await host.send('Again.', reply('Dawn again.', ['! time +1d']));
    await host.send('And then?', reply('The seal groans.'));
    assert.ok(named(host, 'Seventh seal failed'));
    const final = JSON.stringify(host.head());
    host.store.rebuild();
    assert.equal(JSON.stringify(host.head()), final);
    host.close();
});

test('on the host: the Journal tells the lasting change on its day; News leaves out a name that is a secret', async () => {
    const host = await newHost();
    await host.send('Begin.', reply('Dust.', ['~ time June 3, 1200, 08:00 pm']));
    await host.send('Rest.', reply('A quiet night.'));
    await host.send('Next day.', reply('Dawn.', ['! time +1d']));
    await host.send('Wake.', reply('The seal groans.'));
    await host.send('Onward.', reply('Onward.', ['! time +2d']));
    await host.send('Onward again.', reply('Onward.'));
    const days = host.sdk.query('chronicle.days').map(digest => [digest.day, digest.world]);
    const told = days.flatMap(([, world]) => world);
    assert.ok(told.some(text => text.includes(`World: ${CRACKS}`)), JSON.stringify(days));
    assert.ok(told.some(text => text.includes('World: Seventh seal failed')), JSON.stringify(days));
    // The first change is told on the day it was written, the second on the day after.
    const dayOf = text => days.find(([, world]) => world.some(line => line.includes(text)))[0];
    assert.equal(dayOf('Seventh seal failed'), dayOf(CRACKS) + 1);

    // The same hidden-names rules as any world event: an entry named like a secret is not in News.
    assert.deepEqual(host.sdk.query('director.world', {}).news.map(item => item.name).sort(), [CRACKS, 'Seventh seal failed']);
    await host.send('A whisper.', reply('Rumour.', [`+ secret ${CRACKS} — the Sealwardens know`]));
    assert.deepEqual(host.sdk.query('director.world', {}).news.map(item => item.name), ['Seventh seal failed']);
    host.close();
});

// ---- the capability a pack can require --------------------------------------------------------------

const NEEDS_LASTING = {
    id: 'needs-lasting', version: '1.0.0', name: 'Needs lasting', requires: { storyBlock: '^2', capabilities: ['chronicle-lasting'] },
    content: { events: [{ id: 'omen', when: 'true', cue: 'A dark omen.', once: true, then: [{ command: 'chronicle.lasting', payload: { name: 'Dark omen', state: 'looming' } }] }] },
};

// Story Block checks `requires.capabilities` against the running modules' declared names (st-adapter.js, the check the
// live host uses; the testkit host leaves it off, so the packs part is built here with it on, over the host's settings).
async function withBlock(host, run) {
    globalThis.StoryBlock = { sdk: host.sdk };
    try { return await run(packsFor(host.ctx, { capabilities: stCapabilities })); } finally { delete globalThis.StoryBlock; }
}

test('on the host: Story Director declares chronicle-lasting, so a pack that requires it installs; without Story Director the reader is told what is missing', async () => {
    let host = null;
    const module = createModule({ host: { settings: id => host?.sdk.settings(id) ?? null, substitute: text => host?.sdk.substitute(text) } });
    assert.deepEqual(module.capabilities, ['chronicle-lasting']);
    host = await createHost({ modules: [fakeFightRunner(), module] });
    assert.deepEqual(host.sdk.modules().find(entry => entry.id === 'story-director').capabilities, ['chronicle-lasting']);
    const saved = await withBlock(host, async part => {
        assert.ok(stCapabilities().includes('chronicle-lasting'));
        const result = await part.packs.install(JSON.stringify(NEEDS_LASTING), { origin: 'pack.json' });
        assert.deepEqual([result.ok, result.action], [true, 'installed'], JSON.stringify(result));
        const [listed] = part.packs.list();
        assert.deepEqual([listed.enabled, listed.missing, listed.problem], [true, [], '']);
        return structuredClone(host.ctx.extensionSettings.storySuite);
    });
    host.close();

    // No Story Director: the same pack is turned away with the reason, and nothing is installed.
    const bare = await createHost({ modules: [] });
    await withBlock(bare, async part => {
        assert.equal(stCapabilities().includes('chronicle-lasting'), false);
        const result = await part.packs.install(JSON.stringify(NEEDS_LASTING), { origin: 'pack.json' });
        assert.equal(result.ok, false);
        assert.deepEqual(result.errors.map(error => [error.code, error.message]), [['MISSING_CAPABILITY', 'This pack needs chronicle-lasting, which no installed module provides.']]);
        assert.deepEqual(part.packs.list(), []);
    });
    bare.close();

    // A pack installed while Story Director was there and then opened without it is listed as missing the capability.
    const later = await createHost({ modules: [], settings: saved });
    await withBlock(later, async part => {
        const [listed] = part.packs.list();
        assert.deepEqual([listed.id, listed.missing], ['needs-lasting', ['chronicle-lasting']]);
    });
    later.close();
});

// ---- an event waits for the story to have a date -----------------------------------------------------

const lastRun = host => host.sdk.query('events.status').lastRun;
const firedIds = host => receipts(host).filter(receipt => receipt.type === 'events.fire').map(receipt => receipt.data.event.split('/')[1]);

// What the Studio writes for an "Any time" event with a lasting change and a second event "2 days after" it.
const ANY_TIME = JSON.stringify({
    id: 'ui-made', version: '1.0.0', name: 'UI made', requires: { storyBlock: '^2', capabilities: ['chronicle-lasting'] },
    content: {
        events: [
            { id: 'the-seal-cracks', when: 'true', cue: 'Cracks.', then: [{ command: 'chronicle.lasting', payload: { name: 'Seal cracking', state: 'ongoing' } }] },
            { id: 'the-seal-fails', after: 'the-seal-cracks', when: "query('chronicle.passed', { name: 'Seal cracking', minutes: 2880 })", cue: 'It fails.' },
        ],
    },
});

async function hostWith(pack) {
    let host = null;
    const module = createModule({ host: { settings: id => host?.sdk.settings(id) ?? null, substitute: text => host?.sdk.substitute(text) } });
    host = await createHost({ modules: [fakeFightRunner(), module] });
    const installed = await host.packs.packs.install(pack, { origin: 'pack.json' });
    assert.equal(installed.ok, true, JSON.stringify(installed.errors));
    return host;
}

test('on the host: an "Any time" event with a lasting change waits for a date, then fires once; the event two days after it comes due exactly then', async () => {
    const host = await hostWith(ANY_TIME);
    // No date yet: the step says so plainly, nothing is claimed, saved or told, and it is tried again on every reply.
    await host.send('Begin.', reply('Dust on the road.'));
    assert.deepEqual(lastRun(host).failed.map(({ id, code, message }) => [id, code, message]), [['pack.ui-made/the-seal-cracks', 'NOT_YET', 'The story has no date yet; this world event waits for one.']]);
    assert.deepEqual([firedIds(host), events(host)], [[], []]);
    await host.send('Still no date.', reply('More dust.'));
    assert.deepEqual(lastRun(host).failed.map(item => item.code), ['NOT_YET']);
    assert.deepEqual(host.store.problems(), []);

    // The reply sets the date; the event fires before the next reply, dated from then.
    await host.send('The inn.', reply('The inn.', ['~ time June 3, 1200, 08:00 am']));
    assert.deepEqual(events(host), [], 'checked before the reply, which is what set the date');
    const start = host.sdk.query('director.time').minutes;
    await host.send('Rest.', reply('A quiet night.'));
    assert.deepEqual(firedIds(host), ['the-seal-cracks']);
    assert.equal(named(host, 'Seal cracking').since, start);
    assert.deepEqual(lastRun(host).failed, []);

    // The second event comes due exactly two days after, not a minute before.
    for (const jump of ['! time +1d', '! time +23h', '! time +59m']) {
        await host.send('On.', reply('On.', [jump]));
        await host.send('Check.', reply('Check.'));
        assert.equal(firedIds(host).includes('the-seal-fails'), false, jump);
    }
    assert.equal(host.sdk.query('director.time').minutes, start + 2880 - 1);
    await host.send('One more minute.', reply('On.', ['! time +1m']));
    assert.equal(firedIds(host).includes('the-seal-fails'), false, 'checked before the reply that moved the clock');
    await host.send('Check.', reply('Check.'));
    assert.deepEqual(firedIds(host), ['the-seal-cracks', 'the-seal-fails']);
    host.close();
});

test('on the host: a pack that starts on a calendar date has the clock seeded after the event check; the event fires on the next reply and its delayed event a day later', async () => {
    const base = JSON.parse(readFileSync(new URL('../../fixtures/ersveil-bluewatch.pack.json', import.meta.url), 'utf8'));
    const pack = JSON.stringify({
        id: 'dated-start', version: '1.0.0', name: 'Dated start', requires: { storyBlock: '^2', capabilities: ['chronicle-lasting'] },
        calendar: base.calendar, start: { scene: { place: { name: 'Bluewatch Village', kind: 'settlement', region: 'River Confederacy' } } },
        content: {
            events: [
                { id: 'any-parent', when: 'true', cue: 'A dark omen.', once: true, then: [{ command: 'chronicle.lasting', payload: { name: 'Dark omen', state: 'looming' } }] },
                { id: 'any-child', after: 'any-parent', when: "query('chronicle.passed', { name: 'Dark omen', minutes: 1440 })", cue: 'The omen comes true.', once: true },
            ],
        },
    });
    const host = await hostWith(pack);
    await host.send('Begin.', reply('Morning.'));
    assert.notEqual(host.sdk.query('director.time').minutes, null, 'the start seeded the clock');
    assert.deepEqual([firedIds(host), events(host)], [[], []]);
    assert.deepEqual(lastRun(host).failed.map(item => item.code), ['NOT_YET']);
    await host.send('Go on.', reply('Later.'));
    const omen = named(host, 'Dark omen');
    assert.deepEqual([firedIds(host), omen.since === host.sdk.query('director.time').minutes], [['any-parent'], true]);
    await host.send('A day.', reply('A day passes.', ['! time +1d']));
    assert.equal(firedIds(host).includes('any-child'), false);
    await host.send('Check.', reply('Check.'));
    assert.deepEqual(firedIds(host), ['any-parent', 'any-child']);
    host.close();
});
