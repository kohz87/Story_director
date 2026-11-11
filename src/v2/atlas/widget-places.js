// Story Director v2, atlas part: the Map widget's place details, search and moves (moved out of widget.js;
// widget.js still exports its public names): `createPlaces` returns showDetails, pick, goTo, runSearch
// and chooseHit. Search hits and the selection command are held here; the picked place is in `s`.

import { centreOn, searchPlaces } from './view.js';
import { button, h, humanize, layerFor, onLayer, text } from './widget-view.js';

const MAX_INSIDE = 8;

// Three groups: `dom` (doc and the nodes), `view` (the state `s` and what reads the view) and `hooks` (what the widget lends it).
export function createPlaces({ dom, view, hooks }) {
    const { doc, details, input, results } = dom;
    const { s, byId, measure, getBox, getLimits, closeEnough } = view;
    const { api, paint, initialOnSelect, setLayer, moveTo } = hooks;
    let onSelect = text(initialOnSelect);
    let asked = 0;
    function showDetails(id) {
        const place = byId(id);
        s.picked = place ? id : '';
        if (!place) {
            details.hidden = true;
            details.replaceChildren();
            paint();
            return;
        }
        const close = button(doc, 'sd-map-btn sd-map-close', '×', 'Close');
        const about = [place.kind && humanize(place.kind), place.region].filter(Boolean).join(' · ');
        const status = place.id === s.data.current ? 'You are here.' : place.visited ? 'Visited.' : 'Not visited yet.';
        const trip = h(doc, 'p', 'sd-map-trip');
        // A town lists the places inside it ("Tap a town: the places inside it"); a tap on one goes to it.
        const kids = s.data.places.filter(other => other.parent === place.id).sort((a, b) => a.name.localeCompare(b.name) || (a.id < b.id ? -1 : 1));
        const list = h(doc, 'ul', 'sd-map-inside');
        // Each by its own part ("Guild Office", not "Bluewatch Village / Guild Office"); the first eight, then "+N more".
        for (const kid of kids.slice(0, MAX_INSIDE)) {
            const item = h(doc, 'li');
            const own = kid.line.startsWith(`${place.name} · `) ? kid.line.slice(place.name.length + 3) : kid.line;
            const go = button(doc, 'sd-map-result sd-map-inside-item', own);
            go.setAttribute('data-id', kid.id);
            item.append(go);
            list.append(item);
        }
        if (kids.length > MAX_INSIDE) list.append(h(doc, 'li', 'sd-map-none', `+${kids.length - MAX_INSIDE} more`));
        const inside = kids.length ? [h(doc, 'p', 'sd-map-about', `${kids.length} ${kids.length === 1 ? 'place' : 'places'} inside`), list] : [];
        details.replaceChildren(h(doc, 'h3', 'sd-map-name', place.line), ...(about ? [h(doc, 'p', 'sd-map-about', about)] : []), h(doc, 'p', 'sd-map-status', status), ...inside, trip, close);
        details.setAttribute('data-id', place.id);
        details.hidden = false;
        paint();
        if (place.id === s.data.current) return;
        // The trip from the current place, by known routes: code's figures (travel.js), not the story's.
        const ticket = ++asked;
        let detail = null;
        try {
            detail = typeof api?.query === 'function' ? api.query('atlas.place', { id: place.id }) : null;
        } catch {
            detail = null;
        }
        const fill = out => {
            if (ticket !== asked) return;
            const route = out?.trip;
            if (route) {
                const by = route.by?.length ? ` by ${route.by.join(', ')}` : '';
                trip.textContent = `From ${route.fromName}: ${route.km ? `${route.km} km, ` : ''}${route.text}${by}.`;
                trip.className = 'sd-map-trip';
            } else if (s.data.current) {
                trip.textContent = 'No known route from where you are.';
                trip.className = 'sd-map-trip sd-map-none';
            }
        };
        if (detail && typeof detail.then === 'function') detail.then(fill, () => fill(null));
        else fill(detail);
    }

    function pick(id) {
        showDetails(id);
        if (onSelect && typeof api?.command === 'function') {
            try {
                const out = api.command(onSelect, { node: id });
                if (out && typeof out.catch === 'function') out.catch(() => {});
            } catch { /* a click never breaks the map */ }
        }
    }

    // Moves the map to a place (switching layer when it is not on this one), picks it.
    function goTo(id) {
        const place = byId(id);
        if (!place) return;
        if (!onLayer(place, s.layer)) setLayer(layerFor(place, s.layer));
        measure();
        moveTo(centreOn(s.view, s.points.get(id), getBox(), getLimits(), closeEnough(id)));
        pick(id);
    }

    // ---- search ---------------------------------------------------------------------------------
    let hits = [];
    function runSearch() {
        hits = searchPlaces(s.data.places, input.value);
        const items = hits.map(hit => {
            const place = byId(hit.id);
            const li = h(doc, 'li');
            const choose = button(doc, 'sd-map-result');
            choose.setAttribute('data-id', place.id);
            const about = [place.region, place.id === s.data.current ? 'you are here' : place.visited ? '' : 'not visited'].filter(Boolean).join(' · ');
            choose.append(h(doc, 'span', 'sd-map-result-name', place.name), h(doc, 'span', 'sd-map-result-about', about));
            li.append(choose);
            return li;
        });
        if (input.value.trim() && !items.length) items.push(h(doc, 'li', 'sd-map-none', 'No place by that name.'));
        results.replaceChildren(...items);
        results.hidden = !input.value.trim();
    }
    function chooseHit(id) {
        results.hidden = true;
        goTo(id);
    }

    return {
        showDetails,
        pick,
        goTo,
        runSearch,
        chooseHit,
        setOnSelect(value) { onSelect = text(value); },
        get hits() { return hits; },
    };
}
