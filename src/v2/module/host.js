// Story Director v2: stand-alone fight-runner detection.

import { fightsAmong } from '../fights.js';
import { MODULE_ID } from './parts.js';
import { liveSdk, tryLive } from './shared.js';

// ---- stand-alone (WAVE rule 11) ----------------------------------------------------------------

// Queries that an optional fight runner may answer.
const FIGHT_QUERIES = ['combat.foesBeaten', 'combat.session', 'combat.offers'];
const UNANSWERED = /no module answers|no query called|there is no query/i;

/**
 * Whether another module runs fights: one registers a `combat.*` command (Story Block's live
 * `sdk.modules()`), else answers a `combat.*` query through the view (`view.query`). Null when
 * neither can be asked. Story Director stands alone (WAVE rule 11): without a fight runner its prompt
 * asks for no encounters and tells no beat as a fight.
 *
 * On a host with a module lifecycle (its `sdk.modules()` entries carry `status`) the module must be
 * `ready`: a dormant one (its peer is missing or off), or any module while a restore is pending, is
 * not a fight runner, and nothing falls back to asking a query then. Older hosts have no status; the
 * command probe is kept as it was.
 */
export function fightRunner(view = null) {
    const modules = tryLive(() => liveSdk()?.modules?.(), null);
    if (Array.isArray(modules)) return fightsAmong(modules, MODULE_ID);
    if (typeof view?.query !== 'function') return null;
    return FIGHT_QUERIES.some(name => {
        try {
            view.query(name, {});
            return true;
        } catch (error) {
            return !UNANSWERED.test(String(error?.message ?? error));
        }
    });
}
