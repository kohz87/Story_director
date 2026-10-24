// The World screen's data (part world, src/v2/world/): what the player character knows, on a real Story
// Block host. Here (the place and who is present, plain names alone or NPC State Delta's chips), the known
// news, events and factions, what is coming, and the Journal; nothing behind the scenes or planned by the
// arc planner ever in them; Story Director alone, with NPC State Delta, without the day digest; replay after
// swipes and middle deletes equals a rebuild.
import test from 'node:test';
import assert from 'node:assert/strict';

import { DAYS_ID, FEATURE, PEOPLE_WIDGET, WORLD_ID, createPeopleWidget, daysScreen, holidays, part, worldScreen } from '../../../src/v2/world/index.js';
import { DIGEST_FEATURE } from '../../../src/v2/chronicle/days.js';
import { createModule, storyDirectorModule } from '../../../src/v2/module.js';
import { makeCalendar } from '../../../src/calendar.js';
import { validateScreen } from '../../vendor/story-block/src/v2/view/screens.js';
import { scopeCss } from '../../vendor/story-block/src/v2/view/css.js';
import { drawWorld, said, squash, worldData, worldHost } from './helpers.js';

// Everything behind the scenes or planned in the story below: none of it may reach World or Journal.
const HIDDEN = ['buys rope', 'Bell Rings', 'the bell tolls', 'Storm Season', 'Bell Curse', 'cast with ashes', 'whispered', 'Drowned Bell', 'Salvage Rights', 'Wreck Diver', 'raise the wreck'];
const PLAN = `ARC: The Drowned Bell — the harbour's old bell rings again
BEAT: Wreck Diver — a diver does not come up | on: in 2 days
AGENDA: Old Tom — wants to raise the wreck | now: the quay
HOOK: Salvage Rights — who owns what the sea gives | on: in 3 days
SECRET: Sunken Name — the bell bears a drowned name`;

const OPENING = [
    '~ time June 3, 1200, 08:00 am', '~ place Harbour', '+ present Mira, Old Tom',
    '+ world Red Plague — coughing in the docks | state: ongoing | place: Harbour | factions: Guild',
    '+ faction Guild — the harbour guild | area: the docks | stance: wary',
    '+ hook Rat Cellar — clear the cellar | goal: kill 3 rats | due: June 6, 1200',
    '+ event Harvest Fair — the fair comes to town | on: June 10, 1200',
    '+ event Far Feast — a feast | on: September 1, 1200',
    '+ agenda Mira — buys rope | now: the docks',
    '+ beat Bell Rings — the bell tolls | on: June 5, 1200',
    '+ clock Storm Season — storms | due: June 8, 1200',
    '+ secret Bell Curse — cast with ashes',
    '+ world Bell Curse — whispered in the taverns | state: looming',
];

async function story(options = {}) {
    const host = await worldHost(options);
    await host.send('Hello.', said('The harbour at dawn.', OPENING));
    const rat = host.sdk.query('director.threads', { kind: 'hook' }).find(t => t.key === 'Rat Cellar');
    assert.equal((await host.sdk.command('threads.accept', { write: 'wr_00000001', thread: rat.id, expectedHash: host.sdk.query('threads.hash', { thread: rat.id }) })).ok, true);
    const accepted = await host.sdk.command('director.arc.accept', { plan: PLAN });
    assert.equal(accepted.ok, true, accepted.message);
    await host.send('Next day.', said('Morning again.', ['~ time June 4, 1200, 09:00 am', '+ present Brecht', '~ world Red Plague | state: ongoing — spreads to the market']));
    await host.send('Look round.', said('Quiet streets.', ['+ present Kell']));
    return host;
}

const leaks = data => HIDDEN.filter(word => JSON.stringify(data).includes(word));

