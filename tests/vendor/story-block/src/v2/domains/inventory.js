// The `inventory` domain (§7): item definitions, stacks, wallets and the alias index, with
// its validator, commands, capture kinds `item` and `coin`, queries and prompt view. Pure.
//
// Handlers follow §3.2: synchronous, everything through ctx (read/draft/call/claim/rng/fail).
// A stack whose count reaches 0 is removed, never kept at 0 (§2.5). Numbers are set by code:
// a change line proposes, these functions decide. Payloads, codes and money follow MODULES.md F:
// a rule refusal is REFUSED, a malformed payload INVALID; a wallet is { coin: n } in the smallest unit.

import { OWNER_RE, isPlainObject, clone, labelOf, ownerNameIn, capitalize } from './common.js';
import { aliasKey, cleanName, resolveDef, slugify, trimText } from './names.js';
import { WALLET_KEY, coinValue, countedMoney, formatAmount, isCurrencyName, parseAmount, resolveCurrency } from './money.js';
import { isId } from '../check.js';
import { GEAR, createGearQueries, handDef, placeOf, slotWordOf } from './gear.js';
import { fill } from '../strings.js';
import {
    defErrors, isCount, nonBlank, COND_MAX, condLogErrors, keptErrors, gearOn, condOf, MAX_UNSTACKED, RARITIES,
    MAX_NAME, condWrite, RPG_MODULE, featureOn, FEATURE, KINDS, MAX_NOTE, KIND_ORDER,
    CARRY_MAX, condEvents,
} from './inventory/state.js';
import { itemText, baseSlot, slotLimits, canWear, legendEarned } from './inventory/validate.js';
import { pack, WALLET_NOTE } from './inventory/prompt.js';
import {
    definitionsOf, listItems, carryBonuses, gearIsOn, boundNames, equipmentView, encumbrance, defCarry,
    ENCUMBERED_PENALTY, gearWearers,
} from './inventory/queries.js';
import {
    currencyIn, defineByName, grantInto, receive, told, E, refuseBound, addStack, looseMatch, stacksOf, freeId,
    count, receiverArg, textArg, defineGiven, ownerArg, peekPackDef, stackIn, boundId, ambiguous, storeDef,
    unbound, shortOf, takeAcross, take, pay, knownDef, economyOf,
} from './inventory/stacks.js';
import { wear, repair, gearWear, itemEquip, stow, restore, release, storyWear, storyRepair } from './inventory/wear.js';
import { lootErrors, lootTake, lootItems } from './inventory/loot.js';
import {
    byReader, handStats, handSlot, kitOpen, holdBudget, remakeAsEquipment, guardReaderEdit, addDecision,
    handPlace, handEdit, renameDecision, editStack, editPieces,
} from './inventory/edit.js';
import { readerCarry, carryFits, lineQty, storyItems, storyCoin, storedTally, clicksOf, tallied } from './inventory/lines.js';
export { LOOT_ITEMS, LOOT_KEEP, LOOT_GUARD, LOOT_OFFER, LOOT_KINDS, captureLoot, lootTakeGuard } from './inventory/loot.js';
export { kitOpen, INVENTORY_EDIT_GUARD, inventoryEditGuard } from './inventory/edit.js';
export { ECONOMY_SCALE, economyOf, scaledDefault } from './inventory/stacks.js';
export { STORY_WEAR, wearWord } from './inventory/wear.js';
export { DEFINITIONS_MAX_IDS, carryBonuses, listItems, equipmentView, ENCUMBERED_PENALTY, defCarry, ENCUMBERED_STATS, encumbrance, encumbranceTail, definitionsOf } from './inventory/queries.js';
export { KINDS, RARITIES, KIND_ORDER, initialInventory, FEATURE, INVENTORY_FEATURES, gearOn, featureOn, COND_MAX, COND_LOG_MAX, condEvents, condOf, defaultDef, CARRY_MAX, packCarry } from './inventory/state.js';
export { itemText, legendEarned, MANY_SLOTS, MAX_MANY, baseSlot, slotLimits, canWear } from './inventory/validate.js';
export { promptNote, WALLET_NOTE, inventoryTail } from './inventory/prompt.js';

export function validateInventory(slice) {
    if (!isPlainObject(slice)) return ['The inventory is not a record.'];
    const parts = ['defs', 'stacks', 'wallets', 'aliases'].filter(part => !isPlainObject(slice[part]));
    if (parts.length) return parts.map(part => `The inventory has no ${part} record.`);
    const { defs, stacks, wallets, aliases } = slice;
    const errors = [];
    for (const [key, def] of Object.entries(defs)) errors.push(...defErrors(key, def));
    const worn = new Set();
    for (const [key, stack] of Object.entries(stacks)) {
        if (!isPlainObject(stack)) {
            errors.push(`Item stack ${key} is not a record.`);
            continue;
        }
        const def = isPlainObject(defs[stack.def]) ? defs[stack.def] : null;
        const label = def?.name ?? key;
        if (stack.id !== key) errors.push(`Item stack ${key} is filed under the wrong ID.`);
        if (!isId(key, 'it')) errors.push(`"${key}" is not a well-formed item stack ID.`);
        if (!def) errors.push(`Item stack ${key} refers to an item definition that does not exist (${stack.def}).`);
        if (!isCount(stack.qty, 1)) errors.push(`${label} has quantity ${stack.qty}; a stack holds a whole number of at least 1 (an empty stack is removed).`);
        else if (def && def.stack === false && stack.qty !== 1) errors.push(`${label} does not stack, so each one is its own stack of 1.`);
        if (typeof stack.owner !== 'string' || !OWNER_RE.test(stack.owner)) errors.push(`${label} has an owner that is neither the party nor an actor ID.`);
        if (stack.equipped !== null) {
            if (!nonBlank(stack.equipped)) errors.push(`${label} has an equipped slot that is neither empty nor a name.`);
            else {
                if (def && def.kind !== 'equipment') errors.push(`${label} is worn in "${stack.equipped}" but is not equipment.`);
                const place = `${stack.owner}\u0000${stack.equipped}`;
                if (worn.has(place)) errors.push(`Two items are worn in the same slot "${stack.equipped}" by the same owner.`);
                worn.add(place);
            }
        }
        if (typeof stack.note !== 'string') errors.push(`${label} has a note that is not text.`);
        if (typeof stack.from !== 'string') errors.push(`${label} has an origin that is not a receipt ID.`);
        if (stack.cond !== undefined && !(Number.isSafeInteger(stack.cond) && stack.cond >= 0 && stack.cond <= COND_MAX)) {
            errors.push(`${label} has a condition of ${stack.cond}; it is a whole number from 0 to ${COND_MAX}.`);
        }
        if (stack.key !== undefined && stack.key !== true) errors.push(`${label} is marked as a key item with something other than true.`);
        if (stack.story !== undefined && stack.story !== true) errors.push(`${label} is marked as the story's with something other than true.`);
        if (stack.bound !== undefined && !(typeof stack.bound === 'string' && stack.bound !== 'party' && OWNER_RE.test(stack.bound))) errors.push(`${label} is bound to something that is not a party member's ID.`);
    }
    for (const [owner, wallet] of Object.entries(wallets)) {
        if (!OWNER_RE.test(owner)) errors.push(`A wallet belongs to "${owner}", who is neither the party nor an actor ID.`);
        if (!isPlainObject(wallet)) {
            errors.push(`The wallet of ${owner} is not a record.`);
            continue;
        }
        for (const [key, amount] of Object.entries(wallet)) {
            if (key !== WALLET_KEY) errors.push(`The wallet of ${owner} holds "${key}"; a wallet keeps one amount, under ${WALLET_KEY}.`);
            else if (!isCount(amount, 0)) errors.push(`The wallet of ${owner} holds ${amount}; money is a whole number of at least 0.`);
        }
    }
    for (const [key, id] of Object.entries(aliases)) {
        if (!key || key !== key.trim().toLowerCase()) errors.push(`The item name "${key}" is not written in lowercase.`);
        if (!isPlainObject(defs[id])) errors.push(`The item name "${key}" points to a definition that does not exist (${id}).`);
    }
    if (slice.loot !== undefined) errors.push(...lootErrors(slice.loot));
    if (slice.condLog !== undefined) errors.push(...condLogErrors(slice.condLog));
    if (slice.kept !== undefined) errors.push(...keptErrors(slice.kept));
    return errors;
}

