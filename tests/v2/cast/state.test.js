// The living cast on a whole host (Story Block's testkit with Story Director): people join the world from the packs at their start; a
// first meeting follows place and routine (no dice), at the pace the setting allows, never in a fight; the narrator is told who comes in
// the reply they come in and never anyone unmet; a swipe, a Re-read, a rebuild and a reload give the same world.
import test from 'node:test';
import assert from 'node:assert/strict';

import { leanFight } from '../../../src/v2/cast/entries.js';
import { OPENING, castCue, castHost, castSource, createFakeModel, entry, people, receipts, said, sent, settle, slice, validatorErrors, TAIL_KEY } from './helpers.js';

const BROM = entry('brom', { start: { place: 'Harrow', goal: 'keep the forge lit', routine: 'at the forge in the morning' }, drawnTo: [] });
const FENNA = entry('fenna', { start: { place: 'Bluewatch docks', goal: 'keep the night ferry running', routine: 'works the night ferry' } });
const SERA = entry('sera', { start: { place: 'Gwenmar', goal: 'find her brother\'s killer', routine: '' }, drawnTo: ['the man you fought at the weir'] });

const quiet = t => t.mock.method(console, 'warn', () => {});

test('people join the world from the pack at their start, once, at the first reply after the clock is set; nobody is met and nothing is told', async t => {
    quiet(t);
    const host = await castHost({ source: castSource([BROM, FENNA, SERA]) });
    try {
        await host.send('Hello.', said('Dawn.', OPENING));
        assert.deepEqual(Object.keys(people(host)).sort(), ['ersveil:brom', 'ersveil:fenna', 'ersveil:sera']);
        const start = people(host)['ersveil:fenna'];
        assert.deepEqual([start.where, start.doing, start.alive, start.met, start.heard], ['Bluewatch docks', 'works the night ferry', true, null, null]);
        // Nothing about the pack entry is copied: only what the world needs to move a person.
        assert.ok(!JSON.stringify(slice(host)).includes('Hidden thing'));
        assert.ok(!JSON.stringify(slice(host)).includes('weathered'));
        assert.equal(receipts(host, 'cast.sync').length, 1);
        await host.send('Look around.', said('Smoke rises.'));
        assert.equal(receipts(host, 'cast.sync').length, 2, 'the second reply starts the cast\'s day (the clock is set now)');
        assert.equal(slice(host).day[0].at, host.head().domains.director.time.minutes);
        await host.send('And?', said('Quiet.'));
        assert.equal(receipts(host, 'cast.sync').length, 2, 'nothing to say: no step');
        assert.deepEqual(validatorErrors(host), []);
        assert.deepEqual(host.store.problems(), []);
        // Unmet people are in no text the narrator is sent, and no step names one.
        const everything = [...sent(host, 'story_suite_static'), ...sent(host, TAIL_KEY)].join('\n');
        assert.doesNotMatch(everything, /Fenna|Sera|Gwenmar|Bluewatch/);
        assert.doesNotMatch(host.sdk.receipts().filter(item => item.receipt.type.startsWith('cast.')).map(item => item.receipt.summary).join('\n'), /Fenna|Sera/);
    } finally {
        host.close();
    }
});

