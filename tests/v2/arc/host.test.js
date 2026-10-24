// Arc part on a real Story Block host (the testkit) with a scripted planner (createFakeModel): plan,
// review, accept, discard, plan again; the plan as the Director's own threads; replay after swipes and
// middle deletes; the feature off; Story Director alone; a host without sdk.callModel; planning by itself.
import test from 'node:test';
import assert from 'node:assert/strict';

import { createFakeModel, createHost } from '../../vendor/story-block/testkit/index.js';
import { createModule } from '../../../src/v2/module.js';
import { ACCEPT, END, FEATURE, UPDATE, createArcController } from '../../../src/v2/arc/index.js';
import { FIGHT_RULE, NO_FIGHT_RULE } from '../../../src/v2/arc/plan.js';
import { browserStore, createReveal } from '../../../src/v2/screens/reveal.js';
import { fakeRpgBattle } from '../integration/helpers/fake-rpg.js';

const STATIC_KEY = 'story_suite_static';
const TAIL_KEY = 'story_suite_tail_1';
const sent = (host, key) => host.st.promptLog.filter(entry => entry.key === key && entry.value).map(entry => entry.value);
const said = (text, lines = []) => (lines.length ? `${text}\n<Changes>\n${lines.join('\n')}\n</Changes>` : text);
const threads = (host, kind) => host.sdk.query('director.threads', kind ? { kind } : {});
const arcState = host => host.head().domains.arc;
const trackOf = (host, key) => Object.values(host.head().domains.director.threads).find(thread => thread.key === key)?.track ?? null;

const PLAN = `<think>a bell…</think>
<plan>
ARC: The Drowned Bell — the harbour's old bell rings again
BEAT: Bell Rings — the sunken bell tolls at night | on: in 2 days | place: Harbour | reach: nobody sleeps
BEAT: Diver Missing — a diver does not come up | after: Bell Rings
AGENDA: Mira — wants the bell raised | now: buying rope | then: hires divers
HOOK: Salvage Rights — who owns what the sea gives | reward: 9000 gold
CLOCK: Storm Season — storms close the harbour | due: in 10 days | shown: sign
SECRET: Bell Curse — cast with a drowned man's ashes
ENCOUNTER: Wreckers — 3 wrecker | on: in 3 days
</plan>`;
const PLAN2 = `<plan>
ARC: Second Tide — the guild moves
BEAT: Guild Seizure — the guild claims the quay
AGENDA: Old Tom — guards the bell | now: the quay
</plan>`;

async function setUp({ script = [PLAN], rpg = false, settings = {}, sdkOverride = null } = {}) {
    const model = createFakeModel(script);
    let host = null;
    const module = createModule({ host: { settings: id => host?.sdk.settings(id) ?? null, substitute: text => host?.sdk.substitute(text) } });
    host = await createHost({
        callModel: model,
        modules: [...(rpg ? [fakeRpgBattle()] : []), module],
        settings: { modules: { 'story-director': settings } },
    });
    const store = browserStore(null);
    let chatId = 'chat-1';
    const reveal = createReveal({ store, chatId: () => chatId, settings: () => host.sdk.settings('story-director') });
    const notes = [];
    const arc = createArcController({
        sdk: () => (sdkOverride ? sdkOverride(host.sdk) : host.sdk), chat: () => host.ctx.chat, chatId: () => chatId, store, reveal,
        notify: (kind, text) => notes.push([kind, text]),
    });
    return { host, model, arc, reveal, notes, store, setChat: id => { chatId = id; } };
}

async function opening(host) {
    await host.send('Hello.', said('The harbour at dawn.', ['~ time June 3, 1200, 08:00 am', '+ hook Old Debt — Mira owes the guild', '+ agenda Mira — keeps to herself | now: the docks']));
}

