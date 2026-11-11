// Story Director v2, atlas part: the DOM the Map widget is built from (moved out of widget.js unchanged;
// widget.js still exports its public names): `createDom` makes the search bar, Region list, zoom controls,
// stage, layers, details, legend and frame, appends them to the widget element, and returns the nodes the coordinator uses.

import { SVG_NS } from './widget-draw.js';
import { button, h, icon } from './widget-view.js';

export function createDom(el, doc) {
    // ---- the DOM --------------------------------------------------------------------------------
    const root = h(doc, 'div', 'sd-map ss-glass');
    root.setAttribute('role', 'group');
    const bar = h(doc, 'div', 'sd-map-bar');
    const searchBox = h(doc, 'div', 'sd-map-search');
    const input = h(doc, 'input');
    input.setAttribute('type', 'search');
    input.setAttribute('placeholder', 'Find a place');
    input.setAttribute('aria-label', 'Find a place by name, other name or region');
    input.setAttribute('autocomplete', 'off');
    const results = h(doc, 'ul', 'sd-map-results');
    results.setAttribute('aria-label', 'Places found');
    results.hidden = true;
    searchBox.append(input, results);
    const tools = h(doc, 'div', 'sd-map-tools');
    tools.setAttribute('role', 'toolbar');
    tools.setAttribute('aria-label', 'Zoom');
    const zoomIn = button(doc, 'sd-map-btn sd-map-zoom-in', '+', 'Zoom in');
    const zoomOut = button(doc, 'sd-map-btn sd-map-zoom-out', '−', 'Zoom out');
    const fitAll = button(doc, 'sd-map-btn sd-map-fit', '', 'Show the whole layer');
    fitAll.append(icon(doc, 'fa-expand'));
    const centreMe = button(doc, 'sd-map-btn sd-map-me', '', 'Centre on where you are');
    centreMe.append(icon(doc, 'fa-location-crosshairs'));
    // "Tidy the map": a one-time reader action (atlas.edit { tidy: true }), offered while a visited place has no coordinates.
    const tidyBtn = button(doc, 'sd-map-btn sd-map-tidy', 'Tidy the map', 'Tidy the map: give the visited places without coordinates a spot');
    tidyBtn.hidden = true;
    tools.append(zoomIn, zoomOut, fitAll, centreMe, tidyBtn);
    // The layers as a Region list between the search box and the zoom buttons (All first; the shown one selected).
    const regionBox = h(doc, 'label', 'sd-map-region');
    const regions = h(doc, 'select', 'sd-map-regions');
    regions.setAttribute('aria-label', 'Region');
    regionBox.append(h(doc, 'span', 'sd-map-region-cap', 'Region'), regions);
    bar.append(searchBox, regionBox, tools);

    const stage = h(doc, 'div', 'sd-map-stage');
    stage.setAttribute('tabindex', '0');
    stage.setAttribute('role', 'group');
    stage.setAttribute('aria-roledescription', 'map');
    stage.setAttribute('aria-label', 'Map. Drag or use the arrow keys to move; scroll, pinch, or plus and minus to zoom; 0 shows the whole layer.');
    const svg = doc.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'sd-map-svg');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    const worldGroup = doc.createElementNS(SVG_NS, 'g');
    worldGroup.setAttribute('class', 'sd-map-world');
    svg.appendChild(worldGroup);
    const placesLayer = h(doc, 'div', 'sd-map-places');
    placesLayer.setAttribute('role', 'group');
    placesLayer.setAttribute('aria-label', 'Places');
    const labelsLayer = h(doc, 'div', 'sd-map-labels');
    labelsLayer.setAttribute('aria-hidden', 'true');
    const hereRing = h(doc, 'div', 'sd-map-here');
    hereRing.setAttribute('aria-hidden', 'true');
    // The trip's marks above the places: "You" on the current leg, the movers on theirs, each with its pin (all drawn by paint()).
    const markLayer = h(doc, 'div', 'sd-map-marks');
    markLayer.setAttribute('aria-hidden', 'true');
    markLayer.style.cssText = 'position:absolute;inset:0;pointer-events:none;';
    stage.append(svg, placesLayer, labelsLayer, hereRing, markLayer);
    const road = h(doc, 'section', 'sd-map-road');
    road.setAttribute('aria-label', 'On the road');
    road.hidden = true;
    const frame = h(doc, 'div', 'sd-map-frame');
    frame.append(stage, road);

    const empty = h(doc, 'p', 'sd-map-empty', 'No places to show yet.');
    const details = h(doc, 'section', 'sd-map-details');
    details.setAttribute('aria-live', 'polite');
    details.hidden = true;
    const legend = h(doc, 'ul', 'sd-map-legend ss-listcard-rows');
    legend.setAttribute('aria-label', 'Legend');
    const legendCard = h(doc, 'section', 'sd-map-legend-card ss-listcard');
    legendCard.setAttribute('aria-label', 'Legend');
    legendCard.append(h(doc, 'h4', 'ss-label ss-listcard-head', 'Legend'), legend);
    root.append(bar, frame, empty, details, legendCard);
    el.appendChild(root);

    return { root, searchBox, input, results, zoomIn, zoomOut, fitAll, centreMe, tidyBtn, regionBox, regions, stage, worldGroup, placesLayer, labelsLayer, hereRing, markLayer, road, empty, details, legend, legendCard };
}
