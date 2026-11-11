// Story Director v2, atlas part: the Map widget's stylesheet (widget.js draws the widget).
//
// The CSS text, `MAP_CSS` (tests read it) and `ensureStyle`, which adds it to the page once.
// Split out of widget.js; widget.js still exports `MAP_CSS`.

const STYLE_ID = 'sd-atlas-map-style';

// Rules are `.sd-map …` (two classes): enough to win over a host page's plain `button` rules, little
// enough for a screen's scoped CSS to restyle. The colour tokens sit in :where() (no specificity).
const CSS = `
:where(.sd-map) {
  --sd-map-fg: var(--ss-w-fg, var(--ss-text));
  --sd-map-muted: var(--ss-w-muted, color-mix(in srgb, var(--sd-map-fg) 85%, transparent));
  --sd-map-bg: var(--ss-w-map-bg, var(--ss-field));
  --sd-map-raised: var(--ss-w-raised, color-mix(in srgb, var(--sd-map-fg) 8%, transparent));
  --sd-map-border: var(--ss-w-border, var(--ss-border));
  --sd-map-accent: var(--ss-w-accent, var(--ss-accent));
  --sd-map-mover: var(--ss-w-warn, #d9a441);
  --sd-map-route: var(--ss-w-map-route, color-mix(in srgb, var(--sd-map-fg) 45%, transparent));
  --sd-map-overlay: var(--ss-overlay);
  --sd-map-strong: var(--ss-glass-strong);
  display: flex; flex-direction: column; gap: 0.6em; color: var(--sd-map-fg); min-width: 0; max-width: 100%;
  font-family: var(--ss-font);
}
:where(.sd-map *, .sd-map *::before, .sd-map *::after) { box-sizing: border-box; }
:where(.sd-map [hidden]) { display: none !important; }
:where(.sd-map button) { font: inherit; color: inherit; cursor: pointer; }
:where(.sd-map :focus-visible) { outline: 2px solid var(--sd-map-accent); outline-offset: 2px; }
.sd-map.ss-glass { gap: 0.6em; padding: 12px; color: var(--sd-map-fg); border-color: var(--sd-map-border); }
.sd-map .sd-map-search input::placeholder { color: var(--sd-map-muted); opacity: 1; }
.sd-map .sd-map-bar { display: flex; flex-wrap: wrap; gap: 0.4em; align-items: flex-start; }
.sd-map .sd-map-search { position: relative; flex: 1 1 14em; min-width: 0; }
.sd-map .sd-map-search input { width: 100%; min-height: 40px; padding: 0.3em 0.8em; border: 1px solid var(--sd-map-border); border-radius: var(--ss-radius-pill); background: var(--sd-map-raised); color: inherit; font: inherit; }
.sd-map .sd-map-results { position: absolute; z-index: 5; left: 0; right: 0; top: calc(100% + 4px); margin: 0; padding: 0.3em; list-style: none; border: 1px solid var(--sd-map-border); border-radius: var(--ss-radius-m); background: var(--sd-map-strong); backdrop-filter: var(--ss-blur); -webkit-backdrop-filter: var(--ss-blur); max-height: 16em; overflow-y: auto; box-shadow: var(--ss-shadow); }
.sd-map .sd-map-result { display: flex; flex-direction: column; width: 100%; gap: 0; align-items: flex-start; min-height: 40px; padding: 0.3em 0.6em; border: 0; border-radius: var(--ss-radius-s); background: none; text-align: left; }
.sd-map .sd-map-result:hover, .sd-map .sd-map-result:focus-visible { background: var(--sd-map-raised); }
.sd-map .sd-map-result-name { overflow-wrap: anywhere; }
.sd-map .sd-map-result-about { max-width: 100%; color: var(--sd-map-muted); font-size: 0.85em; overflow-wrap: anywhere; }
.sd-map .sd-map-tools { display: flex; flex-wrap: wrap; gap: 0.35em; }
.sd-map .sd-map-btn { min-width: 40px; min-height: 40px; max-width: min(100%, 12em); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 0.15em 0.8em; border: 1px solid var(--sd-map-border); border-radius: var(--ss-radius-pill); background: var(--sd-map-raised); color: var(--sd-map-fg); font: inherit; }
.sd-map .sd-map-btn:not(:disabled):hover { box-shadow: inset 0 0 0 999px color-mix(in srgb, var(--sd-map-fg) 8%, transparent); }
.sd-map .sd-map-btn:not(:disabled):active { transform: translateY(1px); }
/* The Region list: a native select, a pill like the search box, with its caption before it and a chevron drawn after it. */
.sd-map .sd-map-region { position: relative; flex: 0 1 21em; min-width: 11em; display: flex; align-items: center; gap: 0.45em; margin: 0; font-weight: inherit; }
.sd-map .sd-map-region-cap { color: var(--sd-map-muted); font-size: 0.85em; white-space: nowrap; }
.sd-map .sd-map-region select { appearance: none; -webkit-appearance: none; flex: 1 1 auto; width: 100%; min-width: 0; min-height: 40px; margin: 0; padding: 0.3em 2.2em 0.3em 0.8em; border: 1px solid var(--sd-map-border); border-radius: var(--ss-radius-pill); background: var(--sd-map-raised); color: inherit; font: inherit; text-overflow: ellipsis; cursor: pointer; }
.sd-map .sd-map-region::after { content: ""; position: absolute; right: 1em; top: 50%; width: 0.45em; height: 0.45em; margin-top: -0.3em; border: solid var(--sd-map-muted); border-width: 0 2px 2px 0; transform: rotate(45deg); pointer-events: none; }
.sd-map .sd-map-region select:hover { box-shadow: inset 0 0 0 999px color-mix(in srgb, var(--sd-map-fg) 8%, transparent); }
.sd-map .sd-map-stage { position: relative; width: 100%; aspect-ratio: 4 / 3; max-height: 70vh; min-height: 14em; overflow: hidden; border: 1px solid var(--sd-map-border); border-radius: var(--ss-radius-m); background: var(--sd-map-bg); touch-action: none; user-select: none; -webkit-user-select: none; cursor: grab; }
@media (max-width: 600px) {
  .sd-map .sd-map-stage { aspect-ratio: 1 / 1; max-height: 60vh; }
  /* the bar in three rows: the search box, the Region list (its caption left to its own label), the zoom buttons */
  .sd-map .sd-map-region { flex: 1 1 100%; }
  .sd-map .sd-map-region-cap { display: none; }
}
.sd-map .sd-map-stage.sd-map-dragging { cursor: grabbing; }
.sd-map .sd-map-svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; }
.sd-map .sd-map-route { stroke: var(--sd-map-route); stroke-width: 2; fill: none; }
.sd-map .sd-map-route[data-known="false"] { stroke-dasharray: 4 4; opacity: 0.55; stroke-width: 1.5; }
.sd-map .sd-map-places, .sd-map .sd-map-labels { position: absolute; inset: 0; pointer-events: none; }
.sd-map .sd-map-place { position: absolute; z-index: 1; display: grid; place-items: center; width: 24px; height: 24px; margin: 0; padding: 0; transform: translate(-50%, -50%); border: 2px solid var(--sd-map-border); border-radius: 50%; background: var(--sd-map-strong); color: var(--sd-map-fg); font-size: 11px; line-height: 1; pointer-events: auto; }
.sd-map .sd-map-place[data-visited="false"] { width: 18px; height: 18px; font-size: 9px; border-style: dashed; opacity: 0.7; color: var(--sd-map-muted); }
.sd-map .sd-map-place.sd-map-far { width: 8px; height: 8px; border-width: 1px; border-style: solid; background: var(--sd-map-muted); }
.sd-map .sd-map-place[data-child] { width: 9px; height: 9px; border-width: 1px; border-style: solid; opacity: 1; background: var(--sd-map-strong); }
.sd-map .sd-map-place[data-child] i { display: none; }
.sd-map .sd-map-place.sd-map-far i { display: none; }
.sd-map .sd-map-place:hover, .sd-map .sd-map-place:focus-visible { z-index: 2; opacity: 1; }
.sd-map .sd-map-place[aria-current="location"] { border-color: var(--sd-map-fg); background: var(--ss-accent-soft); box-shadow: 0 0 0 2px var(--sd-map-accent), 0 0 0 4px var(--sd-map-fg); opacity: 1; z-index: 2; }
.sd-map .sd-map-place.sd-map-picked { border-color: var(--sd-map-accent); border-style: solid; box-shadow: 0 0 0 3px color-mix(in srgb, var(--sd-map-accent) 45%, transparent); opacity: 1; z-index: 2; }
/* A phone (a narrow screen or a coarse pointer, PHONE): the dot keeps its size; its tap area is a 44px square on the screen (::before,
   no paint; 44px over Story Block's zoom, --ss-zoomed). Where two squares cover one dot, the click picks the place whose dot is nearest
   (see the click handler). */
@media (max-width: 759.98px), (pointer: coarse) {
  .sd-map .sd-map-place::before { content: ""; position: absolute; left: 50%; top: 50%; width: calc(44px / var(--ss-zoomed, 1)); height: calc(44px / var(--ss-zoomed, 1)); transform: translate(-50%, -50%); }
}
.sd-map .sd-map-label { position: absolute; z-index: 2; height: 18px; padding: 0 4px; border-radius: var(--ss-radius-s); background: var(--sd-map-overlay); color: var(--sd-map-fg); font-size: 12px; line-height: 18px; white-space: nowrap; pointer-events: none; }
.sd-map .sd-map-label[data-visited="false"] { color: var(--sd-map-muted); font-style: italic; }
.sd-map .sd-map-label.sd-map-picked { color: var(--sd-map-accent); }
.sd-map .sd-map-here { position: absolute; z-index: 3; width: 34px; height: 34px; transform: translate(-50%, -50%); border: 3px solid var(--sd-map-accent); border-radius: 50%; box-shadow: 0 0 0 2px var(--sd-map-overlay); pointer-events: none; }
.sd-map .sd-map-empty { margin: 0.4em 0; color: var(--sd-map-muted); font-style: italic; }
.sd-map .sd-map-details { position: relative; padding: 0.5em 2.8em 0.5em 0.8em; border: 1px solid var(--sd-map-border); border-radius: var(--ss-radius-m); background: var(--sd-map-raised); }
.sd-map .sd-map-details h3 { margin: 0 2em 0.1em 0; font-size: 1.05em; overflow-wrap: anywhere; }
.sd-map .sd-map-details p { margin: 0.15em 0; overflow-wrap: anywhere; }
.sd-map .sd-map-about, .sd-map .sd-map-none { color: var(--sd-map-muted); }
.sd-map .sd-map-close { position: absolute; top: 0.3em; right: 0.3em; }
.sd-map .sd-map-legend-card { padding: 10px 12px; gap: 6px; }
.sd-map .sd-map-legend { display: grid; grid-template-columns: repeat(auto-fill, minmax(12em, 1fr)); gap: 0 1em; margin: 0; padding: 0; list-style: none; font-size: 0.9em; }
.sd-map .sd-map-legend .ss-listcard-item { padding: 6px 4px; min-height: 40px; }
.sd-map .sd-map-legend .ss-listcard-title { font-size: 13px; font-weight: 600; overflow-wrap: anywhere; }
.sd-map .sd-map-sample { display: inline-grid; flex: none; place-items: center; width: 28px; height: 28px; border: 2px solid var(--sd-map-border); border-radius: 50%; font-size: 0.7em; color: var(--sd-map-fg); }
.sd-map .sd-map-sample-known { border-style: dashed; color: var(--sd-map-muted); }
.sd-map .sd-map-sample-here { border-color: var(--sd-map-accent); }
.sd-map .sd-map-sample-trip { border: 0; border-top: 4px solid var(--sd-map-accent); border-radius: 0; height: 0; margin: 12px 0; }
.sd-map .sd-map-sample-mover { width: 12px; height: 12px; margin: 8px; border: 2px solid var(--sd-map-overlay); border-radius: 0; background: var(--sd-map-mover); transform: rotate(45deg); }
.sd-map .sd-map-frame { position: relative; min-width: 0; }
.sd-map .sd-map-trip-leg { stroke: var(--sd-map-accent); stroke-width: 4; stroke-linecap: round; fill: none; opacity: 0.95; }
.sd-map .sd-map-trip-leg[data-state="done"] { opacity: 0.45; }
.sd-map .sd-map-you, .sd-map .sd-map-mover { position: absolute; z-index: 3; transform: translate(-50%, -50%); pointer-events: none; }
.sd-map .sd-map-you { width: 16px; height: 16px; border: 3px solid var(--sd-map-overlay); border-radius: 50%; background: var(--sd-map-accent); box-shadow: 0 0 0 2px var(--sd-map-accent); }
.sd-map .sd-map-mover { width: 13px; height: 13px; background: var(--sd-map-mover); border: 2px solid var(--sd-map-overlay); transform: translate(-50%, -50%) rotate(45deg); }
.sd-map .sd-map-pin { position: absolute; z-index: 3; padding: 0 5px; border-radius: var(--ss-radius-s); background: var(--sd-map-overlay); font-size: 12px; line-height: 18px; white-space: nowrap; pointer-events: none; transform: translate(10px, -50%); }
.sd-map .sd-map-pin.sd-map-pin-left { transform: translate(calc(-100% - 10px), -50%); }
.sd-map .sd-map-pin-you { font-weight: 600; }
.sd-map .sd-map-pin-mover { color: var(--sd-map-mover); }
.sd-map .sd-map-road { position: absolute; z-index: 6; top: 10px; right: 10px; width: min(24em, 52%); max-height: calc(100% - 20px); overflow: auto; padding: 0.6em 0.8em; border: 1px solid var(--sd-map-border); border-radius: var(--ss-radius-m); background: var(--sd-map-strong); backdrop-filter: var(--ss-blur); -webkit-backdrop-filter: var(--ss-blur); box-shadow: var(--ss-shadow); font-size: 0.85em; }
.sd-map .sd-map-road h4, .sd-map .sd-map-road h5 { margin: 0 0 0.3em; font-size: 0.8em; letter-spacing: 0.08em; text-transform: uppercase; color: var(--sd-map-muted); }
.sd-map .sd-map-road h5 { margin-top: 0.7em; }
.sd-map .sd-map-road p { margin: 0.15em 0; overflow-wrap: anywhere; }
.sd-map .sd-map-road-to { font-weight: 600; }
.sd-map .sd-map-road-by, .sd-map .sd-map-road-note { color: var(--sd-map-muted); }
.sd-map .sd-map-road ol, .sd-map .sd-map-road ul { margin: 0.4em 0 0; padding: 0; list-style: none; display: grid; gap: 0.5em; }
.sd-map .sd-map-road li { display: grid; grid-template-columns: minmax(0, 1fr); gap: 0.1em; overflow-wrap: anywhere; }
.sd-map .sd-map-road li > .sd-map-road-name { min-width: 0; }
.sd-map .sd-map-road li > .sd-map-road-when { color: var(--sd-map-muted); }
.sd-map .sd-map-road li[data-state="done"] { opacity: 0.6; }
.sd-map .sd-map-road li[data-state="now"] .sd-map-road-name { color: var(--sd-map-accent); font-weight: 600; }
.sd-map .sd-map-road li[data-kind="mover"] .sd-map-road-name::before { content: "\\25C6\\00a0"; color: var(--sd-map-mover); }
.sd-map .sd-map-road-bar { margin-top: 0.2em; height: 5px; border-radius: 3px; background: var(--sd-map-raised); overflow: hidden; }
.sd-map .sd-map-road-bar > span { display: block; height: 100%; background: var(--sd-map-accent); }
@media (max-width: 759.98px) {
  .sd-map .sd-map-road { position: static; width: auto; max-height: none; margin-top: 0.6em; box-shadow: none; background: var(--sd-map-raised); }
  .sd-map .sd-map-pin-mover { display: none; }
}
`;

/** The widget's stylesheet (tests read it; the page gets it once, from ensureStyle). */
export const MAP_CSS = CSS;

export function ensureStyle(doc) {
    const head = doc.head ?? doc.querySelector?.('head');
    if (!head || doc.getElementById?.(STYLE_ID) || head.querySelector?.(`#${STYLE_ID}`)) return;
    const style = doc.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    head.appendChild(style);
}
