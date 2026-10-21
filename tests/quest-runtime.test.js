// Real Director glue against a synthetic host/provider boundary. Story Block's actual
// transaction persistence and RPG Battle's Inventory arithmetic have separate tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from './ui-fake-dom.js';
import { storySuite } from '../src/suite.js';

const doc = installFakeDom();
const host = doc.createElement('div');
host.id = 'extensions_settings';
doc.body.appendChild(host);
const hooks = { tabs: {}, reply: null };
const handlers = {};
const prompts = {};
const notices = [];
const currency = { mode: 'single', single: 'silver', row: 'Coins' };
let battles = [];
let busy = false;
let commitStatus = 'durable';
let commits = 0;
const ctx = {
    chat: [], chatMetadata: {}, chatId: 'runtime-quest', extensionSettings: {},
    getCurrentChatId: () => ctx.chatId,
    saveSettingsDebounced() {}, saveMetadataDebounced() {}, async saveChat() {},
    setExtensionPrompt: (key, value) => { prompts[key] = value; },
    eventTypes: { CHAT_CHANGED: 'chat', MESSAGE_RECEIVED: 'reply', GENERATION_STOPPED: 'stopped', MESSAGE_DELETED: 'deleted' },
    eventSource: { on: (event, fn) => { (handlers[event] ??= []).push(fn); } },
};
globalThis.SillyTavern = { getContext: () => ctx };
globalThis.toastr = Object.fromEntries(['info', 'warning', 'error', 'success'].map(level => [level, text => notices.push(`${level}: ${text}`)]));
const pattern = tag => new RegExp(`<${tag}>\\n?([\\s\\S]*?)\\n?</${tag}>`);
const block = (text, tag) => {
    const match = String(text ?? '').match(pattern(tag));
    return match ? { text: match[1] } : null;
};
const replace = (text, tag, body) => pattern(tag).test(text)
    ? text.replace(pattern(tag), () => `<${tag}>\n${body}\n</${tag}>`) : `${text}\n<${tag}>\n${body}\n</${tag}>`;
const sb = globalThis.StoryBlock = {
    apiVersion: 1, transactionVersion: 1,
    registerBlock: () => ({ ok: true }), registerTab: tab => { hooks.tabs[tab.id] = tab; },
    onReply: fn => { hooks.reply = fn; }, refresh() {},
    blockInText: block,
    messageIdentity: index => {
        const message = ctx.chat[index];
        return message?.extra?.storyBlockIdentity?.swipe === (message?.swipe_id ?? 0) ? message.extra.storyBlockIdentity.id : null;
    },
    getBlock(tag, { beforeIndex = ctx.chat.length } = {}) {
        for (let index = (beforeIndex ?? ctx.chat.length) - 1; index >= 0; index--) {
            const found = block(ctx.chat[index].mes, tag);
            if (found) return { ...found, messageIndex: index };
        }
        return null;
    },
    blockForGeneration: (tag, type) => sb.getBlock(tag, { beforeIndex: type === 'swipe' ? ctx.chat.length - 1 : ctx.chat.length }),
    setBlockText: async (index, tag, text) => { ctx.chat[index].mes = replace(ctx.chat[index].mes, tag, text); },
    async commitBlocks(request) {
        const message = ctx.chat[request.messageIndex];
        assert.equal(request.expectedText, message.mes);
        assert.equal(request.expectedExtra, JSON.stringify(message.extra ?? {}));
        if (commitStatus !== 'durable' && request.changes?.length) return { status: commitStatus, reason: 'Injected save failure' };
        for (const change of request.changes ?? []) message.mes = replace(message.mes, change.tag, change.text);
        message.extra[request.namespace] = structuredClone(request.value);
        Object.assign(message.extra, structuredClone(request.extras ?? {}));
        commits++;
        return { status: 'durable', owner: sb.messageIdentity(request.messageIndex) };
    },
};
const quests = {
    version: 1,
    rewardVersion: 1,
    prepareAward: record => ({ changes: [], xp: { version: 1, quest: record.id, gains: [] } }),
    cursor: index => ({ version: 1, anchor: sb.messageIdentity(index), excluded: battles.map(event => event.id) }),
    evidence: cursor => ({ availability: 'available', events: battles.filter(event => !cursor.excluded.includes(event.id)), revision: JSON.stringify(battles) }),
    busy: () => busy,
    inventory(options) {
        const found = sb.getBlock('Inventory', options);
        const text = found?.text ?? '';
        return { availability: found ? 'available' : 'unavailable', tag: 'Inventory', text, scope: {}, currency, items: [], revision: JSON.stringify([text, currency]) };
    },
    parseCoins: text => /^(\d+) silver$/.test(text) ? Number(text.split(' ')[0]) : null,
    formatCoins: amount => `${amount} silver`,
    reconcile(base, returned, plan) {
        assert.equal(plan.payment, 8);
        assert.equal(base.text, 'Coins | 2 silver |');
        if (!['Coins | 2 silver |', 'Coins | 10 silver |'].includes(returned)) throw new Error('Ambiguous inventory');
        return 'Coins | 10 silver |';
    },
};
storySuite().announce({ id: 'rpg-battle', name: 'RPG Battle', owns: ['stats'], enabled: true, api: { quests } });
await import('../index.js');

