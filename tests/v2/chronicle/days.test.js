// Chronicle part, day digest (pure): which day each receipt belongs to, what a day's facts are made of
// (only code's numbers, receipts' own summaries and names the state keeps), the one line, the caps,
// the validator and the settings.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
    DIGEST_DEFAULTS, FULL_MAX, KEEP_MAX, MAX_HAPPENED, MAX_LINE, briefOf, capDays, cut, dayFacts, dayLine, dayOf, digestSettings,
    makeDigest, moneyText, validateDays, walkDays,
} from '../../../src/v2/chronicle/days.js';
import { initialChronicle, validateChronicle } from '../../../src/v2/chronicle/domain.js';

const DAY = 1440;
const D = 100;   // a story day number
let rev = 0;
const r = (type, fields = {}) => ({ type, module: 'story-director', cause: 'story', summary: '', narrate: false, data: {}, rev: (rev += 1), ...fields });
const clock = (minutes, type = 'capture.time', extra = {}) => r(type, { data: { minutes, ...extra }, summary: 'Story time: …' });
const entries = list => list.map((receipt, index) => ({ index, receipt }));
const factsOf = (list, state = null, day = D) => {
    const walk = walkDays(entries(list));
    return dayFacts(walk.days.get(day) ?? [], { revDay: walk.revs, state, day });
};

test('each receipt belongs to the day the clock was on; before the clock was set, to its first day', () => {
    const early = r('capture.item', { module: 'story-block', summary: 'The party gains Rope.' });
    const morning = r('capture.item', { module: 'story-block', summary: 'The party gains Lamp.' });
    const night = clock(D * DAY + 23 * 60);
    const after = r('capture.item', { module: 'story-block', summary: 'The party gains Bread.' });
    const crossing = clock((D + 1) * DAY + 60);
    const next = r('capture.item', { module: 'story-block', summary: 'The party gains Tea.' });
    const walk = walkDays(entries([early, clock(D * DAY + 8 * 60), morning, night, after, crossing, next]));
    assert.deepEqual([...walk.days.keys()], [D, D + 1]);
    assert.deepEqual(walk.days.get(D).map(entry => entry.summary).filter(text => text.startsWith('The party')), ['The party gains Rope.', 'The party gains Lamp.', 'The party gains Bread.']);
    assert.deepEqual(walk.days.get(D + 1).map(entry => entry.summary), ['Story time: …', 'The party gains Tea.']);
    assert.equal(walk.revs.get(after.rev), D);
    assert.equal(walk.revs.get(next.rev), D + 1);
    assert.equal(dayOf(D * DAY + DAY - 1), D);
    // The time part's settle is the last jump.
    const settled = walkDays(entries([clock(D * DAY, 'time.settle', { from: D * DAY - 600 })]));
    assert.deepEqual(settled.settle, { from: D * DAY - 600, to: D * DAY });
    // Nothing set the clock: no day at all.
    assert.equal(walkDays(entries([early])).days.size, 0);
});

