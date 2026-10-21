// Story Director v2, atlas part: the Map screen (SPEC §13.1), data like every screen.
//
// A tab and a full-screen view: Story Block's `ss.map` widget bound to the `atlas.map` query, a
// click on a place running `atlas.focus`, and under the map the picked place with its routes and
// their times (`atlas.selected`). Places the story has not reached show as "?" next to known
// ones (fog `unknown`). Cards and packs may restyle or replace it by its id.

export const MAP_SCREEN_ID = 'story-director/map';

const TEMPLATE = `<div class="atlas">
  <ss-widget name="ss.map" data-props='{"bind":"q.map","onSelect":"atlas.focus","fog":"unknown","label":"Map"}'></ss-widget>
  <section class="atlas-place" data-if="q.selected != null">
    <h3 class="atlas-name">{{ q.selected.name }}</h3>
    <p class="atlas-about"><span data-if="q.selected.kind != ''">{{ q.selected.kind }}</span><span data-if="q.selected.region != ''"> · {{ q.selected.region }}</span><span data-if="q.selected.discovered != true"> · not visited</span></p>
    <ul class="atlas-routes" data-if="len(q.selected.routes) > 0">
      <li data-each="q.selected.routes as r">{{ r.otherName }}<span data-if="r.kind != ''"> by {{ r.kind }}</span><span data-if="r.text != ''">, {{ r.text }}</span></li>
    </ul>
    <p class="atlas-none" data-if="len(q.selected.routes) == 0">No known routes from here.</p>
    <button type="button" class="atlas-clear" data-command="atlas.focus" data-payload='{"node":null}'>Close</button>
  </section>
</div>`;

const CSS = `.atlas { display: flex; flex-direction: column; gap: var(--ss-w-gap, 0.4em); }
.atlas-place { border: 1px solid var(--ss-w-border, currentColor); border-radius: var(--ss-w-radius, 6px); padding: 0.4em 0.6em; }
.atlas-name { margin: 0; font-size: 1.05em; }
.atlas-about, .atlas-none { margin: 0.2em 0; opacity: 0.8; }
.atlas-routes { margin: 0.2em 0; padding-left: 1.2em; }
.atlas-clear { margin-top: 0.3em; }`;

/** The Map screen definition. */
export const mapScreen = Object.freeze({
    id: MAP_SCREEN_ID,
    title: 'Map',
    icon: 'fa-map',
    mounts: Object.freeze(['tab', 'screen']),
    template: TEMPLATE,
    css: CSS,
    data: Object.freeze({
        map: Object.freeze({ query: 'atlas.map' }),
        selected: Object.freeze({ query: 'atlas.selected' }),
    }),
});
