// Where the screens part's tests find Story Block's view runtime.
//
// * Story Block's view runtime (validateScreen, resolveData, the template renderer, scoped CSS, the
//   condition language, the standard widgets and the card mount) is vendored with the testkit in
//   tests/vendor/story-block/ (npm run sync-testkit in Story Block; see its VERSION), so the
//   definitions are checked and the screens rendered in CI too.
// * STORY_BLOCK_DIR (a Story Block checkout's root) renders against that checkout instead.

import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const VENDORED = new URL('../../../vendor/story-block/', import.meta.url);
const vendored = await import(new URL('src/v2/view/screens.js', VENDORED).href);

const dir = resolve(process.env.STORY_BLOCK_DIR ?? fileURLToPath(VENDORED));
const file = rel => pathToFileURL(join(dir, rel)).href;

async function loadRenderer() {
    if (!existsSync(join(dir, 'src/v2/view/template/index.js'))) return { runtime: null, reason: `STORY_BLOCK_DIR (${dir}) has no src/v2/view/template/index.js.` };
    try {
        const [template, bind, css, events, widgets, card, screens] = await Promise.all([
            import(file('src/v2/view/template/index.js')),
            import(file('src/v2/view/bind.js')),
            import(file('src/v2/view/css.js')),
            import(file('src/v2/events/index.js')),
            import(file('src/v2/view/widgets/index.js')),
            import(file('src/v2/view/mounts/card.js')),
            import(file('src/v2/view/screens.js')),
        ]);
        return {
            runtime: {
                compileTemplate: template.compileTemplate,
                renderTemplate: template.renderTemplate,
                evaluate: bind.conditionEvaluator({ compile: events.compile, evaluate: events.evaluate }),
                scopeCss: css.scopeCss,
                widgets: widgets.standardWidgets,
                createCardMount: card.createCardMount,
                createScreens: screens.createScreens,
            },
            reason: '',
        };
    } catch (error) {
        return { runtime: null, reason: `Story Block's renderer could not be loaded from ${dir}: ${error?.message ?? error}` };
    }
}

export const { validateScreen, resolveData, createScreens: vendoredScreens, CSS_LIMIT } = vendored;
export const { runtime, reason: skipReason } = await loadRenderer();
