// The cast moves off-screen only when the story day changes or time skips: one planner call, asked after the reply that moved the clock
// and used before the next one; one short line per person and only where something changed; a goal the planner judges the story touched
// brings the person to the party (with its reason); a death only where it is allowed. The narrator never sees any of it.
import test from 'node:test';
import assert from 'node:assert/strict';

import { castPlans } from '../../../src/v2/cast/index.js';
import { OPENING, castCue, castHost, castSource, createFakeModel, withRoads, entry, people, receipts, said, sent, settle, slice, validatorErrors, TAIL_KEY } from './helpers.js';

const FENNA = entry('fenna', { start: { place: 'Bluewatch docks', goal: 'keep the night ferry running', routine: 'works the night ferry' } });
const SERA = entry('sera', { start: { place: 'Gwenmar', goal: 'find her brother\'s killer', routine: '' }, drawnTo: ['the man you fought at the weir', 'Harrow'] });
const BROM = entry('brom', { start: { place: 'Kesh', goal: 'forge', routine: 'at the forge' } });

const quiet = t => t.mock.method(console, 'warn', () => {});
const DAY2 = ['~ time June 4, 1200, 08:00 am'];

/** A host two replies in (the cast has joined, its day started); the next reply moves the clock a day. */
async function started(options = {}) {
    const host = await castHost(options);
    await host.send('Hello.', said('Dawn.', OPENING));
    await host.send('Look.', said('Smoke.'));
    return host;
}

const ANSWER = [
    '~ cast fenna | Ashford | took the ferry upriver to Ashford for the guild',
    '> cast sera | her hunt for her brother\'s killer led her to the man you fought at the weir',
    '! cast brom | fell from the quarry',
    '~ cast ghost | Nowhere | not in the cast',
].join('\n');