test('the part: feature on by default; the World screen and the old Days id; queries, setting and widget registered', () => {
    assert.deepEqual(part.features.map(feature => [feature.id, feature.default]), [[FEATURE, true]]);
    assert.equal(WORLD_ID, 'story-director/world');
    assert.equal(DAYS_ID, 'story-director/days');
    assert.deepEqual([...worldScreen.mounts], ['tab', 'screen']);
    assert.equal(worldScreen.feature, FEATURE);
    assert.deepEqual([...daysScreen.mounts], ['dialog'], 'the old Days id is no tab and no game-view screen any more');
    assert.equal(daysScreen.feature, DIGEST_FEATURE);
    for (const screen of [worldScreen, daysScreen]) {
        assert.deepEqual(validateScreen(screen), [], screen.id);
        assert.deepEqual(scopeCss(screen.css, screen.id).warnings, [], screen.id);
        for (const binding of Object.values(screen.data)) assert.ok(Object.hasOwn(storyDirectorModule.queries, binding.query), binding.query);
    }
    for (const name of ['director.world', 'director.world.here', 'director.journal']) assert.equal(storyDirectorModule.queries[name].feature, FEATURE, name);
    assert.equal(storyDirectorModule.settings.defaults['world.upcomingDays'], 30);
    assert.equal(storyDirectorModule.settings.schema['world.upcomingDays'].feature, FEATURE);
    assert.ok(storyDirectorModule.widgets[PEOPLE_WIDGET]);
    const ids = storyDirectorModule.screens.map(screen => screen.id);
    assert.ok(ids.includes(WORLD_ID) && ids.indexOf(WORLD_ID) < ids.indexOf('story-director/director'), 'World comes before the Director');
});

test('Story Director alone: Here with plain names, known news and factions newest first, upcoming in range; nothing hidden', async () => {
    const host = await story();
    const { world, journal } = worldData(host);
    host.close();
    assert.deepEqual(world.here.place, { name: 'Harbour', region: '', kind: '' });
    assert.deepEqual(world.here.present, ['Mira', 'Old Tom', 'Brecht', 'Kell']);
    assert.equal(world.here.nsd, false);
    assert.deepEqual(world.here.people.map(person => [person.name, person.stance, person.dossier]), [['Mira', '', false], ['Old Tom', '', false], ['Brecht', '', false], ['Kell', '', false]]);
    // Newest first: the plague moved on June 4; the two events were written on June 3 (same reply: by id).
    assert.deepEqual(world.news.map(item => [item.kind, item.name])[0], ['world', 'Red Plague']);
    assert.deepEqual(world.news.map(item => item.name).slice(1).sort(), ['Far Feast', 'Harvest Fair']);
    assert.equal(world.news[0].summary, 'spreads to the market');
    assert.equal(world.news.find(item => item.name === 'Harvest Fair').ago, 'yesterday', 'written on June 3; it is June 4');
    assert.deepEqual(world.factions.map(item => [item.name, item.area, item.stance]), [['Guild', 'the docks', 'wary']]);
    // June 4, 09:00: the quest is due in 2 days, the fair in 6; the feast is past the 30 days; no beat, clock or planned hook.
    assert.deepEqual(world.upcoming.map(item => [item.kind, item.name, item.label]), [['hook', 'Rat Cellar', 'in 2 days'], ['event', 'Harvest Fair', 'in 6 days']]);
    assert.equal(world.upcoming[0].goal, 'kill 3 rats');
    assert.equal(world.clockSet, true);
    assert.deepEqual(leaks(world), []);
    assert.deepEqual(leaks(journal), []);
});

test('Upcoming: the reader\'s range; an overdue quest first; nothing dated without the clock', async () => {
    const host = await worldHost({ settings: { 'world.upcomingDays': 120 } });
    await host.send('Hello.', said('The harbour.', ['+ hook Rat Cellar — clear it | due: June 6, 1200', '+ event Far Feast — a feast | on: September 1, 1200']));
    assert.equal(host.sdk.query('director.world').clockSet, false);
    assert.deepEqual(host.sdk.query('director.world').upcoming, []);
    await host.send('Later.', said('Later.', ['~ time June 8, 1200, 08:00 am']));
    const { upcoming, upcomingDays } = host.sdk.query('director.world');
    host.close();
    assert.equal(upcomingDays, 120);
    assert.deepEqual(upcoming.map(item => [item.name, item.label, item.overdue]), [['Far Feast', 'in 85 days', false]]);
});

