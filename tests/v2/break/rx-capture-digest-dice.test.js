// rx-capture (beta rolling attack) on SD #90 (day digest, merged affde13): a day's digest is built from
// every other receipt's summary, so RPG Battle's per-reply dice bookkeeping (checks.prepare, cause
// system, narrate false: "Dice for the next reply: Roll 1 = 20 · Roll 2 = 17 …") becomes the day's
// "happened" and its line, and after a time skip the [Yesterday] tail line repeats an old reply's dice
// next to this reply's own "Dice for this reply" line: two dice lines in one prompt.
// Needs RPG Battle side by side (RPG_BATTLE_DIR, default ../rpg_battle); skipped otherwise.
// Drop into Story_director/tests/v2/break/.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHost } from '../../vendor/story-block/testkit/index.js';
import { createModule } from '../../../src/v2/module.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const rbDir = process.env.RPG_BATTLE_DIR ?? path.resolve(here, '../../../../rpg_battle');
let RB = null;
try { RB = await import(pathToFileURL(path.join(rbDir, 'src/v2/module.js')).href); } catch { RB = null; }
const skip = RB ? false : `RPG Battle is not at ${rbDir}`;
const TAIL_KEY = 'story_suite_tail_1';
const reply = (text, lines = []) => `${text}\n<Changes>\n${lines.join('\n')}\n</Changes>`;

test('rx-capture: the day digest and the [Yesterday] line never carry another reply\'s dice', { skip }, async t => {
    t.mock.method(console, 'warn', () => {});
    let host = null;
    const sd = createModule({ host: { settings: id => host?.sdk.settings(id) ?? null, substitute: text => host?.sdk.substitute(text) } });
    const rb = RB.createModule({ settings: () => host?.sdk.settings(RB.MODULE_ID) ?? {} });
    host = await createHost({ modules: [rb, sd] });
    try {
        const made = await host.sdk.command('party.create', { name: 'Ren', preset: 'fighter' });
        assert.equal(made.ok, true, made.message);
        await host.send('Start.', reply('Morning in Harrow.', ['~ time June 3, 1200, 08:00 am', '~ place Harrow | kind: settlement']));
        await host.send('On.', reply('A day goes by.', ['! time +1d']));
        await host.send('On.', reply('Another day.', ['! time +1d']));
        await host.send('Later.', reply('Ten days pass.', ['! time +10d']));
        await host.send('Now.', 'The road again.');
        const days = host.sdk.query('chronicle.days') ?? [];
        for (const day of days) {
            assert.ok(!/Dice for the next reply/.test(day.line), `the digest line of ${day.date} is the dice: ${day.line}`);
            assert.ok(!(day.happened ?? []).some(item => /Dice for the next reply/.test(item)), `${day.date} "happened" holds the dice bookkeeping`);
        }
        for (const tail of host.st.promptLog.filter(entry => entry.key === TAIL_KEY && entry.value).map(entry => entry.value)) {
            const dice = tail.split('\n').filter(line => /Roll 1 = \d+/.test(line));
            assert.ok(dice.length <= 1, `one prompt holds ${dice.length} dice lines:\n${dice.join('\n')}`);
        }
    } finally { host.close(); }
});