function reply(text, owner = crypto.randomUUID(), swipe = 0) {
    return { mes: text, is_user: false, swipe_id: swipe, extra: { storyBlockIdentity: { id: owner, swipe } } };
}
async function receive(text) {
    ctx.chat.push(reply(text));
    await hooks.reply({ chatId: ctx.chatId, messageIndex: ctx.chat.length - 1 });
}
const scene = place => `<World_State>\n**Loc:** ${place}\nNPCs Present: ${place === 'Bluewatch' ? 'Fenna' : 'Nobody'}\n</World_State>`;
async function start(said = 'I accept the Wolf bounty.') {
    ctx.chatId = crypto.randomUUID();
    ctx.chat = [{ is_user: true, mes: said }];
    ctx.chatMetadata = {};
    ctx.extensionSettings.storyDirector = { enabled: true, mirrorOffscreen: false, capture: { mode: 'off' }, arc: { trigger: 'manual' } };
    battles = [];
    busy = false;
    commitStatus = 'durable';
    notices.length = 0;
    for (const fn of handlers.chat ?? []) fn();
    await receive(`${scene('Bluewatch')}\n<Inventory>\nCoins | 2 silver |\n</Inventory>\n<Director>\n+ quest Wolf bounty — protect the road | target: defeat 3 wolf | reward: 1 silver per wolf | giver: Fenna\n</Director>`);
    battles = [{ id: 'fight', defeated: Array.from({ length: 8 }, (_, i) => ({ id: `fight:${i}`, name: 'Wolf' })) }];
}
function draw() {
    const pane = doc.createElement('div');
    hooks.tabs['story-director-quests'].render(pane);
    return pane;
}
function queue() {
    const button = draw().querySelector('.story-director-quest-finish');
    assert.equal(button.disabled, false, notices.join('\n'));
    button.click();
}

test('Take on and its narration swipe freeze acceptance when the model omits the quest line', async () => {
    await start('What work is available?');
    assert.equal(globalThis.StoryDirector.questProgress().length, 0);
    draw().querySelector('.story-director-offer-take').click();
    ctx.chat.push({ is_user: true, mes: 'Continue' });
    await globalThis.storyDirectorInterceptor([], 0, null, 'normal');
    await receive(`${scene('Bluewatch')}\nFenna hands you the notice.`);
    const index = ctx.chat.length - 1;
    const check = () => {
        const progress = globalThis.StoryDirector.questProgress()[0];
        assert.equal(progress.availability, 'available', progress.reason);
        assert.equal(progress.observed, 0, 'defeats before taking the offer cannot count');
        assert.equal(ctx.chat[index].extra.storyDirectorQuest.context.owner, sb.messageIdentity(index));
    };
    check();
    await globalThis.storyDirectorInterceptor([], 0, null, 'swipe');
    ctx.chat[index] = reply(`${scene('Bluewatch')}\nFenna repeats the terms.`, 'offer-swipe', 1);
    await hooks.reply({ messageIndex: index });
    check();
});