// ---------- shared pieces of the handlers ----------

// ---------- bound signature gear (`story-block.gear`, GEAR.md "Signature gear") ----------
//
// A cast member's signature pieces, granted on join, carry `bound: <actor id>`: they stay with that member. With the switch on, no command moves,
// unequips, sells, drops, uses up, edits, splits or merges such a stack ("Bound to Mara: Cane Sword stays with them."); wear and repair are the
// condition's and go on as ever. Switched off, the mark is only kept: every command acts as in 2.17.0.

// ---------- equipment: who can wear what ----------

// ---------- gear condition (`cond`) ----------

// ---------- loot to pick from (`story-block.loot`) ----------

// The guard of a take, as the core module's replayGuard asks it (domains/index.js) on the state before the take's block,
// on a rebuild, a reload, a delete, a swipe and a Re-read alike. Pure: the state before the block and the guard's own
// predicate, nothing else. The take holds while the reply's offer is there under the same claim and lays out, by the
// tolerant name, at least as many of each thing as was taken (and at least the coin taken). The names are matched as the
// inventory looks a name up (resolveDef over the offer's things: the exact name first, then singular and plural, the
// name without portion words, then the word-order key), so "Torches" still offers what "Torch" took; a name that matches
// none of them, or two, or the thing another taken name matches, does not hold. A Re-read that leaves the
// offer as it was, or still offering what was taken, keeps the take; a deleted reply, or a Re-read that drops a taken
// thing or lowers it below what was taken, turns the take off with its claim (the block stays stored, inactive, and the
// Problems say why). The changes it made were decided when the reader took, and are replayed as they were. The offer's
// reply-bound guard (`loot.offer`) is answered here too.

// ---------- commands ----------

// Commands that make something out of nothing (items, money) run for the story, the host, or another
// module's command (ctx.caller); a 'ui' command at the top is refused with `why`.
function byModule(ctx, why) {
    if (!(ctx.caller || ctx.cause === 'story' || ctx.cause === 'system')) ctx.fail('REFUSED', why);
}


// What the narrator is told after an edit's line under [Happened] (a receipt's `data.told`, added by prompt.js; the reader's
// card does not show it). A starting purse or kit (a saved character's, from the wizard: `starting: true`) and the reader's own
// corrections are the state as it stands, so the narrator must not read them as money or things that moved in the story.
export const TOLD = Object.freeze({
    startPurse: 'Starting purse, set before the story began: not money paid or received in the story.',
    startKit: 'Starting kit, set before the story began: not found, bought or used in the story.',
    editPurse: 'The reader\'s own correction: the purse is this now, not money paid or received in the story.',
    editKit: 'The reader\'s own correction: the party has this now, not found, bought or used in the story.',
});