test('a first meeting by place and routine: the party is at their place while their routine has them there; the narrator is told in that reply only, the card says why, no dice', async t => {
    quiet(t);
    const host = await castHost({ source: castSource([BROM, FENNA]), settings: { 'cast.faces': 'day2' } });
    try {
        await host.send('Hello.', said('Dawn.', OPENING));
        await host.send('Look around.', said(`Smoke rises. ${host.everyone()}`));
        // Brom is at Harrow in the morning: he comes in this reply.
        const brom = people(host)['ersveil:brom'];
        assert.equal(brom.met.why, 'place');
        assert.equal(brom.met.where, 'Harrow');
        const cue = castCue(host);
        assert.match(cue, /^\[Cast\] Brom comes into the scene in this reply\./);
        assert.match(cue, /Look: weathered\./);
        assert.match(cue, /Why now: At the forge in the morning, they are at Harrow/);
        assert.doesNotMatch(cue, /Fenna|Hidden thing|Never said|No roll/, 'no other person, no secret, no card words');
        assert.equal(receipts(host, 'cast.meet').length, 1);
        const note = Object.values(slice(host).notes).find(item => item.kind === 'met');
        assert.deepEqual([note.head, note.tag, note.line], ['Paths crossed: Brom', 'Ersveil cast · first meeting', 'Paths crossed: Brom']);
        assert.match(note.rest, /^Why: Brom at the forge in the morning at Harrow, and you are there: your first time here while they are\. No roll\./);
        // The next reply: told no more (the cue is for the reply they come in).
        await host.send('Greet him.', said('He nods.'));
        assert.equal(castCue(host), '');
        assert.equal(receipts(host, 'cast.meet').length, 1, 'met once');
        // Fenna works the night ferry at Bluewatch docks: at noon her routine does not have her there, at night it does.
        await host.send('Go to the docks.', said('The docks.', ['~ place Bluewatch docks | kind: landmark', '~ time June 3, 1200, 12:00 pm']));
        await host.send('Wait.', said('Gulls.'));
        assert.equal(people(host)['ersveil:fenna'].met, null, 'at noon the ferry is not running');
        await host.send('Wait till dark.', said('Dusk falls.', ['~ time June 3, 1200, 09:30 pm']));
        await host.send('Look.', said(`Lamps. ${host.everyone()}`));
        const fenna = people(host)['ersveil:fenna'];
        assert.equal(fenna.met.why, 'place');
        assert.match(castCue(host), /^\[Cast\] Fenna comes into the scene/);
        assert.deepEqual(validatorErrors(host), []);
        assert.deepEqual(host.store.problems(), []);
    } finally {
        host.close();
    }
});

test('new faces at most: one a day by default (the rest wait for the next day), two a day, one a week; never in a fight', async t => {
    quiet(t);
    const two = [entry('ana'), entry('bo'), entry('cy')];
    const run = async (settings, queries = {}) => {
        const host = await castHost({ source: castSource(two), settings, queries });
        await host.send('Hello.', said('Dawn.', OPENING));
        await host.send('Look.', said(`Smoke. ${host.everyone()}`));
        return host;
    };
    const metCount = host => Object.values(people(host)).filter(person => person.met).length;
    let host = await run({});
    try {
        assert.equal(metCount(host), 1, '1 a day: one comes');
        await host.send('Wait.', said('Quiet.'));
        assert.equal(metCount(host), 1, 'the others wait the same day');
        await host.send('Next day.', said('Morning.', ['~ time June 4, 1200, 08:00 am']));
        await host.send('Look.', said(`Smoke. ${host.everyone()}`));
        assert.equal(metCount(host), 2, 'the next day another');
    } finally { host.close(); }
    host = await run({ 'cast.faces': 'day2' });
    try {
        assert.equal(metCount(host), 1);
        await host.send('Wait.', said(`Quiet. ${host.everyone()}`));
        assert.equal(metCount(host), 2, '2 a day: a second the next reply');
        await host.send('Wait.', said('Quiet.'));
        assert.equal(metCount(host), 2);
    } finally { host.close(); }
    host = await run({ 'cast.faces': 'week1' });
    try {
        await host.send('Next day.', said('Morning.', ['~ time June 4, 1200, 08:00 am']));
        await host.send('Look.', said(`Smoke. ${host.everyone()}`));
        assert.equal(metCount(host), 1, '1 a week: not the next day');
        await host.send('Next week.', said('A week on.', ['~ time June 11, 1200, 08:00 am']));
        await host.send('Look.', said(`Smoke. ${host.everyone()}`));
        assert.equal(metCount(host), 2, 'a week later');
    } finally { host.close(); }
    // A fight on: no one comes; when it ends, they do.
    const fight = { status: 'active' };
    host = await castHost({ source: castSource(two), queries: { 'combat.session': () => (fight.status ? { ...fight } : null) } });
    try {
        await host.send('Hello.', said('Dawn.', OPENING));
        await host.send('Look.', said('Smoke.'));
        await host.send('Look.', said('Smoke.'));
        assert.equal(metCount(host), 0, 'never during a fight');
        fight.status = 'ended';
        await host.send('Look.', said(`Smoke. ${host.everyone()}`));
        assert.equal(metCount(host), 1);
    } finally { host.close(); }
});