test('runtime queues and undoes without mutation; persists missing completion/payment once', async () => {
    await start();
    const before = sb.getBlock('Inventory').text;
    queue();
    assert.equal(sb.getBlock('Inventory').text, before);
    draw().querySelector('.story-director-quest-finish').click();
    assert.equal(ctx.chatMetadata.storyDirector.finish, null);
    queue();
    ctx.chat.push({ is_user: true, mes: 'I turn in the bounty.' });
    await globalThis.storyDirectorInterceptor([], 0, null, 'normal');
    assert.match(prompts.story_suite_tail_2_story_director, /Pay exactly 8 silver/);
    await receive(`${scene('Bluewatch')}\nFenna thanks you.`);
    assert.equal(sb.getBlock('Inventory').text, 'Coins | 10 silver |', notices.join('\n'));
    const index = ctx.chat.length - 1;
    assert.equal(globalThis.StoryDirector.questsDoneAt(index).length, 1);
    ctx.chat[index].is_system = true;
    assert.equal(globalThis.StoryDirector.questsDoneAt(index).length, 1, 'hidden completion remains recorded');
    ctx.chat[index].is_system = false;
    const beforeRetry = commits;
    await hooks.reply({ messageIndex: index });
    assert.equal(commits, beforeRetry);
    assert.equal(sb.getBlock('Inventory').text, 'Coins | 10 silver |');
});

test('archived replay seeds accepted terms and paid closure across hundreds of removed replies', async t => {
    let prefix = [], offset = 0;
    sb.journalVersion = 1;
    sb.journal = () => ({ availability: 'available', prefix, offset, key: prefix.at(-1)?.id ?? '',
        entries: [...prefix, ...ctx.chat.map(message => ({ extra: message.extra ?? {} }))] });
    t.after(() => { delete sb.journal; delete sb.journalVersion; });
    await start();
    const acceptance = structuredClone(ctx.chat[1].extra.storyDirectorState);
    assert.equal(acceptance.tracker.records[0].contract.requirement.qty, 3);
    const originalGet = sb.getBlock;
    const inventory = originalGet('Inventory');
    t.mock.method(sb, 'getBlock', (tag, options) => originalGet(tag, options) ?? (tag === 'Inventory' ? inventory : null));
    prefix = [{ id: 'archive-300', extra: { storyDirectorState: acceptance } }];
    offset = 300;
    ctx.chat = [reply(scene('Bluewatch'))];
    assert.equal(globalThis.StoryDirector.questProgress()[0].eligible, true);
    queue();
    ctx.chat.push({ is_user: true, mes: 'Turn it in.' });
    await globalThis.storyDirectorInterceptor([], 0, null, 'normal');
    await receive(scene('Bluewatch'));
    const at = ctx.chat.length - 1;
    assert.equal(globalThis.StoryDirector.questsDoneAt(at).length, 1);
    const closure = structuredClone(ctx.chat[at].extra.storyDirectorState);
    assert.equal(closure.position, 302);
    prefix = [{ id: 'archived-payment', extra: { storyDirectorState: closure } }];
    offset = 500;
    ctx.chat = [reply(scene('Bluewatch'))];
    assert.equal(globalThis.StoryDirector.questProgress().length, 0, 'closure remains authoritative after its prose is archived');
    prefix = []; offset = 0;
    assert.equal(globalThis.StoryDirector.questProgress().length, 0, 'a rewind before acceptance cannot inherit future contracts');
});

test('an unrequested narrative payout blocks another payment until the conflicting reply is corrected', async () => {
    await start();
    await receive(`${scene('Bluewatch')}\n<Inventory>\nCoins | 10 silver |\n</Inventory>\n<Director>\n- Wolf bounty — completed\n</Director>`);
    const index = ctx.chat.length - 1;
    assert.equal(globalThis.StoryDirector.questsDoneAt(index).length, 0);
    assert.equal(sb.getBlock('Inventory').text, 'Coins | 10 silver |');
    assert.match(globalThis.StoryDirector.questProgress()[0].reason, /turn-in without a receipt/);
    assert.equal(draw().querySelector('.story-director-quest-finish').disabled, true);
    await receive(scene('Bluewatch'));
    assert.equal(draw().querySelector('.story-director-quest-finish').disabled, true, 'a later reply cannot hide the conflict');
    await sb.setBlockText(index, 'Director', '');
    await sb.setBlockText(index, 'Inventory', 'Coins | 2 silver |');
    assert.equal(globalThis.StoryDirector.questProgress()[0].eligible, true);
});