/** The inventory commands; `env` = { hooks: name => fn[], settings: () => this module's settings }. */
export function createInventoryCommands(env) {
    return {
        // { def | defId | name, qty, owner, note? }: `def` is a def ID or a full def. Internal (§7):
        // the story, the host, or another module's command through ctx.call.
        'inventory.grant'(ctx, payload = {}) {
            byModule(ctx, 'Items cannot be handed out from a button; they come from the story or from another module.');
            if (payload.bound !== undefined && payload.bound !== false && ctx.caller !== RPG_MODULE) ctx.fail('REFUSED', 'Only Story Block\'s own join binds gear to a member.');
            const inv = ctx.draft('inventory');
            const qty = count(ctx, payload.qty, 1);
            const owner = receiverArg(ctx, payload.owner);
            const note = textArg(ctx, payload.note, MAX_NOTE, 'note');
            let def;
            let created = false;
            const wanted = payload.def ?? payload.defId;
            if (isPlainObject(wanted)) {
                ({ def, created } = defineGiven(ctx, inv, wanted, env, { note, owner }));
            } else if (wanted !== undefined) {
                def = typeof wanted === 'string' ? inv.defs[wanted] : null;
                if (!def) ctx.fail('NOT_FOUND', 'There is no such item to give.');
            } else if (payload.name !== undefined) {
                ({ def, created } = defineByName(ctx, inv, String(payload.name), env, { note, owner }));
            } else ctx.fail('INVALID', 'Say which item to give.');
            // `bound: true` (a cast member's signature gear, GEAR.md): kept as stacks of their own, marked as theirs.
            if (payload.bound !== undefined && typeof payload.bound !== 'boolean') ctx.fail('INVALID', 'bound must be true or false.');
            if (payload.bound === true && owner === 'party') ctx.fail('INVALID', 'Only a party member\'s gear can be bound to them.');
            const stacks = payload.bound === true
                ? (def.stack ? [addStack(ctx, inv, def.id, qty, owner, note)] : grantInto(ctx, inv, def, qty, owner, note))
                : grantInto(ctx, inv, def, qty, owner, note);
            if (payload.bound === true) for (const id of stacks) inv.stacks[id].bound = owner;
            return {
                summary: `${capitalize(ownerNameIn(ctx, owner))} gains ${itemText(def.name, qty)}.`,
                data: { def: def.id, qty, owner, stacks, created },
                narrate: told(ctx),
            };
        },

        // The reader's own item, resolved just like a story item but without the story's grant command.
        'inventory.add'(ctx, payload = {}) {
            byReader(ctx);
            const prefix = ctx.read('inventory');
            const inv = ctx.draft('inventory');
            if (typeof payload.name !== 'string') ctx.fail('INVALID', E.itemName);
            const name = cleanName(payload.name);
            if (!name || [...name].length > 60) ctx.fail('INVALID', E.itemNameLength);
            const qty = count(ctx, payload.qty, 1);
            // Hand-set gear (gear on): `slot`, `stats` ({ STR: 1 }) and `equip` (the owner who puts it on) join `kind` and `rarity`. The starting kit rule is held here.
            const gearWords = ['slot', 'stats', 'equip'].filter(key => payload[key] !== undefined && payload[key] !== null && payload[key] !== '' && !(key === 'stats' && isPlainObject(payload.stats) && !Object.keys(payload.stats).length));
            if (gearWords.length && !gearOn(ctx) && payload.starting !== true) ctx.fail('REFUSED', E.gearOff);
            const equipOn = gearWords.includes('equip') ? ownerArg(ctx, payload.equip) : null;
            const owner = receiverArg(ctx, equipOn ?? payload.owner);
            const note = textArg(ctx, payload.note, MAX_NOTE, 'note');
            // A saved character's things come with the kind and rarity the file kept; they apply only when the item is new to this chat.
            const keep = {};
            if (payload.kind !== undefined && payload.kind !== null) {
                if (!KINDS.includes(payload.kind)) ctx.fail('INVALID', fill(E.itemKind, { kinds: KINDS.join(', ') }));
                keep.kind = payload.kind;
            }
            if (payload.rarity !== undefined && payload.rarity !== null) {
                if (!RARITIES.includes(payload.rarity)) ctx.fail('INVALID', fill(E.itemRarity, { rarities: RARITIES.join(', ') }));
                keep.rarity = payload.rarity;
            }
            const gear = gearOn(ctx);
            const stats = handStats(ctx, payload.stats);
            const slot = handSlot(ctx, payload.slot);
            // The starting kit: Rarity above Common and a Bonus only while the chat is at its first message (an imported character's `starting: true` things are the file's own).
            const open = kitOpen(env);
            // A character file's things (`starting: true`) come as written only while the kit is open; later they come in as Common with no bonus, and the Problems list says so.
            let written = name;
            const imported = gear && payload.starting === true && !open;
            if (imported && (keep.rarity ?? 'common') !== 'common' || imported && (slot || Object.keys(stats).length)) {
                env.problem?.({ module: 'story-block', code: 'HELD', message: fill(E.importLate, { name }) });
                delete keep.rarity;
            }
            // After the kit a name that a story or pack piece already has never copies its rarity or bonus: the reader's own Common piece of it is made (named "Your …").
            if (gear && payload.starting !== true && !open) {
                const found = resolveDef(inv, name);
                const same = found.status === 'found' ? inv.defs[found.id] : null;
                if (same && !handDef(inv, same) && (same.kind === 'equipment' || same.rarity !== 'common')) {
                    written = `Your ${[...name].slice(0, 60 - 'Your '.length).join('')}`;
                    keep.kind ??= same.kind;
                    if (same.kind === 'equipment' && !slot && same.slot) keep.slot = baseSlot(same.slot);
                }
            }
            // The same for a pack piece not held yet: the `item.resolve` hooks are asked, and equipment or a piece above Common is never copied at the pack's words.
            if (gear && !open && written === name && resolveDef(inv, name).status === 'none') {
                const asked = peekPackDef(env, name);
                if (asked && (asked.kind === 'equipment' || (asked.rarity ?? 'common') !== 'common')) {
                    written = `Your ${[...name].slice(0, 60 - 'Your '.length).join('')}`;
                    if (payload.starting !== true) {
                        keep.kind ??= asked.kind;
                        if (asked.kind === 'equipment' && !slot && asked.slot) keep.slot = baseSlot(asked.slot);
                    }
                    delete keep.rarity;
                }
            }
            if (gear && payload.starting !== true && !open && ((keep.rarity ?? 'common') !== 'common' || Object.keys(stats).length)) ctx.fail('REFUSED', E.kitClosed);
            if (gear && payload.starting !== true && (gearWords.length || keep.kind !== undefined)) {
                holdBudget(ctx, keep.rarity ?? 'common', stats);
                if (keep.kind === 'equipment') {
                    // (the name's own guess of a slot gives way to the reader's choice, and the stats are theirs: none unless they picked some)
                    if (slot) keep.slot = baseSlot(slot);
                    keep.stats = stats;
                } else if (keep.kind !== undefined) {
                    Object.assign(keep, { slot: null, stats: {}, stack: true });
                }
            }
            // A saved character's piece the reader set by hand keeps its own slot and bonus (still held to the rarity's points); with gear off the words are left out.
            if (gear && payload.starting === true && open && keep.kind === 'equipment' && (slot || Object.keys(stats).length)) {
                holdBudget(ctx, keep.rarity ?? 'common', stats);
                if (slot) keep.slot = baseSlot(slot);
                if (Object.keys(stats).length) keep.stats = stats;
            }
            const { def, created } = defineByName(ctx, inv, written, env, { note, owner }, true, keep);
            // The reader's explicit Kind = Equipment wins over a definition of the reader's own that this name already reached (see `remakeAsEquipment`).
            if (gear && payload.starting !== true && !created && keep.kind === 'equipment' && written === name) remakeAsEquipment(ctx, inv, def, keep, slot);
            // Equipment with no place to be worn is refused here (the reader's Slot, else a slot word in the name, else the definition's own).
            if (gear && payload.starting !== true && keep.kind === 'equipment' && def.kind === 'equipment' && !def.slot) ctx.fail('REFUSED', fill(E.kitNoSlot, { name: def.name }));
            // (slot, bonus and putting on are for equipment: judged on the def the name means, which may be a pack's or the story's own)
            if (gear && payload.starting !== true && (slot || Object.keys(stats).length) && def.kind !== 'equipment') ctx.fail('INVALID', E.gearNeedsEquipment);
            if (created && gear && def.id.startsWith('story/')) inv.defs[def.id].hand = true;
            guardReaderEdit(ctx, 'inventory.add', null, null, { def: def.id, witness: addDecision(prefix, payload, def.id) });
            readerCarry(ctx, [{ defId: def.id, qty }], owner);
            const stacks = grantInto(ctx, inv, def, qty, owner, note);
            let worn = null;
            if (equipOn) {
                if (def.kind !== 'equipment') ctx.fail('REFUSED', fill(E.kitNotEquipment, { name: def.name }));
                const place = slot ?? slotWordOf(def.slot);
                if (!place) ctx.fail('REFUSED', E.kitNeedSlot);
                worn = ctx.call('item.equip', { stack: stacks[0], owner, slot: handPlace(inv, owner, stacks[0], place) });
            }
            return { summary: fill(E.itemAdded, { item: itemText(def.name, qty) }),
                data: { edit: true, def: def.id, qty, owner, stacks, created, ...(worn ? { place: worn.data?.place } : {}), told: payload.starting === true ? TOLD.startKit : TOLD.editKit }, narrate: true };
        },

        'inventory.edit'(ctx, payload = {}) {
            byReader(ctx);
            const inv = ctx.draft('inventory');
            const stack = stackIn(ctx, inv, payload.stack);
            const original = inv.defs[stack.def];
            // A bound piece keeps its name and count (the reader's own note on it is fine).
            if (boundId(ctx, stack)) {
                const group = payload.group === true && !original.stack ? Object.values(inv.stacks).filter(item => item.def === stack.def && item.owner === stack.owner).length : stack.qty;
                if ((typeof payload.name === 'string' && cleanName(payload.name) !== original.name) || (payload.qty !== undefined && payload.qty !== group)) refuseBound(ctx, inv, stack);
            }
            // The reader's own gear (gear on): kind, slot, rarity and bonus of a piece they added by hand.
            if (['kind', 'slot', 'rarity', 'stats'].some(key => payload[key] !== undefined)) handEdit(ctx, env, inv, stack, payload);
            const oldName = original.name;
            const decision = typeof payload.name === 'string' ? { witness: renameDecision(inv, stack, payload) } : null;
            let groupQty;
            // The screen counts separate pieces together without changing the one-piece stack invariant.
            if (payload.group === true && !original.stack && payload.qty !== undefined) {
                const qty = count(ctx, payload.qty, undefined);
                if (qty > MAX_UNSTACKED) ctx.fail('INVALID', fill(E.itemGroupLimit, { max: MAX_UNSTACKED }));
                const editPiece = payload.name !== undefined || payload.note !== undefined;
                const pieces = Object.values(inv.stacks).filter(item => item.def === stack.def && item.owner === stack.owner);
                guardReaderEdit(ctx, 'inventory.edit', editStack(stack), editPieces(inv, stack), decision);
                // If this edit also changes the selected piece, keep that piece when reducing the group.
                const loose = pieces.filter(item => item.equipped === null && !boundId(ctx, item) && (!editPiece || item.id !== stack.id)).reverse();
                const remove = pieces.length - qty;
                if (remove > loose.length) ctx.fail('REFUSED', E.itemGroupEquipped);
                if (remove > 0) for (const item of loose.slice(0, remove)) delete inv.stacks[item.id];
                if (remove < 0) {
                    readerCarry(ctx, [{ defId: original.id, qty: -remove }], stack.owner);
                    grantInto(ctx, inv, original, -remove, stack.owner, stack.note);
                }
                if (!editPiece) {
                    const remaining = Object.values(inv.stacks).find(item => item.def === original.id && item.owner === stack.owner);
                    return { summary: fill(E.itemSet, { detail: fill(E.itemCount, { name: original.name, qty }) }),
                        data: { edit: true, stack: remaining.id, told: TOLD.editKit }, narrate: true };
                }
                groupQty = qty;
            }
            if (groupQty === undefined) guardReaderEdit(ctx, 'inventory.edit', editStack(stack), null, decision);
            if (payload.qty !== undefined && groupQty === undefined) {
                const qty = count(ctx, payload.qty, undefined);
                // A non-stacking item is one stack per piece (the domain's invariant).
                if (!original.stack && qty !== 1) ctx.fail('REFUSED', fill(E.itemUnstackable, { name: original.name }));
                if (qty > stack.qty) readerCarry(ctx, [{ defId: original.id, qty: qty - stack.qty }], stack.owner);
                stack.qty = qty;
            }
            if (payload.note !== undefined) stack.note = textArg(ctx, payload.note, MAX_NOTE, 'note');
            let name = original.name;
            let resultStack = stack.id;
            if (payload.name !== undefined) {
                if (typeof payload.name !== 'string') ctx.fail('INVALID', E.itemName);
                name = cleanName(payload.name);
                if (!name || [...name].length > 60) ctx.fail('INVALID', E.itemNameLength);
                const found = resolveDef(inv, name);
                if (found.status === 'ambiguous') ctx.fail('INVALID', ambiguous(inv, name, found.ids));
                if (found.status === 'found' && found.id !== original.id) {
                    const targetDef = inv.defs[found.id];
                    const target = stacksOf(inv, found.id).find(other => targetDef.stack && stack.owner === other.owner
                        && stack.equipped === other.equipped && stack.note === other.note && condOf(stack, inv) === condOf(other, inv)
                        && (stack.key === true) === (other.key === true));
                    if (!target) ctx.fail('REFUSED', fill(E.itemCannotMerge, { name }));
                    if (!Number.isSafeInteger(target.qty + stack.qty)) ctx.fail('INVALID', E.itemQuantityLarge);
                    stack.def = targetDef.id;
                    ctx.call('inventory.merge', { stack: stack.id, into: target.id });
                    resultStack = target.id;
                    name = targetDef.name;
                } else if (name !== original.name) {
                    const shared = Object.values(inv.stacks).some(other => other.id !== stack.id && other.def === original.id);
                    if (shared || original.id.startsWith('pack.')) {
                        const id = freeId(inv, `story/${slugify(name)}`);
                        const copy = { ...clone(original), id, name };
                        delete copy.carry;
                        delete copy.bonus;
                        storeDef(inv, copy);
                        stack.def = id;
                    } else {
                        for (const [key, id] of Object.entries(inv.aliases)) if (id === original.id) delete inv.aliases[key];
                        original.name = name;
                        inv.aliases[aliasKey(name)] = original.id;
                    }
                }
            }
            const current = inv.stacks[resultStack];
            const detail = groupQty !== undefined && name !== oldName
                ? fill(E.itemGroupRenamed, { name: oldName, qty: groupQty, renamed: name })
                : payload.qty !== undefined ? fill(E.itemCount, { name, qty: groupQty ?? current.qty }) : payload.note !== undefined ? fill(E.itemNote, { name }) : name;
            return { summary: fill(E.itemSet, { detail }), data: { edit: true, stack: resultStack, told: TOLD.editKit }, narrate: true };
        },

        'inventory.consume'(ctx, payload = {}) {
            const inv = ctx.draft('inventory');
            const qty = count(ctx, payload.qty, 1);
            let def;
            let stacks;
            if (payload.stack !== undefined) {
                const stack = stackIn(ctx, inv, payload.stack);
                refuseBound(ctx, inv, stack);
                def = inv.defs[stack.def];
                stacks = [stack];
            } else if (payload.def !== undefined) {
                def = typeof payload.def === 'string' ? inv.defs[payload.def] : null;
                if (!def) ctx.fail('NOT_FOUND', 'There is no such item.');
                stacks = unbound(ctx, inv, stacksOf(inv, def.id, payload.owner === undefined ? null : ownerArg(ctx, payload.owner)));
            } else ctx.fail('INVALID', 'Say which item to use up.');
            const have = stacks.reduce((sum, stack) => sum + stack.qty, 0);
            if (have < qty) ctx.fail('NOT_ENOUGH', shortOf(def.name, have));
            takeAcross(inv, stacks, qty);
            return {
                summary: `${itemText(def.name, qty)} used up (${have - qty} left).`,
                data: { def: def.id, qty, left: have - qty, stacks: stacks.map(stack => stack.id) },
                narrate: told(ctx),
            };
        },

        'inventory.transfer'(ctx, payload = {}) {
            const inv = ctx.draft('inventory');
            const stack = stackIn(ctx, inv, payload.stack);
            refuseBound(ctx, inv, stack);
            const def = inv.defs[stack.def];
            if (payload.to === undefined || payload.to === null) ctx.fail('INVALID', 'Say who should get it.');
            const to = receiverArg(ctx, payload.to);
            const from = stack.owner;
            if (to === from) ctx.fail('REFUSED', `${def.name} is already with ${ownerNameIn(ctx, to)}.`);
            const qty = count(ctx, payload.qty, stack.qty);
            if (qty > stack.qty) ctx.fail('NOT_ENOUGH', shortOf(def.name, stack.qty));
            // The reader's hand-over (Give on the Inventory screen): only the taker's own load is checked.
            if (ctx.cause === 'ui') readerCarry(ctx, [{ defId: def.id, qty }], to, true);
            const cond = condOf(stack, inv);
            const target = def.stack && stack.key !== true ? looseMatch(inv, def.id, to, stack.note, null, cond) : null;
            const note = stack.note;
            let moved;
            if (qty === stack.qty && !target) {
                stack.owner = to;
                stack.equipped = null;
                moved = stack.id;
            } else {
                take(inv, stack, qty);
                if (target) {
                    target.qty += qty;
                    if (stack.story === true) target.story = true;
                    moved = target.id;
                } else {
                    moved = addStack(ctx, inv, def.id, qty, to, note, stack.key === true, stack.story === true);
                    if (cond < COND_MAX) condWrite(ctx, inv, inv.stacks[moved], cond - COND_MAX);
                }
            }
            return {
                summary: `${capitalize(ownerNameIn(ctx, from))} gives ${itemText(def.name, qty)} to ${ownerNameIn(ctx, to)}.`,
                data: { def: def.id, qty, from, to, stack: moved },
                narrate: told(ctx),
            };
        },

        'inventory.drop'(ctx, payload = {}) {
            const inv = ctx.draft('inventory');
            const stack = stackIn(ctx, inv, payload.stack);
            refuseBound(ctx, inv, stack);
            const def = inv.defs[stack.def];
            const qty = count(ctx, payload.qty, stack.qty);
            if (qty > stack.qty) ctx.fail('NOT_ENOUGH', shortOf(def.name, stack.qty));
            const owner = stack.owner;
            guardReaderEdit(ctx, 'inventory.drop', editStack(stack));
            take(inv, stack, qty);
            return {
                summary: `${capitalize(ownerNameIn(ctx, owner))} drops ${itemText(def.name, qty)}.`,
                data: { def: def.id, qty, owner, stack: stack.id, ...(ctx.cause === 'ui' ? { edit: true } : {}) },
                narrate: told(ctx),
            };
        },

        'inventory.equip'(ctx, payload = {}) {
            const inv = ctx.draft('inventory');
            const stack = stackIn(ctx, inv, payload.stack);
            const def = inv.defs[stack.def];
            if (def.kind !== 'equipment') ctx.fail('REFUSED', `${def.name} is not equipment; it cannot be worn or wielded.`);
            const slot = payload.slot ?? def.slot;
            if (!nonBlank(slot)) ctx.fail('REFUSED', `${def.name} has no slot to be worn in.`);
            const where = slot.trim();
            if (stack.equipped === where) ctx.fail('REFUSED', `${def.name} is already equipped.`);
            // (a bound piece worn in another slot stays there, and a bound piece in this slot is not put away)
            if (stack.equipped !== null) refuseBound(ctx, inv, stack);
            const occupant = Object.values(inv.stacks).find(other => other.id !== stack.id && other.owner === stack.owner && other.equipped === where);
            if (occupant) refuseBound(ctx, inv, occupant);
            if (occupant) occupant.equipped = null;
            stack.equipped = where;
            const away = occupant ? `, putting away ${inv.defs[occupant.def].name}` : '';
            return {
                summary: `${capitalize(ownerNameIn(ctx, stack.owner))} equips ${def.name} (${where})${away}.`,
                data: { stack: stack.id, def: def.id, slot: where, replaced: occupant?.id ?? null },
                narrate: told(ctx),
            };
        },

        'inventory.unequip'(ctx, payload = {}) {
            const inv = ctx.draft('inventory');
            const stack = stackIn(ctx, inv, payload.stack);
            refuseBound(ctx, inv, stack);
            const def = inv.defs[stack.def];
            if (stack.equipped === null) ctx.fail('REFUSED', `${def.name} is not equipped.`);
            const slot = stack.equipped;
            stack.equipped = null;
            return {
                summary: `${capitalize(ownerNameIn(ctx, stack.owner))} takes off ${def.name}.`,
                data: { stack: stack.id, def: def.id, slot },
                narrate: told(ctx),
            };
        },

        'inventory.split'(ctx, payload = {}) {
            const inv = ctx.draft('inventory');
            const stack = stackIn(ctx, inv, payload.stack);
            refuseBound(ctx, inv, stack);
            const def = inv.defs[stack.def];
            if (stack.qty < 2) ctx.fail('REFUSED', `There is only one ${def.name}; it cannot be split.`);
            const qty = payload.qty;
            if (!isCount(qty, 1) || qty >= stack.qty) ctx.fail('INVALID', `Split off between 1 and ${stack.qty - 1} ${def.name}.`);
            stack.qty -= qty;
            const made = addStack(ctx, inv, def.id, qty, stack.owner, stack.note, stack.key === true, stack.story === true);
            const cond = condOf(stack, inv);
            if (cond < COND_MAX) condWrite(ctx, inv, inv.stacks[made], cond - COND_MAX);
            return {
                summary: `${itemText(def.name, qty)} set apart from the rest.`,
                data: { stack: stack.id, made, qty },
                narrate: false,
            };
        },

        // Only alike stacks join: the same def, owner, equipped slot and note.
        'inventory.merge'(ctx, payload = {}) {
            const inv = ctx.draft('inventory');
            const stack = stackIn(ctx, inv, payload.stack);
            const into = stackIn(ctx, inv, payload.into);
            refuseBound(ctx, inv, stack);
            refuseBound(ctx, inv, into);
            const def = inv.defs[stack.def];
            if (stack.id === into.id) ctx.fail('INVALID', 'A stack cannot be put together with itself.');
            if (stack.def !== into.def) ctx.fail('REFUSED', `${def.name} and ${inv.defs[into.def].name} are different items.`);
            if (!def.stack) ctx.fail('REFUSED', `${def.name} does not stack.`);
            if (stack.owner !== into.owner) ctx.fail('REFUSED', `These ${def.name} are held by different owners.`);
            if (stack.equipped !== into.equipped) ctx.fail('REFUSED', `One ${def.name} is worn and the other is not.`);
            if (stack.note !== into.note) ctx.fail('REFUSED', `These ${def.name} have different notes.`);
            if (condOf(stack, inv) !== condOf(into, inv)) ctx.fail('REFUSED', `These ${def.name} are in different condition.`);
            if ((stack.key === true) !== (into.key === true)) ctx.fail('REFUSED', `One ${def.name} is a key item, kept apart from the rest.`);
            into.qty += stack.qty;
            if (stack.story === true) into.story = true;
            delete inv.stacks[stack.id];
            return {
                summary: `${def.name} put together (${into.qty}).`,
                data: { stack: stack.id, into: into.id, qty: into.qty },
                narrate: false,
            };
        },

        'wallet.set'(ctx, payload = {}) {
            byReader(ctx);
            const owner = receiverArg(ctx, payload.owner);
            if (!isCount(payload.amount, 0)) ctx.fail('INVALID', E.purseAmount);
            const inv = ctx.draft('inventory');
            const wallet = (inv.wallets[owner] ??= {});
            const from = wallet[WALLET_KEY] ?? 0;
            wallet[WALLET_KEY] = payload.amount;
            return { summary: fill(E.purseSet, { amount: formatAmount(payload.amount, currencyIn(ctx)) }),
                data: { edit: true, from, to: payload.amount, told: payload.starting === true ? TOLD.startPurse : TOLD.editPurse }, narrate: true };
        },

        // { owner, amount, note? }, amount in whole units of the one currency. Like inventory.grant, not
        // from a button on its own: the story, the host, or another module's command through ctx.call
        // (a shop's trade.buy pays; a reward's quest.finish receives).
        'wallet.pay'(ctx, payload = {}) {
            byModule(ctx, 'Money cannot be paid from a button on its own; it is paid by the story or by another module\'s action.');
            return pay(ctx, env, {
                owner: ownerArg(ctx, payload.owner),
                amount: count(ctx, payload.amount, undefined, 'amount'),
                note: textArg(ctx, payload.note, 120, 'note'),
            });
        },

        // `story: true` (a module's call): money the story alone vouched for (a quest reward the story
        // wrote). It is paid in full (there is no per-reply limit) and counted for the reply: during a
        // capture the reply being read; outside one (a click after the reply, RX-E-2) the reply the click is
        // stored on, the head carrier (ctx.reply), so `inventory.storyBudget` can tell a reply's coin lines
        // from the payouts after it. Without the flag, a module's payout is not counted.
        'wallet.receive'(ctx, payload = {}) {
            byModule(ctx, 'Money cannot be handed out from a button; it comes from the story or from another module\'s action.');
            if (payload.story !== undefined && typeof payload.story !== 'boolean') ctx.fail('INVALID', 'story must be true or false.');
            const args = {
                owner: receiverArg(ctx, payload.owner),
                amount: count(ctx, payload.amount, undefined, 'amount'),
                note: textArg(ctx, payload.note, 120, 'note'),
            };
            return payload.story === true && ctx.caller ? receiveStory(ctx, env, args, true) : receive(ctx, env, args);
        },

        // { stack, amount }: gear condition down / up, for another module's rules only (ctx.caller).
        'inventory.wear': (ctx, payload = {}) => wear(ctx, payload),
        'inventory.repair': (ctx, payload = {}) => repair(ctx, payload),
        // { owner, slot, step }: the piece `owner` wears in `slot` (weapon | armour | shield) takes scuff | tear | ruin wear (part 2's fights).
        // (no feature on the command: a roll that carries a gear record wears by it with the switch off; gearWear itself refuses everyone else)
        'gear.wear': (ctx, payload = {}) => gearWear(ctx, payload),
        'item.equip': Object.assign((ctx, payload = {}) => itemEquip(ctx, payload), { feature: FEATURE.gear }),
        // { owner }: a member's bound pieces leave with them / come back with them (the party module's leave and join; GEAR.md "Signature gear").
        'inventory.stow': Object.assign((ctx, payload = {}) => stow(ctx, payload), { feature: FEATURE.gear }),
        // (no feature on restore: what was set aside always comes back, whatever the switch says when they return)
        'inventory.restore': (ctx, payload = {}) => restore(ctx, payload),
        // { owner }: a removed member's things go to the party's bag, plain (no feature: whatever the switch says).
        'inventory.release': (ctx, payload = {}) => release(ctx, payload),
        // { sid, pick: [index…] }: the reader takes what they picked of a reply's loot.
        'inventory.lootTake': Object.assign((ctx, payload = {}) => lootTake(ctx, payload, env), { feature: FEATURE.loot }),
    };
}