test('with NPC State Delta: each person present is a chip with their stance, and opens their dossier', async () => {
    const host = await story({ delta: { Mira: { rank: 'Friend' }, 'Old Tom': { disposition: 'gruff' }, Brecht: { stages: { trust: 'Wary' } } } });
    const here = host.sdk.query('director.world.here');
    const { world, journal } = worldData(host);
    host.close();
    assert.equal(here.nsd, true);
    assert.deepEqual(here.people.map(person => [person.name, person.stance, person.dossier]), [['Mira', 'Friend', true], ['Old Tom', 'gruff', true], ['Brecht', 'Wary', true], ['Kell', '', false]]);
    assert.deepEqual(leaks(world), []);
    assert.deepEqual(leaks(journal), []);

    const opened = [];
    const widget = createPeopleWidget({ open: () => name => opened.push(name) });
    const { el, warnings } = drawWorld({ world, journal }, { widgets: { [PEOPLE_WIDGET]: widget } });
    assert.deepEqual(warnings, []);
    const chips = el.querySelectorAll('.wv-chip');
    assert.deepEqual(chips.map(chip => squash(chip.textContent)), ['Mira Friend', 'Old Tom gruff', 'Brecht Wary', 'Kell']);
    assert.equal(el.querySelectorAll('button.wv-link').length, 3, 'Kell has no dossier: a plain chip');
    el.querySelectorAll('button.wv-link')[1].click();
    assert.deepEqual(opened, ['Old Tom']);
    // Without NPC State Delta on the page the chips are plain names, no button.
    const plain = drawWorld({ world, journal }, { widgets: { [PEOPLE_WIDGET]: createPeopleWidget({ open: () => null }) } });
    assert.equal(plain.el.querySelectorAll('button').length, 0);
});

test('the Journal: each day with places, people met, news and quests; today so far; no arc line', async () => {
    const host = await story();
    // June 5: the June 4 digest is written before this reply.
    await host.send('Sleep.', said('Night falls.', ['~ time June 5, 1200, 07:00 am']));
    await host.send('Up.', said('Dawn.', ['+ present Wynn']));
    const journal = host.sdk.query('director.journal');
    const board = host.sdk.query('chronicle.dayBoard');
    host.close();
    assert.equal(journal.on, true);
    const byDate = Object.fromEntries(journal.days.map(day => [day.date, day]));
    assert.deepEqual(journal.days.map(day => [day.date, day.today]), [['June 5, 1200', true], ['June 4, 1200', false], ['June 3, 1200', false]]);
    assert.deepEqual(byDate['June 3, 1200'].met, ['Mira', 'Old Tom']);
    assert.ok(byDate['June 3, 1200'].facts.includes('Went to: Harbour'), byDate['June 3, 1200'].facts.join(' | '));
    assert.ok(byDate['June 3, 1200'].world.some(line => /Red Plague/.test(line)));
    assert.deepEqual(byDate['June 4, 1200'].met, ['Brecht', 'Kell']);
    assert.ok(byDate['June 4, 1200'].world.some(line => /spreads to the market/.test(line)));
    assert.deepEqual(byDate['June 5, 1200'].met, ['Wynn']);
    // The digest itself never takes the arc in (its commands are no fact of the day); a world line named like a
    // secret is in the digest's data, and the Journal leaves it out.
    assert.doesNotMatch(JSON.stringify(board), /Drowned Bell|Salvage Rights|Wreck Diver/);
    assert.match(JSON.stringify(board), /Bell Curse/);
    assert.deepEqual(leaks(journal), []);

    const { el, warnings, set } = drawWorld({ world: null, journal }, { draft: { view: 'journal' } });
    assert.deepEqual(warnings, []);
    assert.equal(el.querySelectorAll('.wv-now').length, 0, 'Journal picked: the Now view is not drawn');
    const days = el.querySelectorAll('.wv-day');
    assert.deepEqual(days.map(node => node.querySelector('.wv-date').textContent), ['June 5, 1200', 'June 4, 1200', 'June 3, 1200']);
    assert.match(squash(days[2].textContent), /Met ?Mira ?Old Tom/);
    set({ find: 'brecht' });
    assert.deepEqual(el.querySelectorAll('.wv-day').map(node => node.querySelector('.wv-date').textContent), ['June 4, 1200']);
});

