// rx-timeline (beta rolling attack), SB-storage x SD-digest: Story Block now drops `data` from receipts
// 200 or more carriers before the head ("nothing reads data after its reply is shown"). The day digest
// does: walkDays follows the clock through the receipts' `data.minutes` (capture.time, time.settle,
// director.seed), and the facts read money, fights, places and NPC stages from `data`. In a chat whose
// clock was last set more than 200 carriers back, the walk finds no clock until the reply that turned
// the day, so every receipt of the finished day is put on the new day and the finished day gets no
// digest at all.
// Run against Story Block with the trim: STORY_BLOCK_DIR=<Story_block checkout> node --test …
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createModule } from '../../../src/v2/module.js';
import { orderedDays } from '../../../src/v2/chronicle/days.js';

const dir = process.env.STORY_BLOCK_DIR ? path.resolve(process.env.STORY_BLOCK_DIR) : null;
const { createHost } = await import(dir ? pathToFileURL(path.join(dir, 'testkit/index.js')).href : '../../vendor/story-block/testkit/index.js');

const said = (text, lines) => `${text}\n<Changes>\n${lines.join('\n')}\n</Changes>`;

test('a long day (210 replies) still gets its digest once old receipts are trimmed', { timeout: 600000 }, async t => {
    t.mock.method(console, 'warn', () => {});
    const host = await createHost({ modules: [createModule()] });
    try {
        await host.send('Hello.', said('The road.', ['~ time June 3, 1200, 08:00 am', '~ place Bluewatch', '+ coin 5']));
        for (let n = 1; n <= 210; n += 1) await host.send(`On (${n}).`, said(`Reply ${n}.`, [`+ hook Rumor ${n} — talk in the inn`]));
        await host.send('Sleep.', said('Morning comes.', ['! time +1d']));
        await host.send('Up.', 'A new day.');
        const days = orderedDays(host.head().domains.chronicle);
        const june3 = days.find(day => day.date.startsWith('June 3'));
        assert.ok(june3, `June 3 has a digest (days: ${JSON.stringify(days.map(day => [day.date, day.count]))})`);
        assert.ok(june3.count >= 200, `June 3 holds its ${june3.count} receipts`);
        assert.ok(june3.places.includes('Bluewatch'), 'and its place');
    } finally {
        host.close();
    }
});