test('off means off: the feature switch and the setting stop every step, hook and cue; what is stored stays', async t => {
    quiet(t);
    const host = await castHost({ source: castSource([BROM, FENNA]) });
    try {
        await host.send('Hello.', said('Dawn.', OPENING));
        await host.send('Look.', said('Smoke.'));
        const stored = JSON.stringify(slice(host));
        host.features.set('story-director.cast', false);
        const steps = host.sdk.receipts().filter(item => item.receipt.type.startsWith('cast.')).length;
        await host.send('Next day.', said('Morning.', ['~ time June 4, 1200, 08:00 am']));
        await host.send('Look.', said('Smoke.'));
        assert.equal(host.sdk.receipts().filter(item => item.receipt.type.startsWith('cast.')).length, steps, 'no step while off');
        assert.equal(JSON.stringify(slice(host)), stored, 'what was kept is untouched');
        assert.equal(castCue(host), '');
        assert.equal(host.sdk.query('director.cast'), null);
        host.features.set('story-director.cast', true);
        host.settings.set('story-director', 'cast.on', false);
        await host.send('Look.', said('Smoke.'));
        assert.equal(host.sdk.receipts().filter(item => item.receipt.type.startsWith('cast.')).length, steps, 'the setting switches it off too');
        assert.equal(host.sdk.query('director.cast'), null);
    } finally {
        host.close();
    }
});

test('a start place is the pack place\'s name, slug or alias, in any case; one the pack does not have leaves the person unplaced until the planner places them, and nothing crashes', async t => {
    quiet(t);
    const place = (name, slug, aliases = []) => ({ name, slug, aliases, x: 1, y: 1 });
    const at = (id, where) => entry(id, { start: { place: where, goal: `${id} goal`, routine: '' } });
    const source = castSource([at('by-name', 'harrow'), at('by-slug', 'bluewatch-village'), at('by-alias', 'THE WATCH TOWN'), at('lost', 'Atlantis')]);
    source.places = [place('Harrow', 'harrow'), place('Bluewatch Village', 'bluewatch-village', ['the Watch town']), place('Bluewatch Village / Guild Office', 'guild-office')];
    const model = createFakeModel(['~ cast lost | harrow | wandering in at last']);
    const host = await castHost({ source, model, settings: { 'cast.faces': 'day2' } });
    try {
        await host.send('Hello.', said('Dawn.', OPENING));
        const where = id => people(host)[`ersveil:${id}`].where;
        assert.deepEqual(['by-name', 'by-slug', 'by-alias', 'lost'].map(where), ['Harrow', 'Bluewatch Village', 'Bluewatch Village', '']);
        assert.deepEqual(validatorErrors(host), []);
        await host.send('Look.', said(`Smoke. ${host.everyone()}`));
        assert.equal(people(host)['ersveil:by-name'].met.why, 'place', 'the party is at Harrow: the one placed by name (in any case) is there');
        assert.equal(people(host)['ersveil:lost'].met, null, 'unplaced: nowhere to meet');
        assert.match(model.calls.length ? model.calls[0].prompt : 'now at: unknown', /now at: unknown/);
        // The planner places her (its words match the pack's place by name or alias).
        await host.send('Sleep.', said('Morning.', ['~ time June 4, 1200, 08:00 am']));
        await settle();
        await host.send('Look.', said(`Smoke. ${host.everyone()}`));
        assert.match(model.calls[0].prompt, /- lost \| Lost \| goal: lost goal \| now at: unknown/);
        assert.equal(where('lost'), 'Harrow', 'placed by the planner, under the pack\'s own name for the place');
        assert.deepEqual(host.store.problems(), []);
    } finally {
        host.close();
    }
});