test('an older digest that kept an arc line or a secret\'s name: the Journal leaves the line out', async () => {
    const { knownDay, hiddenNames } = await import('../../../src/v2/world/index.js');
    const state = { domains: { director: { threads: { th_aaaaaaaa: { id: 'th_aaaaaaaa', kind: 'secret', key: 'Bell Curse', summary: 'x', fields: {}, status: 'active' } }, keys: {} }, arc: { arcs: { arc_aaaaaaaa: { id: 'arc_aaaaaaaa', key: 'The Drowned Bell', desc: '' } } } } };
    const day = knownDay({
        day: 1, date: 'June 3, 1200', short: 'New arc: The Drowned Bell (1 beat)', brief: false, count: 3, more: 0,
        places: [], quests: { taken: [], done: [], failed: [], dropped: [] }, fights: { count: 0, won: 0, lost: 0, fled: 0 }, money: { in: 0, out: 0 },
        happened: ['New arc: The Drowned Bell (1 beat).', 'Arc ended: The Drowned Bell (every beat played out).', 'Astra finds a coin.', 'A rumour of the Bell Curse.'],
        world: ['World: Bell Curse looms — whispered.', 'World: Red Plague is ongoing.'], npcs: [], met: [], facts: [],
    }, hiddenNames(state));
    assert.deepEqual(day.happened, ['Astra finds a coin.']);
    assert.deepEqual(day.world, ['World: Red Plague is ongoing.']);
    assert.doesNotMatch(day.short, /Drowned Bell/);
    assert.doesNotMatch(day.search, /Drowned Bell|Bell Curse/);
});

test('the day digest off: the Journal says so and shows nothing; the World view still works', async () => {
    const host = await story();
    host.features.set(DIGEST_FEATURE, false);
    const { world, journal } = worldData(host);
    host.close();
    assert.equal(journal.on, false);
    assert.deepEqual(journal.days, []);
    assert.equal(world.here.place.name, 'Harbour');
    const { el } = drawWorld({ world, journal }, { draft: { view: 'journal' } });
    assert.match(squash(el.textContent), /The day digest is off/);
});

test('the World feature off: its queries answer nothing', async () => {
    const host = await story();
    host.features.set(FEATURE, false);
    let world;
    try { world = host.sdk.query('director.world'); } catch { world = null; }
    host.close();
    assert.equal(world ?? null, null);
});

test('replay: after a swipe and a middle delete, World and Journal are what a rebuild gives, and the deleted reply\'s facts are gone', async () => {
    const host = await story();
    await host.send('Sleep.', said('Night falls.', ['~ time June 5, 1200, 07:00 am']));
    await host.swipe(said('Night falls hard.', ['~ time June 5, 1200, 07:30 am', '+ present Wynn']));
    const live = JSON.stringify(worldData(host));
    host.store.rebuild();
    assert.equal(JSON.stringify(worldData(host)), live, 'swipe: rebuild != live');
    assert.ok(worldData(host).world.here.present.includes('Wynn'));
    // Delete the exchange that brought Kell into the scene.
    const chat = host.ctx.chat;
    const user = chat.findIndex(message => message.is_user && /Look round/.test(message.mes));
    await host.st.deleteMessage(user + 1);
    await host.st.deleteMessage(user);
    assert.deepEqual(host.store.problems().map(problem => problem.why ?? problem.message), []);
    const after = JSON.stringify(worldData(host));
    host.store.rebuild();
    assert.equal(JSON.stringify(worldData(host)), after, 'middle delete: rebuild != live');
    const { world, journal } = worldData(host);
    host.close();
    assert.ok(!world.here.present.includes('Kell'));
    assert.ok(!JSON.stringify(journal).includes('Kell'), 'Kell met only in the deleted reply');
    assert.deepEqual(leaks(world), []);
    assert.deepEqual(leaks(journal), []);
});