// ---------- capture (§4.4): runs as a story command ----------

// What one reply's story lines give. The story decides what it pays: there is no per-reply cap on coin,
// items or goods (only a thing that does not stack, a stack per piece, is held to MAX_UNSTACKED a line).
// Code's own payouts (a module's wallet.receive or inventory.grant through ctx.call) are not counted
// here, except a payout a module says the story alone vouched for (`wallet.receive { story: true }`), during
// the reply's capture or by a click after it (counted against the reply the click is stored on, ctx.reply;
// RX-E-2). `inventory.storyBudget` tells a module what has been given (createInventoryQueries).
// What was given is still counted, for modules that tell a reply whose coin lines paid from one whose
// quest payouts did: the inventory slice keeps `perReply[<sid>]` = { coin, vouched?, debit? }, under the
// reply's record ID (ctx.carrier.sid, which stays with the reply when earlier messages are deleted), so it
// rolls back with the reply and starts again on the next one or another swipe. A reply adds its own entry
// and drops the others; `perReply` is the domain's `scratch` (ops.js): on replay a drop of an entry already
// gone (its reply deleted) is passed over, so no reply's gains hang on another's. An older chat's entries
// also hold `worth`, `made`, `items` and `notable`: they are ignored, and a stored reply replays as it was
// written (its ops hold what it gave).
// A click's vouched payout (a2-3) adds its own key instead, `storyClicks[<sid>][<receipt id>] = paid`
// (scratch too, add-only, on the same carrier), and never writes the reply's entry: a swipe or delete of
// the reply takes it back with the reply. The reply's money given is its entry's `coin` plus its clicks.

