// The order of a reply's lines does not matter to a trip: `~ trip` declares `after: ['place', 'mount']`, so Story Block (2.11.1 and later)
// runs it behind the reply's `~ place` and `+ mount` lines and plans from the place and the mount pace they set up. An older host reads
// the lines as written (the trip then plans from where the scene was). The host part runs against a Story Block checkout named by
// STORY_BLOCK_DIR (the vendored copy is older and does not reorder).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { createModule } from '../../../src/v2/module.js';

const dir = process.env.STORY_BLOCK_DIR ? path.resolve(process.env.STORY_BLOCK_DIR) : null;
const ERSVEIL = readFileSync(new URL('../../fixtures/ersveil-bluewatch.pack.json', import.meta.url), 'utf8');
const reply = (text, lines) => `${text}\n<Changes>\n${lines.join('\n')}\n</Changes>`;

test('the trip kind is declared to run after the place and mount kinds', () => {
    const module = createModule();
    assert.deepEqual(module.capture.kinds.trip.after, ['place', 'mount']);
    assert.equal(module.capture.kinds.route.after, undefined, 'no other kind of the module is moved');
});

async function hostWith(createHost) {
    let host = null;
    const module = createModule({ host: { settings: id => host?.sdk.settings(id) ?? null, substitute: text => host?.sdk.substitute(text) } });
    host = await createHost({ modules: [module] });
    const installed = await host.packs.packs.install(ERSVEIL, { origin: 'pack.json' });
    assert.equal(installed.ok, true, JSON.stringify(installed.errors));
    return host;
}

test('a trip written before its place and mount lines plans from them, as if written after (needs STORY_BLOCK_DIR at Story Block 2.11.1 or later)', { skip: dir ? false : 'set STORY_BLOCK_DIR to a Story Block checkout' }, async t => {
    t.mock.method(console, 'warn', () => {});
    const { createHost } = await import(pathToFileURL(path.join(dir, 'testkit/index.js')).href);
    const make = async lines => {
        const host = await hostWith(createHost);
        try {
            await host.send('Hello.', reply('The inn.', ['~ time Goldwane 12, 8:00 am']));
            await host.send('We go.', reply('The road.', lines));
            const go = Object.values(host.head().domains.atlas.trips ?? {}).find(record => record.kind === 'go') ?? null;
            const problems = host.turn.problems().map(problem => problem.message);
            return { go: go && { to: go.to, pace: go.pace, mount: go.mount, from: go.legs[0].from, arrive: go.legs.at(-1).arrive }, problems };
        } finally {
            host.close();
        }
    };
    const after = await make(['~ place Bluewatch Village', '+ mount Burr | kind: mule | pace: 25', '~ trip Wolfmere Outpost | by: riding']);
    assert.equal(after.go.from, 'Bluewatch Village');
    assert.equal(after.go.pace, 25);
    assert.equal(after.go.mount, 'Burr');
    const before = await make(['~ trip Wolfmere Outpost | by: riding', '~ place Bluewatch Village', '+ mount Burr | kind: mule | pace: 25']);
    assert.deepEqual(before, after, 'the same trip and no Problem, whatever the order');
    const between = await make(['+ mount Burr | kind: mule | pace: 25', '~ trip Wolfmere Outpost | by: riding', '~ place Bluewatch Village']);
    assert.deepEqual(between, after);
    assert.deepEqual(after.problems.filter(message => /no place|not on the map/i.test(message)), []);
});
