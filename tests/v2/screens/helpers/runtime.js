// Where the screens part's tests find Story Block's view runtime.
//
// * `validateScreen` / `resolveData` (src/v2/view/screens.js) are pure and merged on Story Block's v2:
//   a copy lives in ../vendor/ (see VERSION), so the definitions are always checked, CI included.
// * The template renderer, scoped CSS, the condition language, the standard widgets and the card
//   mount need a Story Block checkout: set STORY_BLOCK_DIR to one (its root, with src/v2/view/template/).
//   Without it the render tests are skipped with the reason below.

import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const vendored = await import('../vendor/screens.js');

const dir = process.env.STORY_BLOCK_DIR ? resolve(process.env.STORY_BLOCK_DIR) : null;
const file = rel => pathToFileURL(join(dir, rel)).href;

async function loadRenderer() {
    if (!dir) return { runtime: null, reason: 'Story Block\'s template renderer is not in this repository; set STORY_BLOCK_DIR to a Story Block checkout to run the render tests.' };
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