// What the story gives past the carry limit (`story-block.encumbrance`): kept, and the party is
// encumbered (derived from the load: inventory.encumbrance), so `true` comes back; with the feature
// off the line is refused with the module's reason, as F39 has it. No module answering: no limit.
function storyCarry(ctx, def, qty, owner) {
    const fits = carryFits(ctx, [{ defId: def.id, qty }], owner);
    if (!fits || fits.ok) return false;
    if (!featureOn(ctx, FEATURE.encumbrance)) ctx.fail('REFUSED', fits.message);
    return true;
}

const ENCUMBERED_NOTE = ' The party now carries more than it can and is encumbered until something is put down.';

// A consumable the story says was used (MODULES §F96): `- item Potion | used: yes`, or a used-word in
// the line or the reply, and no word that says it went another way.
export const USED_WORDS = /\b(?:used|uses|drank|drinks|drunk|ate|eats|eaten|applied|applies|quaffed|swallowed|consumed)\b/i;
export const GONE_WORDS = /\b(?:lost|loses|sold|sells|gave|given|gives|dropped|stolen|traded|handed|broke|broken|spilled|spilt)\b/i;

/** Whether a `- item` line says the thing was used (not lost, sold, given…): see USED_WORDS. */
export function usedByLine(line, replyText = '') {
    const labels = Object.entries(line?.labels ?? {}).map(([name, value]) => `${name} ${value}`).join(' ');
    const own = `${line?.text ?? ''} ${labels}`;
    if (GONE_WORDS.test(own)) return false;
    if (/^(?:yes|true|1)$/i.test(String(line?.labels?.used ?? '').trim())) return true;
    return USED_WORDS.test(own) || USED_WORDS.test(String(replyText ?? ''));
}

