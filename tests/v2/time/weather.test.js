// The day's weather by rule (Story Block MODULES §F122, src/v2/time/weather.js): the model wrote no `~ weather`
// line, so the Status card never had one ("weather is not working"). Picked from the calendar's season and the
// region (a pack's table, else a temperate one), seeded per story day and region; set through Story Block's
// `scene.weather` as an afterCapture step when the day or region changes; the story's `~ weather` wins for the
// rest of that day and place. Deterministic and replay-safe (Re-read, swipe, rebuild, reload), with or without
// RPG Battle, and off with either feature.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createHost } from '../../vendor/story-block/testkit/index.js';
import { createModule } from '../../../src/v2/module.js';
import { makeCalendar, normalizeCalendar, PRESETS } from '../../../src/calendar.js';
import { TEMPERATE, WEATHER_FEATURE, hashOf, seasonByYear, seasonOf, tableFor, weatherFor, weatherHook, weatherKey } from '../../../src/v2/time/weather.js';
import { fakeRpgBattle } from '../integration/helpers/fake-rpg.js';

const reply = (text, lines = []) => (lines.length ? `${text}\n<Changes>\n${lines.join('\n')}\n</Changes>` : text);
const weather = host => host.head().domains.scene.weather;
const tail = host => host.st.promptLog.filter(entry => entry.key === 'story_suite_tail_1' && entry.value).map(entry => entry.value).at(-1) ?? '';
const START = ['~ time June 3, 1200, 08:00 am', '~ place Bluewatch | kind: settlement | region: the Lowmere'];
const GREGORIAN = normalizeCalendar(PRESETS.gregorian);
const DAY = 1440;

function sameRebuilt(host) {
    const head = structuredClone(host.head());
    host.store.rebuild();
    assert.deepEqual(host.head(), head, 'rebuilt from what is stored, the same state');
}

test('seasons: the year split as on Earth\'s northern half; a pack\'s seasons by month name', () => {
    assert.deepEqual([0, 45, 80, 170, 260, 340, 364].map(day => seasonByYear(day, 365)), ['winter', 'winter', 'spring', 'summer', 'autumn', 'winter', 'winter']);
    const twelve = { months: Array.from({ length: 12 }, (_, n) => ({ name: `M${n + 1}`, days: 30 })) };
    const config = normalizeCalendar({ ...twelve, preset: 'custom' });
    assert.equal(seasonOf(config, 4 * 30 * DAY)?.name, 'spring', 'the fifth of twelve months');
    assert.equal(seasonOf(config, 4 * 30 * DAY, [{ name: 'High Summer', months: ['m5'] }])?.name, 'high summer', 'the pack\'s season, any case');
    assert.equal(seasonOf(config, null), null, 'no clock, no season');
});

test('the table: the pack\'s by season and region, then season, region, any; else the temperate one', () => {
    const pack = { tables: [
        { season: 'winter', region: 'Shornmarch', weather: ['hard frost'] },
        { season: 'winter', region: '', weather: ['sleet'] },
        { season: '', region: 'the lowmere', weather: ['river mist'] },
        { season: '', region: '', weather: ['grey'] },
    ] };
    const winter = { name: 'winter', builtIn: 'winter' };
    assert.deepEqual(tableFor(pack, winter, 'shornmarch: the high moors'), ['hard frost'], 'a region containing the table\'s');
    assert.deepEqual(tableFor(pack, winter, 'elsewhere'), ['sleet']);
    assert.deepEqual(tableFor(pack, { name: 'summer', builtIn: 'summer' }, 'the lowmere'), ['river mist']);
    assert.deepEqual(tableFor(pack, { name: 'summer', builtIn: 'summer' }, ''), ['grey']);
    assert.deepEqual(tableFor(null, { name: 'summer', builtIn: 'summer' }, ''), [...TEMPERATE.summer]);
    assert.deepEqual(tableFor(null, null, ''), [...TEMPERATE.any], 'no clock: the mild table');
});

test('the pick is seeded by the story day and region: the same day and place, the same weather', () => {
    const state = (minutes, region) => ({ domains: { director: { time: { minutes } }, scene: { place: { name: 'X', kind: '', region }, present: [] } } });
    const query = name => (name === 'director.calendar' ? GREGORIAN : null);
    const at = makeCalendar(GREGORIAN).toAbs({ year: 1200, month: 6, day: 20 });
    const one = weatherFor(state(at, 'The Lowmere'), query);
    assert.deepEqual(weatherFor(state(at + 600, 'the lowmere'), query), one, 'later the same day, same region in another case');
    assert.equal(one.key, weatherKey(at, 'the lowmere'));
    assert.equal(one.season, 'summer');
    assert.ok(TEMPERATE.summer.includes(one.text));
    assert.equal(one.text, TEMPERATE.summer[hashOf(one.key) % TEMPERATE.summer.length]);
    const days = new Set(Array.from({ length: 20 }, (_, n) => weatherFor(state(at + n * DAY, 'the lowmere'), query).text));
    assert.ok(days.size > 1, 'the weather changes from day to day');
    assert.ok(Array.from(weatherKey(at, 'x'.repeat(200))).length <= 80, 'the key fits Story Block\'s');
});

