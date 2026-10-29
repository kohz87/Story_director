// A small stand-in for example fight runner's crafting (RB #89) for Story Director's tests: a `craft` change line
// (`! craft Iron Sword | hours: 2 | cause: craft`) whose capture moves the story clock through
// `ctx.call('director.advance', { minutes, reason, cause? })`, the way example fight runner's craft part does
// (it passes `reason`, and lets UNKNOWN_COMMAND pass). Only the call's shape; none of the real rules.

export function fakeCraft() {
    return {
        id: 'fake-craft',
        name: 'Crafting (test stand-in)',
        version: '0.0.0-test',
        capture: {
            kinds: { craft: { grammar: '! craft Item | hours: N' } },
            apply(ctx, line) {
                const hours = Number(line?.labels?.hours ?? 1);
                const cause = line?.labels?.cause;
                const out = ctx.call('director.advance', { minutes: Math.round(hours * 60), reason: `Astra crafts ${line.name}`, ...(cause ? { cause } : {}) });
                return { summary: `Astra crafts ${line.name}.`, narrate: true, data: { item: line.name, clock: out?.data ?? null } };
            },
        },
    };
}