test('never during a Lean RPG fight either: a Foes block with a foe in it holds the meetings back until the foes are gone; the RPG switched off is no fight', async t => {
    quiet(t);
    const { STANDARD_TEMPLATES } = await import('../../vendor/story-block/src/v2/lean-rpg/templates.js');
    const host = await castHost({ source: castSource([entry('brom', { start: { place: 'Kesh', goal: 'forge', routine: '' } })]) });
    try {
        await host.send('Hello.', said('Dawn.', OPENING));
        host.features.set('story-block.rpg', true);
        const foes = STANDARD_TEMPLATES.find(item => item.name === 'Foes').definition;
        assert.equal((await host.sdk.command('dm.define', { definition: structuredClone(foes) })).ok, true);
        await host.send('A drake!', said('A drake lands.', ['+ dm foes — a drake | kind: set-slot-1 | name: Weir-drake | count: 1 | level: 4', '~ place Kesh | kind: town']));
        assert.equal(leanFight(host.head()), true, 'the Foes block holds a foe');
        await host.send('Fight.', said('Steel rings.'));
        await host.send('Fight.', said('Steel rings.'));
        assert.equal(people(host)['ersveil:brom'].met, null, 'never during a fight');
        // The RPG switched off: its blocks are no fight.
        host.features.set('story-block.rpg', false);
        await host.send('Fight.', said(`Quiet at last. ${host.everyone()}`));
        assert.equal(people(host)['ersveil:brom'].met.why, 'place');
    } finally {
        host.close();
    }
    const again = await castHost({ source: castSource([entry('brom', { start: { place: 'Kesh', goal: 'forge', routine: '' } })]) });
    try {
        await again.send('Hello.', said('Dawn.', OPENING));
        again.features.set('story-block.rpg', true);
        const foes = STANDARD_TEMPLATES.find(item => item.name === 'Foes').definition;
        await again.sdk.command('dm.define', { definition: structuredClone(foes) });
        await again.send('A drake!', said('A drake lands.', ['+ dm foes — a drake | kind: set-slot-1 | name: Weir-drake | count: 1 | level: 4', '~ place Kesh | kind: town']));
        await again.send('Beat it.', said('It falls.', ['- dm foes — slain | kind: clear-1 | why: down']));
        assert.equal(leanFight(again.head()), false, 'no foe left: no fight');
        await again.send('Look.', said(`Smoke. ${again.everyone()}`));
        assert.equal(people(again)['ersveil:brom'].met.why, 'place', 'when the foes are gone they come');
    } finally {
        again.close();
    }
});

