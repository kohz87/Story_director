// A test-only fight runner for checking optional-module behavior. It supplies a party
// and a combat receipt source; Story Director also works when it is absent.

const ACTOR = 'ac_astra001';

export function fakeFightRunner() {
    return {
        id: 'rules-module',
        name: 'example fight runner (test stand-in)',
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
