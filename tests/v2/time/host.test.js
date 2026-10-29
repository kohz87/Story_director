// The time part on the real Story Block v2 host (the vendored runtime and testkit), merged into
// the module with the other parts the way module.js does: replies with <Changes> blocks, the
// interceptor's beforeGenerate, swipes. The reader's calendar is the default (Gregorian) here.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createHost } from '../../vendor/story-block/testkit/index.js';
import { PARTS, createModule } from '../../../src/v2/module.js';
import { part as time } from '../../../src/v2/time/index.js';
import { fakeFightRunner } from '../integration/helpers/fake-fight-runner.js';

const STATIC_KEY = 'story_suite_static';
const TAIL_KEY = 'story_suite_tail_1';
const sent = (host, key) => host.st.promptLog.filter(entry => entry.key === key && entry.value).map(entry => entry.value);
const reply = (text, lines = []) => (lines.length ? `${text}\n<Changes>\n${lines.join('\n')}\n</Changes>` : text);
const newHost = () => createHost({ modules: [fakeFightRunner(), createModule({ parts: [...PARTS.filter(([id]) => id !== 'time'), ['time', time]] })] });

test('on the host: the lapse is told once in [Happened], the recap once in the tail, both again on a swipe', async () => {
    const host = await newHost();
    await host.send('Evening.', reply('The inn is loud.', [
        '~ time June 3, 1200, 08:00 pm',
        '+ hook Rat Culling — rats in the granary | giver: Danique | reward: 5 gold | due: June 4, 1200',
        '+ event Stray Oar — the inn | then: sacked by the guild | on: June 5, 1200',
    ]));
    await host.send('I sleep for days.', reply('You wake stiff.', ['! time +3d']));
    // The reply after the jump.
    await host.send('What happened?', reply('The square is quiet.'));
    const tail = sent(host, TAIL_KEY).at(-1);
    assert.match(tail, /\[Happened\]\nLapsed: Rat Culling \(Danique's offer\) went to someone else; Danique may mention it\./);
    assert.match(tail, /\n\[While away\] June 3, 08:00 pm → June 6, 08:00 pm: Stray Oar — sacked by the guild \(June 5, 1200\)\. /);
    const rats = host.sdk.query('director.thread', { key: 'Rat Culling' });
    assert.deepEqual([rats.status, rats.ended.reason, rats.ended.outcome], ['resolved', 'offer lapsed', 'failed']);
    assert.equal(host.head().meta.claims[`lapse:${rats.id}`], true);

    // A swipe of that reply is told both again.
    await host.swipe('The square is still.');
    const again = sent(host, TAIL_KEY).at(-1);
    assert.ok(again.includes('Lapsed: Rat Culling'));
    assert.ok(again.includes('[While away]'));

    // The reply after that: neither.
    await host.send('I walk on.', reply('The road is long.'));
    const later = sent(host, TAIL_KEY).at(-1) ?? '';
    assert.ok(!later.includes('Lapsed: Rat Culling'));
    assert.ok(!later.includes('[While away]'));
    assert.equal(host.sdk.query('time.recap'), null);

    // The static part never changed.
    assert.equal(new Set(sent(host, STATIC_KEY)).size, 1);
    host.close();
});

test('on the host: swiping the reply where time passed takes the lapse back; replay equals rebuild', async () => {
    const host = await newHost();
    await host.send('Evening.', reply('The inn is loud.', [
        '~ time June 3, 1200, 08:00 pm',
        '+ hook Rat Culling — rats in the granary | giver: Danique | reward: 5 gold | due: June 4, 1200',
    ]));
    await host.send('I sleep for days.', reply('You wake stiff.', ['! time +3d']));
    await host.send('Well?', reply('Morning.'));
    assert.equal(host.sdk.query('director.thread', { key: 'Rat Culling' }).status, 'resolved');
    const head = JSON.stringify(host.head());
    host.store.rebuild();
    assert.equal(JSON.stringify(host.head()), head, 'replay equals rebuild');
    // Regenerate the morning, then swipe the reply where three days passed into one where an hour did.
    for (let i = 0; i < 2; i += 1) await host.st.deleteMessage(host.ctx.chat.length - 1);
    await host.swipe(reply('You doze an hour.', ['! time +1h']));
    await host.send('Well?', reply('Evening still.'));
    const rats = host.sdk.query('director.thread', { key: 'Rat Culling' });
    assert.equal(rats.status, 'active');
    assert.equal(host.head().meta.claims[`lapse:${rats.id}`], undefined);
    host.close();
});