for (const [formula, down] of [['standard', 'Down']]) {
    test(`a won Lean RPG fight (${formula}) no longer holds the meetings back: a Down group stays in its slot, a live one still blocks; the next fight Down too`, async t => {
        quiet(t);
        const { STANDARD_TEMPLATES } = await import('../../vendor/story-block/src/v2/lean-rpg/templates.js');
        const host = await castHost({ source: castSource([entry('brom', { start: { place: 'Kesh', goal: 'forge', routine: '' } })]) });
        try {
            await host.send('Hello.', said('Dawn.', OPENING));
            host.features.set('story-block.rpg', true);
            const foes = STANDARD_TEMPLATES.find(item => item.name === 'Foes').definition;
            assert.equal((await host.sdk.command('dm.define', { definition: structuredClone(foes) })).ok, true);
            await host.send('Gnashers!', said('Gnashers pour in.', ['+ dm foes — gnashers | kind: set-slot-1 | name: Gnashers | count: 12 | level: 4', '~ place Kesh | kind: town']));
            assert.equal(leanFight(host.head()), true, 'a live group');
            await host.send('Fight.', said('Steel rings.'));
            assert.equal(people(host)['ersveil:brom'].met, null, 'never during a fight');
            // Won: the narrator only sets the health; the slot keeps its name and count.
            await host.send('Fight.', said('They fall.', [`~ dm foes — they fall | kind: hurt-1 | to: ${down}`]));
            const fields = Object.values(host.head().domains.dataModules.instances)[0].chat.fields;
            assert.deepEqual([fields.foe1, fields.count1, fields.hurt1], ['Gnashers', 12, 0], 'the slot is still filled, at 0');
            assert.equal(leanFight(host.head()), false, 'every filled slot is Down: no fight');
            // A later fight in another slot: live, then won (Down) as well.
            await host.send('Rats!', said('Rats.', ['+ dm foes — rats | kind: set-slot-2 | name: Rats | count: 3 | level: 2']));
            assert.equal(leanFight(host.head()), true, 'a live group beside a Down one');
            await host.send('Fight.', said('Squeaks.', [`~ dm foes — beaten | kind: hurt-2 | to: ${down}`]));
            assert.equal(leanFight(host.head()), false, 'both Down');
            await host.send('Look.', said(`Smoke. ${host.everyone()}`));
            assert.equal(people(host)['ersveil:brom'].met.why, 'place', 'the meetings resume');
        } finally {
            host.close();
        }
    });
}

test('a pack person the story already has in the scene (under their name or an alias) is met at that moment, "met in the story": no cue, no pace used, never skipped for good', async t => {
    quiet(t);
    const fenna = entry('fenna', { aliases: ['the ferrywoman'], start: { place: 'Kesh', goal: 'ferry', routine: '' } });
    const brom = entry('brom', { start: { place: 'Harrow', goal: 'forge', routine: '' } });
    const host = await castHost({ source: castSource([fenna, brom, entry('una', { aliases: ['the diver'], start: { place: 'Pearlbank', goal: 'x', routine: '' } })]) });
    try {
        await host.send('Hello.', said('Dawn.', [...OPENING, '+ present the ferrywoman']));
        await host.send('Look.', said(`Smoke. ${host.everyone()}`));
        const world = people(host);
        assert.deepEqual([world['ersveil:fenna'].met.why, world['ersveil:fenna'].met.where, world['ersveil:fenna'].met.reason], ['story', 'Harrow', ''], 'the ferrywoman is Fenna: met where the party is');
        assert.equal(world['ersveil:una'].met, null, 'another alias, not in the scene: not met');
        assert.equal(world['ersveil:brom'].met.why, 'place', 'and the day\'s one new face is still Brom: being in the story used none of the pace');
        assert.match(castCue(host), /^\[Cast\] Brom comes into the scene/);
        assert.doesNotMatch(castCue(host), /Fenna/, 'the narrator has her already: no cue for her');
        assert.deepEqual(slice(host).meeting[0].keys, ['ersveil:brom']);
        const note = Object.values(slice(host).notes).find(item => item.head === 'Paths crossed: Fenna');
        assert.deepEqual([note.kind, note.tag], ['met', 'Ersveil cast · met in the story']);
        assert.match(note.rest, /^Why: Fenna was already in the story when the cast reached them \(met in the story\); no roll\.$/);
        assert.deepEqual(host.sdk.query('director.cast').map(person => person.id).sort(), ['brom', 'fenna']);
        assert.deepEqual(validatorErrors(host), []);
        await host.swipe(said(`Smoke, again. ${host.everyone()}`));
        assert.equal(people(host)['ersveil:fenna'].met.why, 'story', 'a swipe keeps it');
        const live = JSON.stringify(host.head());
        host.store.rebuild();
        assert.equal(JSON.stringify(host.head()), live);
    } finally {
        host.close();
    }
});