test('away and unfinished battles disable Complete', async () => {
    await start();
    await receive(scene('Woods'));
    assert.equal(draw().querySelector('.story-director-quest-finish').disabled, true);
    await receive(scene('Bluewatch'));
    busy = true;
    assert.equal(draw().querySelector('.story-director-quest-finish').disabled, true);
});

test('changed stock before generation cancels a queued transaction; quiet calls leave it queued', async () => {
    await start();
    queue();
    await globalThis.storyDirectorInterceptor([], 0, null, 'quiet');
    assert.equal(ctx.chatMetadata.storyDirector.finish.sentFor, null);
    await sb.setBlockText(1, 'Inventory', 'Coins | 3 silver |');
    ctx.chat.push({ is_user: true, mes: 'Continue' });
    await globalThis.storyDirectorInterceptor([], 0, null, 'normal');
    assert.equal(ctx.chatMetadata.storyDirector.finish, null);
});

test('save rejection leaves the quest open and retry does not fabricate success', async () => {
    await start();
    queue();
    ctx.chat.push({ is_user: true, mes: 'Turn it in' });
    await globalThis.storyDirectorInterceptor([], 0, null, 'normal');
    commitStatus = 'failed';
    await receive(`${scene('Bluewatch')}\n<Director>\n- Wolf bounty — completed\n</Director>`);
    assert.equal(globalThis.StoryDirector.questsDoneAt(ctx.chat.length - 1).length, 0);
    assert.equal(sb.getBlock('Inventory').text, 'Coins | 2 silver |');
});

test('uncertain acceptance readback blocks turn-in until the chat is reloaded', async t => {
    await start();
    const saved = structuredClone(ctx.chat[1].extra);
    delete ctx.chat[1].extra.storyDirectorQuest;
    t.mock.method(console, 'error', () => {});
    const commit = t.mock.method(sb, 'commitBlocks', async () => ({ status: 'uncertain', reason: 'Readback unavailable' }));
    await hooks.reply({ messageIndex: 1 });
    assert.match(globalThis.StoryDirector.questProgress()[0].reason, /save is unverified/);
    assert.equal(draw().querySelector('.story-director-quest-finish').disabled, true);
    commit.mock.restore();
    ctx.chat[1].extra = saved;
    for (const fn of handlers.chat ?? []) fn();
    assert.equal(globalThis.StoryDirector.questProgress()[0].eligible, true);
});

test('narration swipe settles from its base once; removing its reply restores prior balance', async () => {
    await start();
    queue();
    ctx.chat.push({ is_user: true, mes: 'Turn it in' });
    await globalThis.storyDirectorInterceptor([], 0, null, 'normal');
    await receive(`${scene('Bluewatch')}\n<Inventory>\nCoins | 10 silver |\n</Inventory>`);
    const index = ctx.chat.length - 1;
    assert.equal(globalThis.StoryDirector.questsDoneAt(index).length, 1);
    await globalThis.storyDirectorInterceptor([], 0, null, 'swipe');
    ctx.chat[index] = reply(`${scene('Bluewatch')}\nAnother telling.`, 'new-swipe-owner', 1);
    await hooks.reply({ messageIndex: index });
    assert.equal(sb.getBlock('Inventory').text, 'Coins | 10 silver |');
    assert.equal(globalThis.StoryDirector.questsDoneAt(index).length, 1, notices.join('\n'));
    const acceptance = ctx.chat[1].mes;
    ctx.chat[1].mes = acceptance.replace('defeat 3 wolf', 'defeat 3 dragon');
    assert.match(globalThis.StoryDirector.questProgress()[0].reason, /Recovery/);
    assert.equal(globalThis.StoryDirector.questsDoneAt(index).length, 0);
    ctx.chat[1].mes = acceptance;
    assert.equal(globalThis.StoryDirector.questsDoneAt(index).length, 1);
    ctx.chat.pop();
    for (const fn of handlers.deleted ?? []) fn();
    assert.equal(sb.getBlock('Inventory').text, 'Coins | 2 silver |');
    assert.equal(globalThis.StoryDirector.questProgress()[0].managed, true);
    assert.equal(ctx.chatMetadata.storyDirector.finish, null);
    assert.equal(globalThis.StoryDirector.questProgress()[0].eligible, true);
});