test('a day\'s facts: places, money in and out, fights, NPC stages, world news, from the receipts\' own data', () => {
    const list = [
        clock(D * DAY + 8 * 60),
        r('capture.place', { module: 'story-block', summary: 'The scene moves to Harrow.', data: { name: 'Harrow', moved: true } }),
        r('capture.place', { module: 'story-block', summary: 'Harrow is described anew.', data: { name: 'Harrow', moved: false } }),
        r('capture.place', { module: 'story-block', summary: 'The scene moves to Old Weir.', data: { name: 'Old Weir', moved: true } }),
        r('capture.place', { module: 'story-block', summary: 'The scene moves to harrow.', data: { name: 'harrow', moved: true } }),
        r('capture.coin', { module: 'story-block', summary: 'The party receives 40 gold — from a merchant (now 40 gold).', data: { owner: 'party', amount: 40, now: 40 } }),
        r('capture.coin', { module: 'story-block', summary: 'The party pays 5 gold — to the ferryman (35 gold left).', data: { owner: 'party', amount: 5, now: 35 } }),
        r('wallet.receive', { module: 'story-block', cause: 'ui', summary: 'Ren receives 9 gold (now 9 gold).', data: { owner: 'ac_ren00000', amount: 9, now: 9 } }),
        r('wallet.pay', { module: 'story-block', cause: 'ui', summary: 'The party pays 3 gold (32 gold left).', data: { owner: 'party', amount: 3, now: 32 } }),
        r('quest.finish', { summary: 'You turn in Rat Cellar: 3 rats beaten (target 3), 30 gold paid.', narrate: true, data: { quest: 'th_aaaaaaaa', paid: { amount: 30 } } }),
        r('capture.quest', { summary: 'You turn in Lost Ring: goal met, 12 gold paid.', narrate: true, data: { thread: 'th_bbbbbbbb', turnIn: { paid: { amount: 12 } } } }),
        r('combat.end', { module: 'rpg-battle', summary: 'Victory over 2 Wolves: 7 gold.', narrate: true, data: { session: 'fs_1', outcome: 'won', foes: [], loot: { money: 7, items: [] } } }),
        r('combat.flee', { module: 'rpg-battle', summary: 'You get away from the Troll.', narrate: true, data: { session: 'fs_2', outcome: 'fled', foes: [] } }),
        r('combat.act', { module: 'rpg-battle', summary: 'Ren hits the Troll.', data: { session: 'fs_2', status: 'active' } }),
        r('trade.sell', { module: 'rpg-battle', cause: 'ui', summary: 'Sold Rope for 4 gold.', data: { kind: 'sell', total: 4 } }),
        r('trade.buy', { module: 'rpg-battle', cause: 'ui', summary: 'Bought Lamp for 6 gold.', data: { kind: 'buy', total: 6 } }),
        r('capture.npc', { module: 'npc-state-delta', summary: 'Mira: trust reached Friend. Mira: trust 18 → 25.', narrate: true, data: { name: 'Mira', stages: [{ meter: 'trust', from: 'Wary', to: 'Friend' }] } }),
        r('capture.npc', { module: 'npc-state-delta', summary: 'Mira: trust reached Ally.', narrate: true, data: { name: 'Mira', stages: [{ meter: 'trust', from: 'Friend', to: 'Ally' }] } }),
        r('capture.npc', { module: 'npc-state-delta', summary: 'Brom: tension 5 → 9.', data: { name: 'Brom', stages: [] } }),
        r('capture.world', { summary: 'World: Red Plague is now looming — coughing.', data: { event: 'ev_aaaaaaaa', created: true } }),
        r('capture.world', { summary: 'World: Red Plague is now ongoing — the docks close.', data: { event: 'ev_aaaaaaaa' } }),
        r('capture.hook', { summary: 'Director: + hook Odd Smell — the model\'s own words here' }),
    ];
    const facts = factsOf(list);
    assert.deepEqual(facts.places, ['Harrow', 'Old Weir']);
    // 40 (coin) + 30 (quest) + 12 (story turn-in) + 7 (loot) + 4 (sale) in; 5 (coin) + 3 (wallet.pay) + 6 (buy) out.
    // Ren's own purse (not the party's) is not the party's money.
    assert.deepEqual(facts.money, { in: 93, out: 14 });
    assert.deepEqual(facts.fights, { count: 2, won: 1, lost: 0, fled: 1 });
    assert.deepEqual(facts.npcs, ['Mira: trust Wary → Ally']);
    assert.deepEqual(facts.world, ['World: Red Plague is now ongoing — the docks close.']);
    // What the story was told comes first; nothing another section tells, no fight blow-by-blow, no echoed line.
    assert.ok(facts.happened.includes('You turn in Rat Cellar: 3 rats beaten (target 3), 30 gold paid.'));
    // Nine left to tell, eight kept: the untold ones go first (the last of them, Brom's numbers).
    assert.equal(facts.happened.length, MAX_HAPPENED);
    assert.equal(facts.more, 1);
    assert.ok(!facts.happened.includes('Brom: tension 5 → 9.'));
    assert.ok(facts.happened.indexOf('Sold Rope for 4 gold.') > facts.happened.indexOf('You get away from the Troll.'), 'kept in the order they came');
    for (const text of facts.happened) {
        assert.doesNotMatch(text, /^Director: |scene moves|receives|Ren hits|^World:/, text);
    }
    assert.equal(facts.count, list.length - 1, 'every receipt but the clock\'s counts');
});

test('a digest holds only code facts: never the reply\'s prose or a model\'s raw line', () => {
    const prose = 'The rain hammered the roofs while Mira whispered a secret plan.';
    const list = [
        clock(D * DAY + 9 * 60),
        // A story line the tracker only echoes, with the model's words in it.
        r('capture.hook', { summary: `Director: + hook Plan — ${prose}`, data: { thread: 'th_cccccccc' } }),
        r('capture.item', { module: 'story-block', summary: 'The party gains Rope.' }),
    ];
    const digest = makeDigest(D, factsOf(list), { date: 'June 3, 1200', made: 9, revs: list.map(entry => entry.rev) });
    const all = JSON.stringify(digest);
    assert.doesNotMatch(all, /rain hammered|secret plan/);
    assert.deepEqual(digest.happened, ['The party gains Rope.']);
    assert.equal(digest.line, 'June 3, 1200: The party gains Rope.');
    assert.deepEqual(validateDays({ days: { [D]: [digest] } }), []);
});

