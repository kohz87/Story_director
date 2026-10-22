// World → Now → Here, the people (MODULES §F119, the user's beta live test): "World tab character part should
// inherit what Cast is doing and include the inner chatter"; "the NSD link doesn't refresh, I need to change
// tab". With NPC State Delta on, its own present-cast cards (through its page API, never its markup copied),
// with each person's thought from the newest reply's Inner chatter inside their card; without it, plain chips
// with the thought under the name. The cards and dossier links follow NPC State Delta's changes (its
// onChange) without a tab switch, and a redraw is one query. Also "moved here this reply" and the place's kind
// (Here covers what Story Block's Scene showed). Story Director alone, with NPC State Delta, with Inner chatter
// off.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PEOPLE_WIDGET, createPeopleWidget } from '../../../src/v2/world/index.js';
import { drawWorld, said, squash, worldData, worldHost } from './helpers.js';

const CHATTER = { 'story-block.chatter': true };
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

async function scene({ delta = null, features = CHATTER, lines = [] } = {}) {
    const host = await worldHost({ delta, features });
    await host.send('Hello.', said('The harbour at dawn.', ['~ place Harbour | kind: settlement | region: Bluewatch', '+ present Mira, Old Tom, Kell']));
    if (lines.length) await host.send('I wait.', said('The gulls cry.', lines));
    return host;
}

// NPC State Delta's page API as a stand-in: one card per present dossier, in Delta's markup classes, built
// with the page's own elements; `slot(name, aliases)` nodes go inside each card, as Delta does.
function fakeCast(people) {
    const listeners = new Set();
    const api = {
        on: true,
        renders: 0,
        available: () => api.on,
        render(el, { slot } = {}) {
            api.renders += 1;
            const doc = el.ownerDocument;
            const cards = Object.entries(people()).filter(([, who]) => who.present !== false).map(([name, who]) => {
                const cell = doc.createElement('div');
                cell.className = 'npc-state-delta-present-cell';
                cell.dataset.npcId = `npc_${name}`;
                const text = doc.createElement('span');
                text.className = 'npc-state-delta-present-card-text';
                const label = doc.createElement('b');
                label.className = 'npc-state-delta-present-card-name';
                label.textContent = name;
                text.append(label);
                const node = slot?.(name, who.aliases ?? []);
                if (node) text.append(node);
                cell.append(text);
                return cell;
            });
            el.replaceChildren(...cards);
            return cards.length;
        },
        onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
        change() { for (const fn of [...listeners]) fn(); },
        listeners,
    };
    return api;
}

test('Here: each person\'s thought from the newest reply\'s chatter, matched by dossier name or alias; the last line wins', async () => {
    const delta = { Mira: { rank: 'Friend', aliases: ['Captain'] }, 'Old Tom': { disposition: 'gruff' } };
    const host = await scene({
        delta,
        lines: ['~ chatter Captain: the tide turns soon', '~ chatter old tom: my knees ache', '~ chatter Mira: *where is the boat*'],
    });
    const here = host.sdk.query('director.world.here');
    host.close();
    assert.deepEqual(here.people.map(person => [person.name, person.thought]), [
        ['Mira', 'where is the boat'], ['Old Tom', 'my knees ache'], ['Kell', ''],
    ], 'the alias and the other case find the dossier; Mira\'s last line is the one shown');
    assert.deepEqual(here.chatter.map(item => [item.key, item.text]), [['old tom', 'my knees ache'], ['mira', 'where is the boat']]);
    assert.equal(here.place.kind, 'settlement');
});

test('Here without NPC State Delta: chatter matched by the plain name, any case; nothing while Inner chatter is off', async () => {
    const host = await scene({ lines: ['~ chatter kell: not again', '~ chatter Stranger: who are they'] });
    const here = host.sdk.query('director.world.here');
    assert.equal(here.nsd, false);
    assert.deepEqual(here.people.map(person => [person.name, person.thought]), [['Mira', ''], ['Old Tom', ''], ['Kell', 'not again']]);
    // The widget: plain chips, the thought under the name, as text.
    const { world, journal } = worldData(host);
    host.close();
    const { el, warnings } = drawWorld({ world, journal }, { widgets: { [PEOPLE_WIDGET]: createPeopleWidget({ open: () => null, cast: () => null }) } });
    assert.deepEqual(warnings, []);
    assert.deepEqual(el.querySelectorAll('.wv-chip').map(chip => squash(chip.textContent)), ['Mira', 'Old Tom', 'Kell']);
    const thought = el.querySelectorAll('.wv-person')[2].querySelector('.wv-thought');
    assert.equal(squash(thought.textContent), 'not again');
    assert.equal(el.querySelectorAll('.wv-thought').length, 1);
    assert.equal(el.querySelector('.wv-cast').hidden, true, 'no cards without NPC State Delta');

    const off = await scene({ features: {}, lines: ['~ chatter Kell: not again'] });
    const quiet = off.sdk.query('director.world.here');
    off.close();
    assert.deepEqual(quiet.chatter, [], 'Inner chatter off: no thoughts');
    assert.ok(quiet.people.every(person => person.thought === ''));
});