for (const [name, modules] of [['with RPG Battle', () => [fakeRpgBattle(), createModule()]], ['without RPG Battle', () => [createModule()]]]) {
    test(`the weather is set each story day and region, kept on the reply (${name})`, async () => {
        const host = await createHost({ modules: modules() });
        await host.send('Morning.', reply('Bluewatch wakes.', START));
        const first = weather(host);
        assert.ok(first?.text, 'set in the first reply with no ~ weather line');
        assert.match(first.key, /^day \d+\|the lowmere$/);
        assert.deepEqual(host.sdk.query('scene.weather'), { text: first.text });
        const step = host.sdk.receipts().map(entry => entry.receipt).find(receipt => receipt.type === 'scene.weather');
        assert.deepEqual([step.cause, step.afterCapture], ['system', true]);
        // The same day and region: no new step.
        const count = () => host.sdk.receipts().filter(entry => entry.receipt.type === 'scene.weather').length;
        await host.send('Wait.', reply('An hour passes.', ['! time +1h', '+ present Elula']));
        assert.equal(count(), 1);
        await host.send('Next.', reply('The tail has the weather.', ['+ present Fenna']));
        assert.match(tail(host), new RegExp(`Place: Bluewatch \\(settlement, the Lowmere\\); ${first.text.slice(0, 10)}`));
        // A new day: a new step with the next day's key.
        await host.send('Sleep.', reply('Dawn again.', ['! time +1d']));
        assert.equal(count(), 2);
        assert.notEqual(weather(host).key, first.key);
        // Another region the same day: another step.
        await host.send('Ride on.', reply('The moors.', ['~ place Hollin\'s Reach | kind: village | region: Shornmarch']));
        assert.equal(count(), 3);
        assert.match(weather(host).key, /\|shornmarch$/);
        sameRebuilt(host);
        host.close();
    });
}

test('the story\'s ~ weather wins for the rest of that day and place; the next day brings the rule back', async () => {
    const host = await createHost({ modules: [createModule()] });
    await host.send('Morning.', reply('Bluewatch wakes.', START));
    const key = weather(host).key;
    await host.send('Look up.', reply('Thunder.', ['~ weather thunderstorm, hail']));
    assert.deepEqual([weather(host).text, weather(host).key], ['thunderstorm, hail', key], 'kept, marked for the day');
    await host.send('Wait.', reply('Still raining.', ['! time +2h']));
    assert.equal(weather(host).text, 'thunderstorm, hail', 'the rest of the day');
    await host.send('Sleep.', reply('A new day.', ['! time +1d']));
    assert.notEqual(weather(host).text, 'thunderstorm, hail');
    assert.notEqual(weather(host).key, key);
    host.close();
});

test('Re-read, swipe and reload give the same weather; a swipe to another day rolls it with the day', async () => {
    const host = await createHost({ modules: [createModule()] });
    await host.send('Morning.', reply('Bluewatch wakes.', START));
    await host.send('Sleep.', reply('A new day.', ['! time +1d']));
    const live = structuredClone(weather(host));
    const at = host.ctx.chat.length - 1;
    assert.equal((await host.turn.reread(at)).ok, true);
    assert.deepEqual({ ...weather(host), rev: 0 }, { ...live, rev: 0 }, 'Re-read: same text and key');
    await host.swipe(reply('Still night.', ['! time +1h']));
    assert.notEqual(weather(host).key, live.key);
    await host.st.swipeTo(at, 0);
    assert.deepEqual([weather(host).text, weather(host).key], [live.text, live.key]);
    const other = await createHost({ modules: [createModule()], st: { chat: host.ctx.chat } });
    assert.deepEqual(other.head().domains.scene, host.head().domains.scene, 'a reload reads the same');
    other.close();
    host.close();
});

test('off: either feature off, nothing is asked', async () => {
    const view = (on) => ({ state: { domains: { scene: { place: { name: 'X', kind: '', region: '' }, present: [] } } }, query: () => null, feature: id => on[id] !== false });
    assert.ok(weatherHook(view({})).commands.length === 1);
    assert.equal(weatherHook(view({ [WEATHER_FEATURE]: false })), undefined);
    assert.equal(weatherHook(view({ 'story-block.weather': false })), undefined);
    const host = await createHost({ modules: [createModule()] });
    host.features.set(WEATHER_FEATURE, false);
    await host.send('Morning.', reply('Bluewatch wakes.', START));
    assert.equal(weather(host), undefined);
    host.close();
});

test('a pack\'s weather table is used for its season and region', async () => {
    const pack = {
        id: 'sky', version: '1.0.0', requires: { storyBlock: '^2' },
        weather: { seasons: [{ name: 'wet', months: ['June'] }], tables: [{ season: 'wet', region: 'the Lowmere', weather: ['warm rain off the marsh'] }] },
    };
    const host = await createHost({ modules: [createModule()], settings: { packs: [{ id: pack.id, version: pack.version, enabled: true, source: 'file', origin: 'test', pack }] } });
    assert.equal(host.sdk.query('packs.weather')?.pack, 'sky');
    await host.send('Morning.', reply('Bluewatch wakes.', START));
    assert.equal(weather(host).text, 'warm rain off the marsh');
    host.close();
});