test('quests taken on and ended that day, by the threads\' own stamps', () => {
    const taken = r('capture.quest', { summary: 'Director: + quest Rat Cellar', data: { thread: 'th_aaaaaaaa', taken: true } });
    const list = [clock(D * DAY + 60), taken, r('quest.finish', { narrate: true, summary: 'You turn in Lost Ring.' })];
    const finishRev = list.at(-1).rev;
    const thread = (id, key, fields) => ({ id, key, kind: 'quest', status: 'resolved', track: { order: Number(id.at(-1) === 'a' ? 1 : 2) }, ...fields });
    const state = {
        domains: {
            director: {
                threads: {
                    th_aaaaaaaa: { ...thread('th_aaaaaaaa', 'Rat Cellar', { status: 'active' }), taken: { rev: taken.rev } },
                    th_bbbbbbbb: thread('th_bbbbbbbb', 'Lost Ring', { taken: { rev: 1 }, ended: { rev: finishRev, outcome: 'done' } }),
                    th_cccccccc: thread('th_cccccccc', 'Grain Run', { taken: { rev: 1 }, ended: { rev: 999999, at: D * DAY + 300, outcome: 'failed' } }),
                    th_dddddddd: thread('th_dddddddd', 'Old Debt', { taken: { rev: 1 }, ended: { rev: finishRev, outcome: 'abandoned' } }),
                    th_eeeeeeee: thread('th_eeeeeeee', 'Offer Only', { ended: { rev: finishRev, outcome: 'declined' } }),
                    th_ffffffff: thread('th_ffffffff', 'Yesterday Job', { taken: { rev: 1 }, ended: { at: (D - 1) * DAY, outcome: 'done' } }),
                    th_gggggggg: { id: 'th_gggggggg', key: 'A Hook', kind: 'hook', status: 'resolved', ended: { rev: finishRev, outcome: 'done' } },
                },
            },
        },
    };
    const facts = factsOf(list, state);
    assert.deepEqual(facts.quests, { taken: ['Rat Cellar'], done: ['Lost Ring'], failed: ['Grain Run'], dropped: ['Old Debt'] });
});

test('the one line: the facts in a fixed order, money in the currency, never longer than 200 code points', () => {
    const facts = {
        count: 9, happened: [], more: 0, places: ['Harrow', 'Old Weir'],
        quests: { taken: ['Rat Cellar'], done: ['Lost Ring'], failed: [], dropped: [] },
        fights: { count: 2, won: 2, lost: 0, fled: 0 }, money: { in: 150, out: 20 }, npcs: ['Mira: trust → Friend'], world: ['World: …'],
    };
    const currency = { name: 'mark', plural: 'marks' };
    assert.equal(dayLine('June 3, 1200', facts, { currency }),
        'June 3, 1200: to Harrow, Old Weir; took on Rat Cellar; finished Lost Ring; 2 fights (2 won); 150 marks in, 20 out; 1 NPC stage moved; 1 world event.');
    assert.equal(moneyText({ in: 1, out: 0 }, currency), '1 mark in');
    assert.equal(moneyText({ in: 0, out: 7 }, null), '7 coins out');
    assert.equal(moneyText({ in: 0, out: 0 }, currency), '');
    const many = { ...facts, places: Array.from({ length: 8 }, (_, i) => `🐉 Very Long Place Name Number ${i}`), quests: { taken: Array.from({ length: 6 }, (_, i) => `Quest ${'é'.repeat(30)} ${i}`), done: [], failed: [], dropped: [] } };
    const line = dayLine('June 3, 1200', many, { currency });
    assert.ok(Array.from(line).length <= MAX_LINE);
    assert.match(line, /and 5 more/);
    assert.ok(line.endsWith('…'));
    // Cut by code points: an emoji is never split.
    assert.equal(cut('🐉🐉🐉🐉', 3), '🐉🐉…');
    assert.equal(cut('a\nb​c', 10), 'a b c');
});

test('caps: the newest days stay whole, older ones are kept as their line, the oldest are dropped', () => {
    const days = {};
    for (let day = 1; day <= 6; day += 1) days[day] = makeDigest(day, { count: 1, happened: ['x'], more: 0, places: [], quests: { taken: [], done: [], failed: [], dropped: [] }, fights: { count: 0, won: 0, lost: 0, fled: 0 }, money: { in: 0, out: 0 }, npcs: [], world: [] }, { date: `Day ${day}`, made: day });
    days[3] = briefOf(days[3]);
    const changes = capDays(days, { full: 2, keep: 4 });
    assert.deepEqual(Object.keys(changes).sort(), ['1', '2', '4']);
    assert.equal(changes[1], null);
    assert.equal(changes[2], null);
    assert.deepEqual(changes[4], { day: 4, date: 'Day 4', line: days[4].line, brief: true, count: 1, made: 4 });
    assert.deepEqual(capDays({ 7: days[6] }, { full: 2, keep: 4 }), {});
});