test('with NPC State Delta on: its own cards, the thought inside each card, chips only for those without one', async () => {
    const people = { Mira: { rank: 'Friend', aliases: ['Captain'] }, 'Old Tom': { disposition: 'gruff' } };
    const host = await scene({ delta: people, lines: ['~ chatter Captain: the tide turns soon'] });
    const { world, journal } = worldData(host);
    host.close();
    const cast = fakeCast(() => people);
    const widget = createPeopleWidget({ open: () => () => {}, cast: () => cast });
    const { el } = drawWorld({ world, journal }, { widgets: { [PEOPLE_WIDGET]: widget } });
    const box = el.querySelector('.wv-cast');
    assert.equal(box.hidden, false);
    const cards = box.querySelectorAll('.npc-state-delta-present-cell');
    assert.deepEqual(cards.map(card => card.querySelector('.npc-state-delta-present-card-name').textContent), ['Mira', 'Old Tom'], 'Delta\'s cards, in Delta\'s classes');
    assert.equal(squash(cards[0].querySelector('.wv-thought').textContent), 'the tide turns soon', 'inside Mira\'s card (matched by her alias)');
    assert.equal(cards[1].querySelector('.wv-thought'), null);
    assert.deepEqual(el.querySelectorAll('.wv-chip').map(chip => squash(chip.textContent)), ['Kell'], 'Kell has no dossier, so no card: a chip, not lost');
    // Delta off (or still loading): chips for everyone, as without it.
    cast.on = false;
    cast.change();
    await tick();
    assert.equal(box.hidden, true);
    assert.deepEqual(el.querySelectorAll('.wv-chip').map(chip => squash(chip.textContent)), ['Mira Friend', 'Old Tom gruff', 'Kell']);
});

test('the NSD link and the cards follow NPC State Delta\'s changes without a tab switch; one query, no chat walk', async () => {
    const people = { Mira: { rank: 'Friend' } };
    const host = await scene({ delta: people });
    const { world, journal } = worldData(host);
    let asked = 0;
    const api = { query: (name, args) => { asked += 1; assert.equal(name, 'director.world.here'); return host.sdk.query(name, args); } };
    const cast = fakeCast(() => people);
    const widget = createPeopleWidget({ open: () => () => {}, cast: () => cast });
    cast.on = false;   // Delta's runtime has not answered yet: chips with links from its queries
    const { el, view } = drawWorld({ world, journal }, { widgets: { [PEOPLE_WIDGET]: { ...widget, render: (node, props) => widget.render(node, props, api) } } });
    assert.deepEqual(el.querySelectorAll('button.wv-link').map(chip => squash(chip.textContent)), ['Mira Friend'], 'Kell has no dossier yet');
    assert.equal(cast.listeners.size, 1, 'subscribed to Delta\'s changes');
    // A scan that ends after the reply gives Kell a dossier: no Story Block event, no tab switch.
    people.Kell = { disposition: 'shy' };
    cast.change();
    cast.change();
    await tick();
    assert.equal(asked, 1, 'two changes in one task: one query');
    assert.deepEqual(el.querySelectorAll('button.wv-link').map(chip => squash(chip.textContent)), ['Mira Friend', 'Kell shy'], 'the link is there now');
    // Delta's runtime ready: its cards replace the chips of those it draws.
    cast.on = true;
    cast.change();
    await tick();
    assert.deepEqual(el.querySelector('.wv-cast').querySelectorAll('.npc-state-delta-present-card-name').map(name => name.textContent), ['Mira', 'Kell']);
    assert.deepEqual(el.querySelectorAll('.wv-chip').map(chip => squash(chip.textContent)), ['Old Tom'], 'Old Tom still has no dossier');
    // Gone from the page: unsubscribed, nothing drawn later.
    view.destroy();
    assert.equal(cast.listeners.size, 0);
    host.close();
});

test('a new reply, a swipe and a delete: Here follows (the screen is drawn again from the head), "moved here this reply" too', async () => {
    const host = await scene({ delta: { Mira: {} }, lines: ['~ chatter Mira: first thought'] });
    assert.equal(host.sdk.query('director.world.here').moved, false, 'the reply before stayed in the Harbour');
    await host.send('We go.', said('The market.', ['~ place Market | kind: settlement', '+ present Mira', '~ chatter Mira: so loud here']));
    const moved = host.sdk.query('director.world.here');
    assert.equal(moved.moved, true);
    assert.equal(moved.people.find(person => person.name === 'Mira').thought, 'so loud here');
    const at = host.ctx.chat.length - 1;
    await host.swipe(said('We stay.', ['~ chatter Mira: maybe later']));
    const swiped = host.sdk.query('director.world.here');
    assert.equal(swiped.moved, false);
    assert.equal(swiped.place.name, 'Harbour');
    assert.equal(swiped.people.find(person => person.name === 'Mira').thought, 'maybe later');
    await host.st.swipeTo(at, 0);
    assert.equal(host.sdk.query('director.world.here').moved, true);
    await host.st.deleteMessage(at);
    await host.st.deleteMessage(at - 1);
    const back = host.sdk.query('director.world.here');
    assert.equal(back.place.name, 'Harbour');
    assert.equal(back.people.find(person => person.name === 'Mira').thought, 'first thought');
    // The template marks the move and shows the place's kind.
    await host.send('We go.', said('The market.', ['~ place Market | kind: settlement']));
    const { world, journal } = worldData(host);
    host.close();
    const { el } = drawWorld({ world, journal }, { widgets: { [PEOPLE_WIDGET]: createPeopleWidget({ open: () => null, cast: () => null }) } });
    const place = el.querySelector('.wv-place');
    assert.ok(place.classList.contains('wv-moved'));
    assert.match(squash(place.textContent), /^Market settlement · Bluewatch moved here this reply$/, "kind, region (kept from the place before) and the mark");
});
