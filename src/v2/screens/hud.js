// Story Director v2, part screens: `story-director/hud` (SPEC §13.1), the thin strip above the message
// box (mount `hud`): the story date and time and the place, on one line, from the head state. On a
// narrow screen the line is cut with an ellipsis rather than wrapped. The time is written on the chat's
// calendar by `director.time` (`text`).

import { BASE_CSS } from './style.js';

export const HUD_ID = 'story-director/hud';

const TEMPLATE = `
<div class="sd-hud" role="status" aria-label="Story time and place">
  <span class="ss-pill sd-when" data-if="q.time.text"><i class="fa-solid fa-clock" aria-hidden="true"></i> <span class="sd-cut">{{ q.time.text }}</span></span>
  <span class="ss-pill ss-pill-soft sd-where" data-if="state.scene.place.name"><i class="fa-solid fa-location-dot" aria-hidden="true"></i> <span class="sd-cut">{{ state.scene.place.name }}</span></span>
</div>
`;

const CSS = `${BASE_CSS}
.sd-hud { display: flex; align-items: center; gap: 8px; min-width: 0; padding: 2px 6px; font-size: 0.85em;
  line-height: 1.6; white-space: nowrap; overflow: hidden; }
.sd-hud:not(:has(span)) { display: none; }
.sd-hud > span { min-width: 0; max-width: 100%; }
.sd-when { flex: 0 1 auto; }
.sd-where { flex: 1 1 0; }
/* The text of a pill is cut with an ellipsis in its own box (text-overflow does not reach a flex pill's text node). */
.sd-cut { display: block; min-width: 0; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sd-hud i { color: var(--sd-accent); margin-right: 2px; }
`;

export const hudScreen = Object.freeze({
    id: HUD_ID,
    title: 'Time and place',
    icon: 'fa-clock',
    mounts: ['hud'],
    data: { time: { query: 'director.time' } },
    template: TEMPLATE,
    css: CSS,
});
