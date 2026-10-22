// Break round, cell 2 (features off → on): `story-director.digest` off while story days pass, then on
// again. Off leaves the state untouched (correct), but once the reader turns the digest back on the days
// that ended while it was off are not written: with nothing written yet, the hook only writes when the
// clock has moved since the time part last settled (`needsDigest`'s `settledDay`), so the Days screen
// stays empty until the story crosses yet another day. Live (p1-c2-off probe): Goldwane 12 and 13 ended
// with the digest off, digest on + a reply → chronicle.days [] and the Days tab "no days".
// The vendored Story Block predates features, so the reader's switch is played by giving the module's
// hook a view whose `feature()` says off/on (exactly what Story Block's sdk view carries, F100).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createHost } from '../../vendor/story-block/testkit/index.js';
import { createModule } from '../../../src/v2/module.js';
import { fakeRpgBattle } from '../integration/helpers/fake-rpg.js';
import { DIGEST_FEATURE } from '../../../src/v2/chronicle/days.js';

const reply = (text, lines = []) => (lines.length ? `${text}\n<Changes>\n${lines.join('\n')}\n</Changes>` : text);

async function hostWithSwitch() {
    const flag = { on: true };
    let host = null;
    const module = createModule({ host: { settings: id => host?.sdk.settings(id) ?? null, substitute: text => host?.sdk.substitute(text) } });
    const original = module.hooks.beforeGenerate;
    module.hooks.beforeGenerate = (view, info) => original({ ...view, feature: id => (id === DIGEST_FEATURE ? flag.on : true) }, info);
    host = await createHost({ modules: [fakeRpgBattle(), module] });
    return { host, flag };
}

test('digest off while two days end, back on: the finished days are written before the next reply', async () => {
    const { host, flag } = await hostWithSwitch();
    try {
        flag.on = false;
        await host.send('Start.', reply('Morning in Harrow.', ['~ time June 3, 1200, 08:00 am', '~ place Harrow', '+ coin 40']));
        await host.send('Sleep.', reply('Night, then a whole day on the road, then night again.', ['! time +40h', '~ place Old Weir']));
        await host.send('Wake.', reply('Day three.', ['+ item Bread']));
        assert.deepEqual(host.sdk.query('chronicle.days'), [], 'nothing written while off (as designed)');
        flag.on = true;
        await host.send('On we go.', reply('Later the same day.', ['! time +1h']));
        const days = host.sdk.query('chronicle.days') ?? [];
        assert.deepEqual(days.map(day => day.date), ['June 3, 1200'], 'the day that ended while the digest was off (June 4 had no receipts) is written once it is on again');
    } finally {
        host.close();
    }
});