// A used consumable goes to the module that answers `item.use` (its effect is that module's rules):
// `item.use { name, on, qty, story: true }`. Null when no module answers it (the line then takes the
// thing away, as before); a refusal there refuses the line, so the thing stays.
function useInStory(ctx, line, def, qty) {
    const on = labelOf(line, 'on', 'who', 'by');
    let out;
    try {
        out = ctx.call('item.use', { name: def.name, ...(on ? { on } : {}), qty, story: true });
    } catch (error) {
        if (error?.code === 'UNKNOWN_COMMAND' && String(error.message).includes('"item.use"')) return null;
        throw error;
    }
    const data = isPlainObject(out?.data) ? out.data : {};
    return {
        summary: typeof out?.summary === 'string' && out.summary ? out.summary : `${itemText(def.name, qty)} used.`,
        data: { ...clone(data), def: def.id, qty, used: true },
        narrate: typeof out?.narrate === 'boolean' ? out.narrate : false,
    };
}

// The stats a line names (`| DEX: +2 | STR: 1`): { DEX: 2, STR: 1 } for the whole numbers above 0; gearDefine holds them to the rarity's budget.
function statWords(line) {
    const out = {};
    for (const stat of GEAR.stats) {
        const written = labelOf(line, stat.toLowerCase());
        const n = written === null ? NaN : Number(/^\s*\+?(\d{1,3})\s*$/.exec(written)?.[1]);
        if (Number.isSafeInteger(n) && n > 0) out[stat] = n;
    }
    return out;
}

// With gear on, a gained item's `equipped: <slot>` puts it on: the slot is the word's (weapon, body, off-hand, head, cloak, feet, accessory),
// one item per slot per owner, so what was in it is put away. Equipment only; a word that is no slot, or one the item does not fit, is passed over.
// (the story's gains go to the party's bag, where nothing is bound: a bound piece is a member's, so it is never the one put away here)
function equipFromLine(inv, def, stackIds, word) {
    if (word === null || def.kind !== 'equipment' || !stackIds?.length) return null;
    const named = slotWordOf(word);
    const own = slotWordOf(def.slot);
    if (!named || (own && baseSlot(named) !== baseSlot(own))) return null;
    const id = [...stackIds].reverse().find(sid => inv.stacks[sid] && inv.stacks[sid].equipped === null);
    if (!id) return null;
    const stack = inv.stacks[id];
    let where = placeOf(named);
    if (named === 'accessory') {
        const taken = key => Object.values(inv.stacks).some(other => other.owner === stack.owner && other.id !== stack.id && other.equipped === key);
        where = ['accessory-1', 'accessory-2'].find(key => !taken(key)) ?? 'accessory-1';
    }
    const occupant = Object.values(inv.stacks).find(other => other.id !== stack.id && other.owner === stack.owner && other.equipped === where);
    if (occupant) occupant.equipped = null;
    stack.equipped = where;
    return `${def.name} is equipped (${where}).`;
}