test('plan, review, accept: the arc and its threads are the Director\'s own; the tail names the arc; the static part never changes', async t => {
    t.mock.method(console, 'warn', () => {});
    t.mock.method(console, 'info', () => {});
    const { host, model, arc } = await setUp({ settings: { 'arc.genre': 'nautical mystery', 'arc.profile': 'Planner' } });
    await opening(host);
    const before = JSON.stringify(host.head());
    const out = await arc.plan();
    assert.equal(out.ok, true, out.message);
    // The planner call: its own profile, the feature, the story and the tracker in the prompt.
    assert.equal(model.calls.length, 1);
    const [call] = model.calls;
    assert.equal(call.profile, 'Planner');
    assert.match(call.system, /Genre and tone: nautical mystery/);
    assert.match(call.system, /Mira — keeps to herself|Mira — the docks/);
    assert.match(call.system, /The harbour at dawn\./);
    assert.doesNotMatch(call.system, /<Changes>|~ time/, 'the hidden change lines are not part of the story it reads');
    assert.ok(call.system.includes(NO_FIGHT_RULE), 'no fight runner: no fights asked for');
    assert.equal(call.maxTokens, 1500);
    // Nothing is written until the reader accepts.
    assert.equal(JSON.stringify(host.head()), before, 'a waiting plan is not story state');
    const { draft } = arc.status();
    assert.match(draft.text, /^ARC: The Drowned Bell/);
    assert.doesNotMatch(draft.text, /reward|9000/);
    assert.ok(draft.findings.some(entry => /no module runs fights/.test(entry.text)));

    const accepted = await arc.accept();
    assert.equal(accepted.ok, true, accepted.message);
    assert.equal(arc.status().draft, null);
    const query = host.sdk.query('director.arc');
    assert.equal(query.current.key, 'The Drowned Bell');
    assert.deepEqual(query.current.beats, { done: 0, total: 3 });
    const id = query.current.id;
    assert.match(id, /^arc_[0-9a-z]{8}$/);
    for (const key of ['Bell Rings', 'Diver Missing', 'Salvage Rights', 'Storm Season', 'Bell Curse', 'Wreckers']) assert.equal(trackOf(host, key)?.arc, id, key);
    assert.equal(threads(host, 'beat').find(thread => thread.key === 'Wreckers').fields.encounter, undefined);
    assert.equal(threads(host, 'hook').find(thread => thread.key === 'Salvage Rights').fields.reward, undefined, 'no amount from the planner');
    // Mira was tracked already: her plan is a change of its own (director.arc.update), tagged too.
    const types = host.sdk.receipts().map(entry => entry.receipt.type);
    assert.deepEqual(types.filter(type => type.startsWith('director.arc')), [ACCEPT, UPDATE]);
    const mira = threads(host, 'agenda').find(thread => thread.key === 'Mira');
    assert.equal(mira.fields.now, 'buying rope');
    assert.equal(trackOf(host, 'Mira').arc, id);
    assert.deepEqual(host.store.problems(), []);

    await host.send('I walk the quay.', said('Gulls cry.'));
    const tail = sent(host, TAIL_KEY).at(-1);
    assert.match(tail, /Arc: The Drowned Bell — the harbour's old bell rings again/);
    assert.match(tail, /Bell Rings/);
    const statics = sent(host, STATIC_KEY);
    assert.equal(new Set(statics).size, 1, 'the static part is the same bytes before and after the plan');
    // End arc: kept by key; the beats stay open threads.
    const ended = await arc.end();
    assert.equal(ended.ok, true, ended.message);
    assert.equal(host.sdk.query('director.arc').current.active, false);
    assert.equal(threads(host, 'beat').filter(thread => thread.status === 'active').length, 3);
    await host.send('Then?', said('Rain.'));
    assert.doesNotMatch(sent(host, TAIL_KEY).at(-1), /Arc: /);
    assert.equal((await host.sdk.command(END, {})).code, 'REFUSED', 'no arc is running');
    host.close();
});

test('discard and plan again: nothing written; another plan replaces the waiting one; the edited text is what is read', async t => {
    t.mock.method(console, 'warn', () => {});
    t.mock.method(console, 'info', () => {});
    const { host, model, arc } = await setUp({ script: [PLAN, PLAN2, 'no plan here, sorry', new Error('rate limited')] });
    await opening(host);
    const rev = host.head().meta.rev;
    await arc.plan();
    assert.ok(arc.status().draft);
    arc.discard();
    assert.equal(arc.status().draft, null);
    assert.equal(host.head().meta.rev, rev, 'discard writes nothing');
    await arc.plan();
    assert.match(arc.status().draft.text, /^ARC: Second Tide/);
    // The reader edits the plan: a name changed, an amount slipped in; code reads it again.
    const edited = arc.status().draft.text.replace('Guild Seizure', 'Guild Raid').concat('\nHOOK: Bribe — a purse | reward: 500 gold');
    assert.equal((await arc.accept(edited)).ok, true);
    assert.ok(threads(host, 'beat').some(thread => thread.key === 'Guild Raid'));
    assert.equal(threads(host, 'hook').find(thread => thread.key === 'Bribe').fields.reward, undefined);
    // A useless answer and a failed call: an error to read, no plan, nothing written.
    const rev2 = host.head().meta.rev;
    assert.equal((await arc.plan()).ok, false);
    assert.match(arc.status().error, /The plan could not be used: .*no ARC line/);
    assert.equal((await arc.plan()).ok, false);
    assert.match(arc.status().error, /Planning failed: /);
    assert.equal(arc.status().draft, null);
    assert.equal(host.head().meta.rev, rev2);
    assert.equal(model.calls.length, 4);
    // A plan sent by hand with nothing in it is refused, nothing saved.
    assert.equal((await host.sdk.command(ACCEPT, { plan: 'ARC: Empty — nothing' })).code, 'INVALID');
    assert.equal(host.head().meta.rev, rev2);
    host.close();
});

test('replay: swipes and middle deletes keep live and rebuilt state the same; deleting the plan\'s reply takes it back', async t => {
    t.mock.method(console, 'warn', () => {});
    t.mock.method(console, 'info', () => {});
    const { host, arc } = await setUp({ script: [PLAN, PLAN2, PLAN] });
    await opening(host);
    await host.send('Morning.', said('The market.', ['+ hook Market Rumour — fish prices']));
    await host.send('Noon.', said('The quay.', ['+ agenda Old Tom — mends nets | now: the quay']));
    await arc.plan();
    assert.equal((await arc.accept()).ok, true);
    const arcId = host.sdk.query('director.arc').current.id;
    await host.send('Evening.', said('The tavern.', ['~ beat Bell Rings | place: the tavern', '+ hook Tavern Brawl — a fight brews']));
    await host.send('Night.', said('The bell!', ['- beat Bell Rings — it rang']));
    const check = (where, { problems = true } = {}) => {
        if (problems) assert.deepEqual(host.store.problems(), [], `${where}: every block still applies`);
        const live = JSON.stringify(host.head());
        host.store.rebuild();
        assert.equal(JSON.stringify(host.head()), live, `${where}: rebuild == live`);
    };
    check('after the plan');
    // A middle delete of an exchange the plan does not lean on (the market).
    const market = host.ctx.chat.findIndex(message => /The market\./.test(message.mes));
    await host.st.deleteMessage(market);
    await host.st.deleteMessage(market - 1);
    check('after a middle delete');
    assert.equal(host.sdk.query('director.arc').current.id, arcId);
    assert.deepEqual(host.sdk.query('director.arc').current.beats, { done: 1, total: 3 });
    // A swipe of the head reply.
    await host.swipe(said('The bell, again.', ['+ hook Echo — the bell echoes']));
    check('after a swipe');
    // A fresh host loading the chat replays to the same state.
    const again = await createHost({ modules: [createModule()] });
    await again.st.loadChat(structuredClone(host.ctx.chat));
    assert.deepEqual(again.store.problems(), []);
    assert.equal(JSON.stringify(again.head().domains), JSON.stringify(host.head().domains), 'a fresh load == live');
    again.close();
    // Deleting the reply that holds the plan takes the arc and its new threads away; the rest stays.
    const holder = host.ctx.chat.findIndex(message => /The quay\./.test(message.mes));
    await host.st.deleteMessage(holder);
    await host.st.deleteMessage(holder - 1);
    assert.equal(host.sdk.query('director.arc').current, null);
    assert.equal(threads(host).some(thread => thread.key === 'Diver Missing'), false);
    assert.ok(threads(host).some(thread => thread.key === 'Old Debt'));
    assert.ok(threads(host).some(thread => thread.key === 'Tavern Brawl'), 'a later reply\'s own thread stays');
    // Only the story's own line about a beat that went with the plan no longer applies (as for any thread).
    assert.deepEqual(host.store.problems().map(problem => /\/domains\/director\/threads\/th_[0-9a-z]{8}\/fields\/place/.test(problem.why)), [true]);
    check('after the plan\'s reply went', { problems: false });
    // Two arcs one after another: the newer supersedes the older without writing into it.
    await arc.plan();
    await arc.accept();
    await arc.plan();
    await arc.accept();
    assert.equal(Object.keys(arcState(host).arcs).length, 2);
    assert.equal(host.sdk.query('director.arc').current.key, 'The Drowned Bell');
    assert.equal(host.sdk.query('director.arc').previous.key, 'Second Tide');
    assert.deepEqual(arcState(host).ends, {}, 'superseded, never written into');
    check('two arcs', { problems: false });
    host.close();
});

test('the feature off: no call, commands refused, query null, no tail, panel hidden; on again, all is back', async t => {
    t.mock.method(console, 'warn', () => {});
    t.mock.method(console, 'info', () => {});
    const { host, model, arc } = await setUp({ script: [PLAN] });
    await opening(host);
    await arc.plan();
    await arc.accept();
    const kept = JSON.stringify(host.head().domains.arc);
    host.features.set(FEATURE, false);
    assert.equal((await arc.plan()).ok, false);
    assert.equal(model.calls.length, 1, 'no model call while it is off');
    assert.equal((await host.sdk.command(END, {})).code, 'FEATURE_OFF');
    assert.equal((await host.sdk.command(ACCEPT, { plan: PLAN })).code, 'FEATURE_OFF');
    assert.equal(host.sdk.query('director.arc'), null);
    assert.equal((await host.sdk.callModel({ feature: FEATURE, prompt: 'x' })).error, 'FEATURE_OFF');
    await host.send('Go on.', said('Fog.'));
    assert.doesNotMatch(sent(host, TAIL_KEY).at(-1), /Arc: /);
    assert.equal(JSON.stringify(host.head().domains.arc), kept, 'its state is never touched');
    const defs = host.registry.settingsDefs().find(entry => entry.moduleId === 'story-director');
    assert.equal(defs.schema['arc.profile'].feature, FEATURE);
    assert.equal(typeof defs.section, 'function');
    assert.equal(defs.section.feature, FEATURE);
    host.features.set(FEATURE, true);
    assert.equal(host.sdk.query('director.arc').current.key, 'The Drowned Bell');
    await host.send('And?', said('Sun.'));
    assert.match(sent(host, TAIL_KEY).at(-1), /Arc: The Drowned Bell/);
    host.close();
});

test('Story Director alone vs with a fight runner: fights asked for only when a module runs them', async t => {
    t.mock.method(console, 'warn', () => {});
    t.mock.method(console, 'info', () => {});
    const alone = await setUp({ script: [PLAN] });
    await opening(alone.host);
    await alone.arc.plan();
    assert.ok(alone.model.calls[0].system.includes(NO_FIGHT_RULE));
    await alone.arc.accept();
    assert.equal(alone.host.sdk.modules().filter(entry => entry.id !== 'story-block').length, 1);
    assert.ok(alone.host.sdk.query('director.arc').current);
    alone.host.close();
    const both = await setUp({ script: [PLAN], rpg: true });
    await opening(both.host);
    await both.arc.plan();
    assert.ok(both.model.calls[0].system.includes(FIGHT_RULE));
    await both.arc.accept();
    assert.equal(threads(both.host, 'beat').find(thread => thread.key === 'Wreckers').fields.encounter, '3 wrecker');
    both.host.close();
});

test('a Story Block without sdk.callModel: arc planning says which Story Block it needs, and does nothing', async t => {
    t.mock.method(console, 'warn', () => {});
    t.mock.method(console, 'info', () => {});
    const { host, arc } = await setUp({ sdkOverride: sdk => ({ ...sdk, callModel: undefined }) });
    await opening(host);
    const status = arc.status();
    assert.equal(status.available, false);
    assert.match(status.needs, /Arc planning needs Story Block 2\.0\.0-beta\.1 or newer/);
    assert.equal((await arc.plan()).ok, false);
    assert.equal(host.sdk.query('director.arc').current, null);
    host.close();
});

test('planning by itself: no arc, every beat played out (ended first), not while a plan waits; used without review', async t => {
    t.mock.method(console, 'warn', () => {});
    t.mock.method(console, 'info', () => {});
    const { host, model, arc, notes } = await setUp({ script: [PLAN, PLAN2], settings: { 'arc.trigger': 'auto' } });
    await opening(host);
    // The story has threads and no arc: a plan is asked for and waits.
    await arc.onTurn({ index: 1, type: 'normal' });
    assert.equal(model.calls.length, 1);
    assert.ok(arc.status().draft);
    assert.match(notes.at(-1)[1], /the story had no arc/);
    await arc.onTurn({ index: 1, type: 'normal' });
    assert.equal(model.calls.length, 1, 'not while a plan waits for review');
    await arc.accept();
    await arc.onTurn({ index: 1, type: 'normal' });
    assert.equal(model.calls.length, 1, 'the arc has beats to play');
    // Every beat plays out: the arc is ended, and the next one planned (used at once now).
    await host.send('Go.', said('All of it happens.', ['- beat Bell Rings — rang', '- beat Diver Missing — found', '- beat Wreckers — driven off']));
    host.settings.set('story-director', 'arc.autoAccept', true);
    await arc.onTurn({ index: 3, type: 'normal' });
    assert.equal(model.calls.length, 2);
    const ends = Object.values(arcState(host).ends);
    assert.deepEqual(ends.map(end => end.reason), ['every beat played out']);
    assert.equal(host.sdk.query('director.arc').current.key, 'Second Tide');
    assert.equal(arc.status().draft, null);
    // Re-reads and late lines are not a reply.
    assert.equal(await arc.onTurn({ type: 'reread' }), null);
    host.close();
});

test('the Director\'s note is used for one arc, unless kept or changed', async t => {
    t.mock.method(console, 'warn', () => {});
    t.mock.method(console, 'info', () => {});
    const { host, model, arc } = await setUp({ script: [PLAN, PLAN2, PLAN2, PLAN2], settings: { 'arc.note': 'Make the guild the villain' } });
    await opening(host);
    await arc.plan();
    assert.match(model.calls[0].system, /Director's note: Make the guild the villain/);
    assert.equal(arc.status().draft.noteUsed, true);
    await arc.accept();
    await arc.plan();
    assert.match(model.calls[1].system, /Director's note: \(none\)/, 'used once');
    await arc.accept();
    await arc.plan();
    assert.match(model.calls[2].system, /Director's note: \(none\)/, 'still the same note: still used');
    arc.discard();
    host.settings.set('story-director', 'arc.keepNote', true);
    await arc.plan();
    assert.match(model.calls[3].system, /Director's note: Make the guild the villain/, 'kept for every plan');
    host.close();
});

test('a plan that changes a thread a middle reply made: deleting that reply takes only that change away', async t => {
    t.mock.method(console, 'warn', () => {});
    t.mock.method(console, 'info', () => {});
    const { host, arc } = await setUp({ script: [PLAN2] });
    await opening(host);
    await host.send('Noon.', said('The quay.', ['+ agenda Old Tom — mends nets | now: the nets']));
    await host.send('Later.', said('Dusk.'));
    await arc.plan();
    assert.equal((await arc.accept()).ok, true);
    assert.equal(threads(host, 'agenda').find(thread => thread.key === 'Old Tom').fields.now, 'the quay');
    const noon = host.ctx.chat.findIndex(message => /The quay\./.test(message.mes));
    await host.st.deleteMessage(noon);
    await host.st.deleteMessage(noon - 1);
    // The arc and its own new beat are still there; only Old Tom's change (its own block) went with him.
    assert.equal(host.sdk.query('director.arc').current.key, 'Second Tide');
    assert.ok(threads(host, 'beat').some(thread => thread.key === 'Guild Seizure'));
    assert.equal(threads(host).some(thread => thread.key === 'Old Tom'), false);
    assert.equal(host.store.problems().length, 1);
    const live = JSON.stringify(host.head());
    host.store.rebuild();
    assert.equal(JSON.stringify(host.head()), live);
    host.close();
});