test('settings: whole days 1..60, days kept 1..365 and never fewer than the whole ones; the skip threshold is the recap\'s', () => {
    assert.deepEqual(digestSettings(undefined), { full: DIGEST_DEFAULTS.digestDays, keep: DIGEST_DEFAULTS.digestKeep, tail: true, skipMinutes: 360 });
    assert.deepEqual(digestSettings(() => ({ digestDays: 500, digestKeep: 9999, digestTail: false, recapHours: 12 })), { full: FULL_MAX, keep: KEEP_MAX, tail: false, skipMinutes: 720 });
    assert.deepEqual(digestSettings({ digestDays: 30, digestKeep: 2 }), { full: 30, keep: 30, tail: true, skipMinutes: 360 });
    assert.equal(digestSettings({ digestDays: 'x' }).full, DIGEST_DEFAULTS.digestDays);
    assert.equal(digestSettings(() => { throw new Error('no'); }).full, DIGEST_DEFAULTS.digestDays);
});

test('the validator: days kept under their own day, every field checked, both fields optional', () => {
    const good = makeDigest(D, { count: 1, happened: ['x'], more: 0, places: ['A'], quests: { taken: [], done: [], failed: [], dropped: [] }, fights: { count: 0, won: 0, lost: 0, fled: 0 }, money: { in: 1, out: 0 }, npcs: [], world: [] }, { date: 'June 3', made: 4, revs: [3, 1, 2] });
    assert.deepEqual(good.revs, [1, 3]);
    const chronicle = { ...initialChronicle(), days: { [D]: [good], [D + 1]: [briefOf({ ...good, day: D + 1 })] }, written: [{ through: D + 2, days: [D, D + 1], at: 5, skip: false }] };
    assert.deepEqual(validateChronicle(chronicle), []);
    const { days: _days, written: _written, ...older } = chronicle;
    assert.deepEqual(validateChronicle(older), [], 'a chronicle from before the digest');
    const bad = [
        [{ days: [] }, /chronicle.days is not an object/],
        [{ days: { x: [good] } }, /is not a day/],
        [{ days: { [D + 5]: [good] } }, /kept under another day/],
        [{ days: { [D]: good } }, /must hold one day digest/],
        [{ days: { [D]: [{ ...good, money: { in: -1, out: 0 } }] } }, /money/],
        [{ days: { [D]: [{ ...good, happened: Array(MAX_HAPPENED + 1).fill('x') }] } }, /happened/],
        [{ days: { [D]: [{ ...good, line: 'x'.repeat(MAX_LINE + 1) }] } }, /line/],
        [{ days: { [D]: [{ ...good, extra: 1 }] } }, /unknown field "extra"/],
        [{ days: { [D]: [{ ...briefOf(good), places: [] }] } }, /unknown field "places"/],
        [{ days: { [D]: [{ ...good, fights: { count: 1.5, won: 0, lost: 0, fled: 0 } }] } }, /fights/],
        [{ written: { through: 1, days: [], at: 0, skip: false } }, /chronicle.written/],
        [{ written: [{ through: 1, days: ['a'], at: 0, skip: false }] }, /chronicle.written/],
    ];
    for (const [slice, pattern] of bad) assert.match(validateDays(slice).join(' '), pattern, JSON.stringify(slice).slice(0, 80));
    const tooMany = {};
    for (let day = 0; day <= KEEP_MAX * 2; day += 1) tooMany[day] = [briefOf({ ...good, day })];
    assert.match(validateDays({ days: tooMany }).join(' '), /at most 730 days/);
});

test('RX-cap-5: per-reply bookkeeping (system receipts the story was not told, dice, a character made) is no fact of the day', () => {
    const list = [
        clock(D * DAY + 8 * 60),
        r('checks.prepare', { module: 'rpg-battle', cause: 'system', summary: 'Dice for the next reply: Roll 1 = 20 · Roll 2 = 17.' }),
        r('party.create', { module: 'rpg-battle', cause: 'ui', narrate: true, summary: 'Ren is ready.' }),
        r('creation.finish', { module: 'rpg-battle', cause: 'ui', summary: 'Ren steps out.' }),
        r('module.set.up', { module: 'other', cause: 'system', summary: 'Other module set up.' }),
    ];
    const quietDay = factsOf(list);
    assert.equal(quietDay.count, 0, 'a day of bookkeeping only has no digest');
    assert.deepEqual(quietDay.happened, []);
    // A system receipt the story is told (time closing a quest) is a fact.
    const told = factsOf([...list, r('time.settle-told', { cause: 'system', narrate: true, summary: 'Slipped: Ambush — it happened off-screen.' })]);
    assert.deepEqual([told.count, told.happened], [1, ['Slipped: Ambush — it happened off-screen.']]);
});