/** `+ item Name | qty | note`, `- item Name | qty`, `~ item Name | note | qty | name` (a rename). */
export function captureItem(ctx, line, env) {
    const inv = ctx.draft('inventory');
    const name = cleanName(line?.name);
    if (!name) ctx.fail('INVALID', 'An item line needs the item\'s name.');
    const text = String(line.text ?? '').trim();
    // An "item" named as money (the currency, a coin, "Silver Coins", "3 silver coins") goes to the
    // wallet, as the coin and loot lines read the same words (B-a1-7).
    const currency = currencyIn(ctx);
    if (isCurrencyName(name, currency) || countedMoney(name, currency)) return itemAsCoin(ctx, line, env, currency);
    if (line.op === '+') {
        const qty = lineQty(ctx, line, 1);
        if (qty < 1) ctx.fail('INVALID', 'A gained item needs a quantity of at least 1.');
        const note = trimText(labelOf(line, 'note') ?? text, MAX_NOTE);
        const { def, created } = defineByName(ctx, inv, name, env, { note, owner: 'party', words: { kind: labelOf(line, 'kind'), slot: labelOf(line, 'slot') ?? labelOf(line, 'equipped', 'equip', 'worn'), rarity: labelOf(line, 'rarity', 'quality'), stats: statWords(line) } });
        const held = storyItems(def, qty);
        // Asked before the stacks change: `add` is weight on top of what is carried now.
        const heavy = storyCarry(ctx, def, held.qty, 'party');
        // Given by a story line: the story's own whatever its def (B-a2-2), for what it sells for.
        const stacks = grantInto(ctx, inv, def, held.qty, 'party', note, false, true);
        const worn = gearOn(ctx) ? equipFromLine(inv, def, stacks, labelOf(line, 'equipped', 'equip', 'worn')) : null;
        return {
            summary: `The party gains ${itemText(def.name, held.qty)}.${worn ? ` ${worn}` : ''}${heavy ? ENCUMBERED_NOTE : ''}`,
            data: { def: def.id, qty: held.qty, owner: 'party', stacks, created, from: labelOf(line, 'from') ?? '', ...(heavy ? { encumbered: true } : {}) },
            narrate: false,
            ...(held.problem ? { problem: held.problem } : {}),
        };
    }
    if (line.op === '-') {
        const def = knownDef(ctx, inv, name);
        const qty = lineQty(ctx, line, 1);
        if (qty < 1) ctx.fail('INVALID', 'A lost item needs a quantity of at least 1.');
        if (def.kind === 'consumable' && usedByLine(line, ctx.chat?.reply)) {
            const used = useInStory(ctx, line, def, qty);
            if (used) return used;
        }
        const held = unbound(ctx, inv, stacksOf(inv, def.id));
        const have = held.reduce((sum, stack) => sum + stack.qty, 0);
        if (!have) ctx.fail('NOT_FOUND', `There is no ${def.name} in the inventory.`);
        if (have < qty) ctx.fail('NOT_ENOUGH', shortOf(def.name, have));
        takeAcross(inv, held, qty);
        return {
            summary: `Lost ${itemText(def.name, qty)} (${have - qty} left).`,
            data: { def: def.id, qty, left: have - qty },
            narrate: false,
        };
    }
    if (line.op === '~') {
        const def = knownDef(ctx, inv, name);
        const changes = [];
        const worn = labelOf(line, 'wear');
        if (worn !== null) changes.push(storyWear(ctx, inv, def, worn, trimText(text, MAX_NOTE)).replace(/\.$/, ''));
        // With gear on, the story's repair word mends a piece (one condition word up) or restores it (back to Good).
        const mended = gearOn(ctx) ? labelOf(line, 'repair', 'repaired', 'mend') : null;
        if (mended !== null) changes.push(storyRepair(ctx, inv, def, mended).replace(/\.$/, ''));
        const rename = labelOf(line, 'name', 'rename');
        if (rename !== null && cleanName(rename) && cleanName(rename) !== def.name) {
            const lots = stacksOf(inv, def.id);
            if (lots.length) refuseBound(ctx, inv, lots.find(lot => boundId(ctx, lot)) ?? lots[0]);
            const next = cleanName(rename);
            const key = aliasKey(next);
            const taken = (inv.aliases[key] && inv.aliases[key] !== def.id)
                || Object.values(inv.defs).some(other => other.id !== def.id && aliasKey(other.name) === key);
            if (taken) ctx.fail('REFUSED', `"${next}" is already the name of another item.`);
            if (next.length > MAX_NAME) ctx.fail('INVALID', `An item needs a name of 1 to ${MAX_NAME} characters.`);
            const old = def.name;
            inv.aliases[aliasKey(old)] ??= def.id;
            inv.aliases[key] = def.id;
            def.name = next;
            changes.push(`${old} is now called ${next}`);
        }
        // With a wear label the text says how it happened, not a new note.
        const note = labelOf(line, 'note') ?? (worn === null && mended === null ? text || null : null);
        const qty = labelOf(line, 'qty', 'quantity', 'count') === null ? null : lineQty(ctx, line, null);
        let problem = null;
        let heavy = false;
        if (note !== null || qty !== null) {
            const held = stacksOf(inv, def.id);
            if (!held.length) ctx.fail('NOT_FOUND', `There is no ${def.name} in the inventory.`);
            if (held.length > 1) ctx.fail('INVALID', `There are several lots of ${def.name}; the line cannot say which one changed.`);
            const stack = held[0];
            if (qty !== null) refuseBound(ctx, inv, stack);
            if (note !== null) {
                stack.note = trimText(note, MAX_NOTE);
                changes.push(`${def.name}: ${stack.note || 'note cleared'}`);
            }
            if (qty !== null) {
                if (qty > 1 && !def.stack) ctx.fail('REFUSED', `${def.name} does not stack.`);
                if (qty === 0) delete inv.stacks[stack.id];
                else if (qty > stack.qty) {
                    // A raised count is a gain (r2-1): held to the carry limit.
                    const held = storyItems(def, qty - stack.qty, true);
                    // Asked before the count moves: `add` is weight on top of what is carried now.
                    if (storyCarry(ctx, def, held.qty, stack.owner)) heavy = true;
                    stack.qty += held.qty;
                    problem = held.problem;
                } else stack.qty = qty;
                changes.push(`${def.name} now ${qty === 0 ? 0 : stack.qty}`);
            }
        }
        if (!changes.length) ctx.fail('INVALID', `The line changes nothing about ${def.name}.`);
        return {
            summary: `${changes.join('; ')}.${heavy ? ENCUMBERED_NOTE : ''}`,
            data: { def: def.id, ...(heavy ? { encumbered: true } : {}) },
            narrate: false,
            ...(problem ? { problem } : {}),
        };
    }
    return ctx.fail('INVALID', `"${line.op} item" is not a change the inventory understands; use +, - or ~.`);
}

// `+ item Marks | qty: 44`, `- item mark`: the party's wallet, as `+ coin 44` / `- coin 1` would.
function itemAsCoin(ctx, line, env, currency) {
    if (line.op !== '+' && line.op !== '-') {
        ctx.fail('INVALID', `${currency.plural} are money, not an item; write + coin or - coin with the amount.`);
    }
    const count = lineQty(ctx, line, 1);
    if (count < 1) ctx.fail('INVALID', 'An amount of money must be more than nothing.');
    // `+ item Silver | qty: 3` is 3 silver: counted in the smallest unit (money.js coinValue); `+ item 3
    // silver coins` too (the number in the name times the quantity).
    const counted = countedMoney(cleanName(line?.name), currency);
    const amount = counted ? count * counted.count * counted.value : count * Math.max(1, coinValue(cleanName(line?.name), currency));
    if (!Number.isSafeInteger(amount)) ctx.fail('INVALID', 'That amount is too large.');
    const who = labelOf(line, line.op === '+' ? 'from' : 'to');
    const note = who ? `${line.op === '+' ? 'from' : 'to'} ${trimText(who, 80)}` : '';
    return line.op === '+'
        ? receiveStory(ctx, env, { owner: 'party', amount, note })
        : payStory(ctx, env, { owner: 'party', amount, note });
}

// A story line's money, counted for the reply (storyCoin); `vouched` for a module's payout
// that the story alone vouched for (wallet.receive { story: true }).
function receiveStory(ctx, env, { owner, amount, note }, vouched = false) {
    storyCoin(ctx, ctx.draft('inventory'), amount, vouched);
    return receive(ctx, env, { owner, amount, note });
}

