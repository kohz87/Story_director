// Real-host component fixture: extend one real SD definition with proof/ledger test adapters.
import { createHost } from '../../../vendor/story-block/testkit/index.js';
import { createModule } from '../../../../src/v2/module.js';
import { neutralAcceptance, prepareThreadWrite, threadWriteEntry } from '../../../../src/v2/tracker/thread-writes.js';
export const TEST_COMMAND = 'director.testAccept';

export async function createSdHost() {
    let host;
    const definition = createModule({ host: { settings: id => host?.sdk.settings(id) ?? null, substitute: text => text } });
    definition.commands[TEST_COMMAND] = (ctx, payload) => {
        let verified = null;
        let proof = null;
        if (payload.words !== undefined || payload.selection !== undefined) {
            proof = ctx.proof({ kind: 'acceptance', payload: { thread: payload.threadId,
                ...(payload.selection !== undefined ? { selection: payload.selection } : { words: payload.words }) } });
            // This consumes the actual host query's pending same-root proof, not a fabricated proof.
            const thread = ctx.query('director.thread', { id: payload.threadId });
            verified = neutralAcceptance(thread, ctx.query('story.evidence', {}), proof.id, { cause: ctx.cause, caller: ctx.caller });
            if (!verified.ok) ctx.fail(verified.code, verified.message);
        }
        let result = null;
        if (payload.write) {
            const director = ctx.draft('director');
            const prepared = prepareThreadWrite(director, 'threads.accept', { write: payload.write,
                thread: payload.threadId, expectedHash: payload.expectedHash }, ctx.hash);
            if (!prepared.ok) ctx.fail(prepared.code, prepared.message);
            result = prepared.retry ? prepared.result : { thread: payload.threadId, hash: payload.expectedHash, accepted: true, linked: false };
            if (!prepared.retry) {
                director.writes ??= {};
                director.writes[payload.write] = threadWriteEntry(prepared, result);
            }
        }
        if (payload.rollback) ctx.fail('FAILED', 'Intentional rollback.');
        return { summary: 'Evidence component fixture.', narrate: false,
            data: { v2: { key: 'evidence-component', result: { proof, verified: verified?.ok ?? false, saved: result } } } };
    };
    // A real capture adapter lets Re-read regenerate its proof through the host's actual reader context.
    const capture = definition.capture;
    definition.capture = { ...capture, kinds: { ...capture.kinds, aaccept: { grammar: '! aaccept ThreadID | words: Reader sentence' } },
        apply(ctx, line) {
            if (line.kind !== 'aaccept') return capture.apply(ctx, line);
            return ctx.call(TEST_COMMAND, { threadId: line.name, words: line.labels?.words ?? '' });
        } };
    host = await createHost({ modules: [definition] });
    return host;
}

export async function seedNeutralHook(host) {
    await host.send('Tell me about the mill.', 'A miller needs help.\n<Changes>\n+ hook The Mill — Help the miller | goal: Talk to the miller\n</Changes>');
    const thread = host.sdk.query('director.threads', { kind: 'hook' }).find(thread => thread.key === 'The Mill');
    if (!thread) throw new Error('The actual SD capture did not create the neutral hook.');
    return thread;
}
export const acceptanceReply = (thread, words) => `The miller listens.\n<Changes>\n! aaccept ${thread.id} | words: ${words}\n</Changes>`;