test('a day passes: one planner call after the reply that moved the clock, applied before the next reply; unmet moves stay hidden; a goal brings her, with the reason', async t => {
    quiet(t);
    const model = createFakeModel([ANSWER]);
    const host = await started({ source: withRoads(castSource([FENNA, SERA, BROM])), model });
    try {
        assert.equal(model.calls.length, 0, 'no call while the day is the same');
        await host.send('Sleep.', said('Morning.', DAY2));
        await settle();
        assert.equal(model.calls.length, 1, 'asked once, after the reply');
        // What the planner is told: the cast with goals and routines, the time passed, what the party is near; the story so far.
        const call = model.calls[0];
        assert.match(call.prompt, /- fenna \| Fenna \| goal: keep the night ferry running \| routine: works the night ferry \| now at: Bluewatch docks/);
        assert.match(call.prompt, /- sera \| Sera \| goal: find her brother's killer \| now at: Gwenmar \| .*drawn to: the man you fought at the weir; Harrow \| has not met them/);
        assert.match(call.prompt, /1 day since the cast last moved/);
        assert.match(call.prompt, /Recent story:\n[\s\S]*Morning\./);
        assert.doesNotMatch(call.prompt, /Hidden thing|Never said|weathered/, 'secrets and looks are not the planner\'s business');
        assert.doesNotMatch(call.prompt, /fenna[^\n]*may die/, 'death is allowed for no one');
        await host.send('Where is everyone?', said(`Nobody knows. ${host.everyone()}`));
        assert.equal(model.calls.length, 1, 'used, not asked again');
        const world = people(host);
        assert.deepEqual([world['ersveil:fenna'].where, world['ersveil:fenna'].doing], ['Ashford', 'took the ferry upriver to Ashford for the guild']);
        assert.equal(world['ersveil:brom'].alive, true, 'a death the pack does not allow is not written');
        assert.equal(world['ersveil:brom'].where, 'Kesh');
        // Sera's goal pulls her to the party: she is met, for that reason, this reply.
        assert.deepEqual([world['ersveil:sera'].met.why, world['ersveil:sera'].met.reason], ['goal', 'her hunt for her brother\'s killer led her to the man you fought at the weir.']);
        assert.match(castCue(host), /^\[Cast\] Sera comes into the scene in this reply\./);
        assert.match(castCue(host), /Why now: Her hunt for her brother's killer led her to the man you fought at the weir\. Their own goal brings them/);
        // The cards: the cast moved on (counts, no names of the unmet), and the meeting with its reason.
        const notes = Object.values(slice(host).notes);
        const moved = notes.find(note => note.kind === 'moved');
        assert.deepEqual([moved.head, moved.tag, moved.line], ['While time passed', '1 day', 'The cast moved on']);
        assert.match(moved.rest, /^1 cast member moved on off-screen \(one short line each, only where something changed\)\. You have not met them, so who and where stays hidden\.$/);
        const met = notes.find(note => note.kind === 'met');
        assert.match(met.rest, /^Why: her hunt for her brother's killer led her to the man you fought at the weir\. Their own goal pulls them to you, so they arrive; no roll\./i);
        // No unmet person is in anything the narrator was sent.
        const everything = [...sent(host, 'story_suite_static'), ...sent(host, TAIL_KEY)].join('\n');
        assert.doesNotMatch(everything, /Fenna|Ashford|Bluewatch/, "(Gwenmar is on the map the pack gives, so the route line names it)");
        assert.deepEqual(validatorErrors(host), []);
        assert.deepEqual(host.store.problems(), []);
    } finally {
        host.close();
    }
});

test('a swipe and a Re-read of the reply that used the answer give the same world, and the planner is not asked again; a rebuild agrees', async t => {
    quiet(t);
    const model = createFakeModel([ANSWER, '~ cast fenna | Elsewhere | a different answer']);
    const host = await started({ source: withRoads(castSource([FENNA, SERA])), model });
    try {
        await host.send('Sleep.', said('Morning.', DAY2));
        await settle();
        await host.send('Where is everyone?', said(`Nobody knows. ${host.everyone()}`));
        const plain = () => JSON.stringify(people(host), (key, value) => (key === 'rev' ? undefined : value));
        const before = plain();
        const cue = castCue(host);
        assert.match(cue, /Sera/);
        await host.swipe(said(`Nobody knows, another take. ${host.everyone()}`));
        assert.equal(model.calls.length, 1, 'a swipe rewrites the scene, not who the cast brings');
        assert.equal(plain(), before, 'the same world (the steps ran again on the rewritten reply)');
        assert.equal(people(host)['ersveil:sera'].met.why, 'goal');
        assert.equal(people(host)['ersveil:fenna'].where, 'Ashford');
        // No road from the docks to Ashford: the step keeps her last known place (reach rule 2), and so does every replay of it.
        assert.equal(people(host)['ersveil:fenna'].known[0].where, 'Bluewatch docks');
        assert.equal(castCue(host), cue);
        const afterSwipe = JSON.stringify(host.head());
        assert.equal((await host.sdk.reread(host.ctx.chat.length - 1)).ok, true);
        assert.equal(JSON.stringify(host.head()), afterSwipe, 'a Re-read keeps the steps');
        host.store.rebuild();
        assert.equal(JSON.stringify(host.head()), afterSwipe, 'a rebuild gives the live state');
        assert.equal(receipts(host, 'cast.meet').length, 1);
        assert.equal(receipts(host, 'cast.advance').length, 1);
        assert.deepEqual(validatorErrors(host), []);
    } finally {
        host.close();
    }
});

test('a death off-screen only where the setting or the entry allows it; the dead are not moved or met again', async t => {
    quiet(t);
    const doomed = entry('brom', { start: { place: 'Kesh', goal: 'forge', routine: 'at the forge' }, canDieUnmet: true });
    for (const [label, source, settings] of [['the entry', withRoads(castSource([doomed, FENNA])), {}], ['the setting', withRoads(castSource([BROM, FENNA])), { 'cast.unmetDie': true }]]) {
        const model = createFakeModel(['! cast brom | fell from the quarry\n! cast fenna | slipped on the ice']);
        const host = await started({ source, model, settings });
        try {
            await host.send('Sleep.', said('Morning.', DAY2));
            await settle();
            assert.match(model.calls[0].prompt, /brom[^\n]*may die/, label);
            await host.send('Next.', said(`Quiet. ${host.everyone()}`));
            const world = people(host);
            assert.equal(world['ersveil:brom'].alive, false, `${label}: unmet people can die`);
            assert.equal(world['ersveil:fenna'].alive, label === 'the setting' ? false : true, label);
            assert.deepEqual([world['ersveil:brom'].doing, world['ersveil:brom'].met], ['', null]);
            // The dead are not asked about next time.
            const asked = model.calls.length;
            await host.send('Sleep.', said('Morning.', ['~ time June 5, 1200, 08:00 am']));
            await settle();
            assert.equal(model.calls.length, label === 'the setting' ? asked : asked + 1, 'when no one is left to move, no call');
            if (model.calls.length > asked) assert.doesNotMatch(model.calls.at(-1).prompt, /- brom \|/);
        } finally {
            host.close();
        }
    }
});

test('a failed or empty planner call moves no one, but the day is still counted; with no planner at all the world still meets by place', async t => {
    quiet(t);
    for (const script of [[new Error('rate limited')], ['nothing changed'], []]) {
        const host = await started({ source: withRoads(castSource([FENNA, SERA])), model: createFakeModel(script) });
        try {
            await host.send('Sleep.', said('Morning.', DAY2));
            await settle();
            await host.send('Next.', said(`Quiet. ${host.everyone()}`));
            assert.equal(people(host)['ersveil:fenna'].where, 'Bluewatch docks');
            assert.equal(slice(host).day[0].at, host.head().domains.director.time.minutes, 'the cast\'s day moved on');
            assert.equal(Object.values(slice(host).notes).filter(note => note.kind === 'moved').length, 0, 'no card when nothing changed');
            assert.deepEqual(validatorErrors(host), []);
        } finally {
            host.close();
        }
    }
});

test('a goal the story touches between two days is judged at once: the planner is asked about that person only, once a day, and her reason is on the card', async t => {
    quiet(t);
    const model = createFakeModel(['> cast sera | the fight at the weir reached her']);
    const host = await started({ source: withRoads(castSource([FENNA, SERA])), model });
    try {
        await host.send('Fight.', said('You beat the man you fought at the weir, and the weir runs red.', ['~ time June 3, 1200, 12:30 pm']));
        await settle();
        assert.equal(model.calls.length, 1);
        assert.match(model.calls[0].prompt, /for the people whose drawn-to phrase the recent story touches/);
        assert.match(model.calls[0].prompt, /- sera \| Sera/);
        assert.doesNotMatch(model.calls[0].prompt, /- fenna/, 'only those whose goal was touched');
        await host.send('Rest.', said('Sera rests by the man you fought at the weir.'));
        assert.equal(model.calls.length, 1, 'not asked again the same day');
        const sera = people(host)['ersveil:sera'];
        assert.deepEqual([sera.met.why, sera.met.reason], ['goal', 'the fight at the weir reached her.']);
        assert.equal(people(host)['ersveil:fenna'].met, null);
        assert.deepEqual(validatorErrors(host), []);
    } finally {
        host.close();
    }
});

test('a person who is in the scene, or pinned as a key person, is not moved by the planner', async t => {
    quiet(t);
    const model = createFakeModel(['~ cast sera | Elsewhere | gone']);
    const host = await started({ source: withRoads(castSource([FENNA, SERA, BROM])), model });
    try {
        await host.sdk.command('keypeople.pin', { name: 'Fenna' });
        await host.send('Sleep.', said('Morning.', [...DAY2, '+ present Sera']));
        await settle();
        const prompt = model.calls[0].prompt;
        assert.match(prompt, /- brom \|/, 'the others are asked about');
        assert.doesNotMatch(prompt, /- fenna \|/, 'a key person has the key people track');
        assert.doesNotMatch(prompt, /- sera \|/, 'someone in the scene is where the scene says');
    } finally {
        host.close();
    }
});

test('a plan not asked for after the last reply (a reload): a named connection is asked now and waited for; the chat\'s own is asked now and used by the next reply, never holding this one', async t => {
    quiet(t);
    for (const profile of ['Planner', '']) {
        const model = createFakeModel(['~ cast fenna | Elsewhere | the first answer is not used', '~ cast fenna | Ashford | upriver for the guild']);
        const host = await started({ source: withRoads(castSource([FENNA, SERA])), model, settings: { 'cast.profile': profile } });
        try {
            await host.send('Sleep.', said('Morning.', DAY2));
            await settle();
            castPlans.clear();
            const asked = model.calls.length;
            await host.send('Next.', said(`Quiet. ${host.everyone()}`));
            await settle();
            assert.equal(model.calls.length, asked + 1, `${profile || 'chat'}: asked once`);
            assert.equal(model.calls.at(-1).profile, profile);
            if (profile) assert.equal(people(host)['ersveil:fenna'].where, 'Ashford', 'a named connection is waited for');
            else assert.equal(people(host)['ersveil:fenna'].where, 'Bluewatch docks', 'the chat\'s own is not waited for');
            await host.send('And?', said(`Quiet. ${host.everyone()}`));
            assert.equal(people(host)['ersveil:fenna'].where, 'Ashford', 'used by the next reply');
            assert.equal(model.calls.length, asked + 1);
            assert.deepEqual(validatorErrors(host), []);
        } finally {
            host.close();
        }
    }
});

test('a planner call that fails in transport is made once more: 500 then ok applies the plan, nobody is lost', async t => {
    quiet(t);
    const model = createFakeModel([new Error('Internal Server Error'), '> cast sera | the fight at the weir reached her']);
    const host = await started({ source: withRoads(castSource([FENNA, SERA])), model });
    try {
        await host.send('Fight.', said('You beat the man you fought at the weir, and the weir runs red.', ['~ time June 3, 1200, 12:30 pm']));
        await settle();
        assert.equal(model.calls.length, 2, 'one extra call, only after the failure');
        await host.send('Rest.', said('Sera rests by the man you fought at the weir.'));
        assert.equal(model.calls.length, 2, 'the plan is kept, not asked again');
        assert.deepEqual([people(host)['ersveil:sera'].met.why, people(host)['ersveil:sera'].met.reason], ['goal', 'the fight at the weir reached her.']);
        assert.equal(host.turn.problems().some(item => item.code === 'CAST_PLAN_FAILED'), false);
    } finally {
        host.close();
    }
});

test('a planner call that fails twice: nobody is drawn in and the reply carries a "cast planner failed" problem; a batch failure still counts the day', async t => {
    quiet(t);
    for (const [name, send, next] of [['judge', ['Fight.', said('You beat the man you fought at the weir, and the weir runs red.')], ['Rest.', said('Sera rests by the man you fought at the weir.')]], ['batch', ['Sleep.', said('Morning.', DAY2)], ['Next.', said('Quiet.')]]]) {
        const model = createFakeModel([new Error('Internal Server Error'), new Error('Internal Server Error')]);
        const host = await started({ source: withRoads(castSource([FENNA, SERA])), model });
        try {
            await host.send(...send);
            await settle();
            assert.equal(model.calls.length, 2, `${name}: asked, then once more, no further`);
            await host.send(...next);
            assert.equal(model.calls.length, 2, `${name}: not asked a third time`);
            assert.equal(people(host)['ersveil:sera'].met, null, `${name}: nobody drawn in`);
            const told = () => host.turn.problems().filter(item => item.code === 'CAST_PLAN_FAILED').length;
            assert.equal(told(), 1, `${name}: told once, on the reply it was for`);
            await host.send('Again.', said('Still quiet.'));
            await host.send('And again.', said('Nothing more.'));
            assert.equal(told(), 1, `${name}: later replies of the day are not told again`);
            assert.equal(model.calls.length, 2, `${name}: and still no further call`);
        } finally {
            host.close();
        }
    }
});

test('an answer that does not parse is no transport failure: one call, no retry, no problem', async t => {
    quiet(t);
    const model = createFakeModel(['I cannot help with that.']);
    const host = await started({ source: withRoads(castSource([FENNA, SERA])), model });
    try {
        await host.send('Fight.', said('You beat the man you fought at the weir, and the weir runs red.', ['~ time June 3, 1200, 12:30 pm']));
        await settle();
        await host.send('Rest.', said('Sera rests by the man you fought at the weir.'));
        assert.equal(model.calls.length, 1);
        assert.equal(host.turn.problems().some(item => item.code === 'CAST_PLAN_FAILED'), false);
    } finally {
        host.close();
    }
});

test('a failure is told again on a swipe of the reply it was for, not on later replies', async t => {
    quiet(t);
    const model = createFakeModel([new Error('Internal Server Error'), new Error('Internal Server Error')]);
    const host = await started({ source: withRoads(castSource([FENNA, SERA])), model });
    try {
        const told = () => host.turn.problems().filter(item => item.code === 'CAST_PLAN_FAILED').length;
        await host.send('Fight.', said('You beat the man you fought at the weir, and the weir runs red.', ['~ time June 3, 1200, 12:30 pm']));
        await settle();
        await host.send('Rest.', said('Sera rests by the man you fought at the weir.'));
        assert.equal(told(), 1);
        await host.swipe(said('Sera sits by the man you fought at the weir.'));
        assert.equal(told(), 2, 'the swiped reply is the one it was for');
        await host.send('On.', said('Quiet.'));
        assert.equal(told(), 2);
        assert.equal(model.calls.length, 2);
    } finally {
        host.close();
    }
});

test('an empty answer is not asked again (one call), and a failure that came back after the wait is not either', async t => {
    quiet(t);
    const empty = createFakeModel(['']);
    const one = await started({ source: withRoads(castSource([FENNA, SERA])), model: empty });
    try {
        await one.send('Fight.', said('You beat the man you fought at the weir, and the weir runs red.'));
        await settle();
        assert.equal(empty.calls.length, 1, 'no retry of an empty answer');
    } finally {
        one.close();
    }
    const realNow = Date.now.bind(Date);
    let skew = 0;
    t.mock.method(Date, 'now', () => realNow() + skew);
    const slow = createFakeModel([() => { skew += 20000; throw new Error('Internal Server Error'); }, 'late']);
    const two = await started({ source: withRoads(castSource([FENNA, SERA])), model: slow });
    try {
        await two.send('Fight.', said('You beat the man you fought at the weir, and the weir runs red.'));
        await settle();
        assert.equal(slow.calls.length, 1, 'the reply\'s wait had run out: no second call');
    } finally {
        two.close();
    }
});

test('reach rule 2: a goal pull from three days away sets out on a journey, and the planner does not move a traveller while on the road', async t => {
    quiet(t);
    const source = withRoads(castSource([FENNA, SERA]));
    source.routes = [{ from: 'gwenmar', to: 'harrow', kind: 'road', km: 60, hours: 72 }];
    const model = createFakeModel(['> cast sera | her hunt for her brother\'s killer led her to Harrow', '~ cast sera | Kesh | went to Kesh instead']);
    const host = await started({ source, model });
    try {
        await host.send('Sleep.', said('Morning.', DAY2));
        await settle();
        await host.send('Wait.', said(`Nothing. ${host.everyone()}`));
        const trip = people(host)['ersveil:sera'].coming?.[0];
        assert.ok(trip, 'linked by the place (Harrow) but three days away: a journey, not a meeting');
        assert.equal(people(host)['ersveil:sera'].met, null);
        await host.send('Sleep again.', said('Morning.', ['~ time June 5, 1200, 08:00 am']));
        await settle();
        await host.send('Wait.', said(`Nothing. ${host.everyone()}`));
        assert.equal(model.calls.length, 2, 'the planner was asked for the second day');
        assert.deepEqual([people(host)['ersveil:sera'].where, people(host)['ersveil:sera'].coming?.[0]?.arrive], ['Gwenmar', trip.arrive], 'not moved: still on the trip from Gwenmar');
        assert.deepEqual(validatorErrors(host), []);
    } finally {
        host.close();
    }
});