// A story payment can spend up to what the wallet holds.
function payStory(ctx, env, { owner, amount, note }) {
    return pay(ctx, env, { owner, amount, note });
}

/** `+ coin 30 | from: who`, `- coin 5 | to: who`: the party's wallet; only the number counts. */
export function captureCoin(ctx, line, env) {
    const written = labelOf(line, 'amount') ?? String(line?.name ?? '');
    if (line?.op !== '+' && line?.op !== '-') {
        ctx.fail('INVALID', `"${line?.op} coin" is not a change the wallet understands; use + coin or - coin.`);
    }
    // With coins, "3 silver" is read in the smallest unit here, before it is counted for the reply.
    const parsed = parseAmount(written, currencyIn(ctx));
    if (parsed.error) ctx.fail('INVALID', parsed.error);
    const who = labelOf(line, line.op === '+' ? 'from' : 'to');
    const note = who ? `${line.op === '+' ? 'from' : 'to'} ${trimText(who, 80)}` : '';
    return line.op === '+'
        ? receiveStory(ctx, env, { owner: 'party', amount: parsed.amount, note })
        : payStory(ctx, env, { owner: 'party', amount: parsed.amount, note });
}

// ---------- queries (read-only, plain copies) ----------

/**
 * The inventory queries; `env.settings()` gives the currency for `inventory.currency` and the reader's
 * money scale, `env.economy()` the enabled pack's ({ scale } or null) for `inventory.economy`.
 */
export const createInventoryQueries = env => ({
    // { scale, source: 'pack' | 'settings' | 'default' } (MODULES §F104): multiply built-in money defaults by scale.
    'inventory.economy': () => {
        let pack = null;
        try { pack = typeof env.economy === 'function' ? env.economy() : null; } catch { /* no packs: none */ }
        return economyOf(env.settings(), pack);
    },
    // { name, plural, short }: the chat's one currency (MODULES.md F1); name singular ("mark").
    // The reader's currency, the pack's, or gold.
    'inventory.currency': () => resolveCurrency(env.settings()),
    // Each row's `carry` (the capacity the thing adds, PACKS.md "Carry capacity") is the carry module's
    // (`items.carry` → bonuses by stack: a pack's `carry` or the reader's own) when one answers, else the def's.
    // [def copies], ID-sorted: every definition the inventory holds (default) or those of `ids` that it
    // has; unknown IDs are left out, malformed arguments give []. It reads the definitions as the asking
    // transaction has them (drafts included), makes nothing and does not depend on a pack being installed:
    // a pack's item registered by the rules module stays here after the pack is removed.
    'inventory.definitions': (state, args) => definitionsOf(state?.domains?.inventory, args),
    'inventory.items': (state, args = {}, tools) => listItems(state?.domains?.inventory, args?.owner ?? null, carryBonuses(tools), gearIsOn(env), boundNames(state, tools, env)),
    'inventory.counts': state => {
        const inventory = state?.domains?.inventory, stacks = Object.values(inventory?.stacks ?? {}), totals = new Map();
        for (const stack of stacks) {
            const key = JSON.stringify([stack.def, stack.owner]);
            totals.set(key, (totals.get(key) ?? 0) + stack.qty);
        }
        return Object.fromEntries(stacks.map(stack => [stack.id, inventory.defs?.[stack.def]?.stack === false
            ? totals.get(JSON.stringify([stack.def, stack.owner])) : stack.qty]));
    },
    // { budget, paid, left, vouched }: the story money (`+ coin` lines and modules' `wallet.receive { story:
    // true }`) the current reply has given (RX-E-2); `vouched` is the part of `paid` that modules' vouched
    // payouts gave (quest rewards), so a module can tell a reply whose money its own payouts gave from one
    // whose coin lines did. There is no per-reply limit (the story decides what it pays), so `budget` and
    // `left` are always null; they stay in the answer for modules written when a limit could be set. The
    // current reply is the one the asking command is stored on (tools.reply: a capture's carrier, else the
    // head carrier); with none known, nothing is counted as given yet.
    'inventory.storyBudget': (state, args, tools) => {
        const stored = storedTally(state?.domains?.inventory, tools?.reply?.sid);
        const clicks = tools?.reply?.sid ? clicksOf(state?.domains?.inventory, tools.reply.sid) : 0;
        const paid = tallied(stored?.coin) + clicks;
        return { budget: null, paid, left: null, vouched: Math.min(paid, tallied(stored?.vouched) + clicks) };
    },
    'inventory.wallet': (state, args = {}) => ({ ...(state?.domains?.inventory?.wallets?.[args?.owner ?? 'party'] ?? {}) }),
    // { status: 'found' | 'ambiguous' | 'none', defs: [def copies], stacks: [items of the found def] }
    'inventory.find': (state, args = {}, tools) => {
        const inventory = state?.domains?.inventory;
        const found = resolveDef(inventory, args?.name ?? '');
        return {
            status: found.status,
            defs: found.ids.map(id => clone(inventory.defs[id])),
            stacks: found.status === 'found' ? listItems(inventory, null, null, gearIsOn(env), boundNames(state, tools, env)).filter(item => item.def === found.id) : [],
        };
    },
    'inventory.equipment': (state, args, tools) => equipmentView(state, tools),
    // The loot laid out and not taken yet, newest first: [{ sid, where, n, items: [{ name, qty }] }].
    'inventory.loot': Object.assign((state) => {
        const inventory = state?.domains?.inventory;
        const claims = state?.meta?.claims ?? {};
        return Object.values(isPlainObject(inventory?.loot) ? inventory.loot : {})
            .filter(offer => isPlainObject(offer) && typeof offer.sid === 'string' && !Object.hasOwn(claims, offer.claim || `loot:${offer.sid}`) && lootItems(offer)?.length)
            .sort((a, b) => (b.n ?? 0) - (a.n ?? 0) || (a.sid < b.sid ? -1 : 1))
            .map(offer => ({ sid: offer.sid, where: offer.where, n: offer.n, items: clone(lootItems(offer)) }));
    }, { feature: FEATURE.loot }),
    // { stack } → { stack, cond, events: [{ key, d, n }] } (the events as they apply), or null.
    'inventory.condition': (state, args = {}) => {
        const inventory = state?.domains?.inventory;
        const stack = typeof args?.stack === 'string' && isPlainObject(inventory?.stacks?.[args.stack]) ? inventory.stacks[args.stack] : null;
        return stack ? { stack: stack.id, cond: condOf(stack, inventory), events: condEvents(inventory, stack.id) } : null;
    },
    'inventory.legendEarned': Object.assign((_state, _args, tools) => legendEarned(tools), { feature: FEATURE.gear }),
    'inventory.encumbrance': Object.assign((state, args, tools) => encumbrance(state, tools, gearIsOn(env)), { feature: FEATURE.encumbrance }),
    // `story-block.gear`: { owner } → { on, owner, weapon, armour, shield: { name, bonus, cond, broken } | null, carry: { load, capacity,
    // encumbered, penalty } } (part 2's rolls read it), and `gear.carry`, `items.carry`'s answer when no carry module gives one.
    ...createGearQueries({
        on: () => gearIsOn(env), kit: () => kitOpen(env), empty: () => { try { return env?.chatEmpty?.() === true; } catch { return false; } },
        condOf, carryOf: defCarry, penalty: ENCUMBERED_PENALTY, feature: FEATURE.gear,
        names: (state, tools, id) => gearWearers(state, tools, env).names.get(id) ?? (id === 'party' ? 'The party' : String(id)),
        owners: (state, tools) => gearWearers(state, tools, env).owners,
    }),
});

// ---------- prompt view (§5) ----------