test('holidays: the pack calendar\'s, within the range, only on that calendar; none without a pack', () => {
    const months = [{ name: 'Dawnwane', days: 30 }, { name: 'Goldwane', days: 30 }];
    const calendar = makeCalendar({ months });
    const now = calendar.toAbs({ year: 611, month: 0, day: 20 });
    const pack = { pack: 'p', months, holidays: [{ name: 'Lantern Night', month: 'Goldwane', day: 2 }, { name: 'First Light', month: 1, day: 1 }, { name: 'Far Day', month: 'Goldwane', day: 30 }, { name: 'Bad', month: 'Nomonth', day: 1 }] };
    const query = name => (name === 'packs.calendar' ? pack : null);
    assert.deepEqual(holidays(query, calendar, now, 15).map(item => [item.name, item.inDays]), [['Lantern Night', 12]]);
    // First Light (Dawnwane 1) is next year's: 610 days off.
    assert.deepEqual(holidays(query, calendar, now, 60).map(item => [item.name, item.inDays]), [['Lantern Night', 12], ['Far Day', 40], ['First Light', 41]]);
    assert.deepEqual(holidays(() => null, calendar, now, 60), [], 'no pack');
    assert.deepEqual(holidays(name => (name === 'packs.calendar' ? { ...pack, holidays: undefined } : null), calendar, now, 60), [], 'a pack without holidays');
    assert.deepEqual(holidays(query, makeCalendar('gregorian'), now, 60), [], 'the chat is on another calendar');
    assert.deepEqual(holidays(query, calendar, null, 60), [], 'no story time');
});

test('Story Director alone with no scene, no clock and no chronicle: plain sentences, no warnings', async () => {
    const host = await worldHost();
    const data = worldData(host);
    host.close();
    assert.equal(data.world.here.place, null);
    assert.deepEqual(data.world.here.people, []);
    const { el, warnings } = drawWorld(data);
    assert.deepEqual(warnings, []);
    const textOf = squash(el.textContent);
    for (const phrase of ['Nowhere named yet.', 'No one else is in the scene.', 'The story\'s clock is not set', 'No news yet.', 'No factions known yet.']) assert.ok(textOf.includes(phrase), phrase);
    assert.ok(createModule().screens.some(screen => screen.id === WORLD_ID));
});

// FL-live3 (final live check, "weather"): with World in the panel, Story Block's Scene tab (which shows the
// weather) is hidden, so the weather had no place in the panel; only the reply's Status card showed it. Here
// shows it now, by rule with no `~ weather` line and the story's own over it.
test('Here shows the weather: the rule\'s with no ~ weather line, the story\'s over it for the day, the rule\'s again on a new day', async () => {
    const host = await worldHost();
    const here = () => host.sdk.query('director.world.here');
    try {
        assert.equal(here().weather, '', 'no reply yet, no weather');
        await host.send('Hello.', said('The harbour at dawn.', ['~ time June 3, 1200, 08:00 am', '~ place Harbour']));
        const ruled = here().weather;
        assert.ok(ruled.length > 0, `the rule's weather with no ~ weather line: "${ruled}"`);
        assert.equal(ruled, host.sdk.query('scene.weather').text, 'the same words the Status card shows');
        const drawn = drawWorld(worldData(host));
        assert.deepEqual(drawn.warnings, []);
        assert.ok(squash(drawn.el.textContent).includes(`Weather ${ruled}`), squash(drawn.el.textContent).slice(0, 200));
        await host.send('The rain sets in.', said('Rain falls hard.', ['~ weather heavy rain']));
        assert.equal(here().weather, 'heavy rain', 'the story\'s own word wins');
        assert.ok(squash(drawWorld(worldData(host)).el.textContent).includes('Weather heavy rain'));
        await host.send('Later that day.', said('The rain goes on.', []));
        assert.equal(here().weather, 'heavy rain', 'it stands for the rest of that day and place');
        await host.send('Days later.', said('Another morning.', ['~ time June 9, 1200, 08:00 am']));
        assert.notEqual(here().weather, 'heavy rain', 'a new day brings the rule\'s weather back');
        assert.ok(here().weather.length > 0);
    } finally {
        host.close();
    }
});

test('Here has no Weather row while the weather is off or there is none', async () => {
    const host = await worldHost({ features: { 'story-block.weather': false } });
    try {
        await host.send('Hello.', said('The harbour at dawn.', ['~ time June 3, 1200, 08:00 am', '~ place Harbour', '~ weather fog']));
        const data = worldData(host);
        assert.equal(data.world.here.weather, '');
        const drawn = drawWorld(data);
        assert.ok(!squash(drawn.el.textContent).includes('Weather'), 'no row, no heading, no empty line');
    } finally {
        host.close();
    }
});
