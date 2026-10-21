// A small stand-in for RPG Battle (module `rpg-battle`, MODULES §B) for Story Director's
// integration tests: a party with one PC, a `combat.beaten` list a test fills with `combat.win`,
// and the two things quests use from it: `combat.foesBeaten({ sinceRev })` and `party.grantXp`.
// Only the shapes of MODULES §B3 and §F5; none of the real rules.

const ACTOR = 'ac_astra001';

export function fakeRpgBattle() {
    return {
        id: 'rpg-battle',
        name: 'RPG Battle (test stand-in)',
        version: '0.0.0-test',
        domains: {
            party: {
                initial: () => ({ pc: ACTOR, order: [ACTOR], actors: { [ACTOR]: { id: ACTOR, name: 'Astra', kind: 'pc', level: 1, xp: 0 } }, xpLog: [] }),
                validate: slice => (Number.isSafeInteger(slice?.actors?.[ACTOR]?.xp) ? [] : ['party xp must be a whole number']),
            },
            combat: { initial: () => ({ beaten: [] }) },
        },
        commands: {
            // A fight won: the test names the foes; the entry carries this receipt's rev (MODULES §B3).
            'combat.win'(ctx, { foes = [] } = {}) {
                const combat = ctx.draft('combat');
                combat.beaten.push({ rev: ctx.rev, foes: foes.map(foe => ({ name: foe.name, count: foe.count })), won: true });
                return { summary: `Astra wins a fight: ${foes.map(foe => `${foe.count} ${foe.name}`).join(', ')}.`, narrate: true, data: {} };
            },
            // MODULES §F5: { actor?, amount?, quest?, difficulty? }; quest XP by difficulty.
            'party.grantXp'(ctx, payload = {}) {
                const party = ctx.draft('party');
                const amount = Number.isSafeInteger(payload.amount) ? payload.amount : { easy: 10, normal: 25, hard: 50, nightmare: 100 }[payload.difficulty] ?? 25;
                party.actors[ACTOR].xp += amount;
                party.xpLog.push({ quest: payload.quest ?? null, amount, caller: ctx.caller ?? null });
                return { summary: `Astra gains ${amount} XP.`, narrate: false, data: { amount } };
            },
        },
        queries: {
            'combat.foesBeaten': (state, { sinceRev = null } = {}) => (state?.domains?.combat?.beaten ?? [])
                .filter(entry => !Number.isInteger(sinceRev) || entry.rev > sinceRev),
            'party.pc': state => {
                const party = state?.domains?.party;
                return party?.pc ? party.actors[party.pc] : null;
            },
        },
    };
}
