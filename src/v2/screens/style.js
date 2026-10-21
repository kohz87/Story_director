// Story Director v2, part screens: the look every Director screen shares (SPEC §13.3, MODULES §F18).
//
// Colours come from SillyTavern's theme through Story Block's --ss-* properties (mounts.css), with
// SillyTavern's own variables as the fallback, so the screens fit any theme; a card or pack restyles
// them with `theme: { '--ss-accent': … }` or its own css. Mobile first: one column and finger-sized
// buttons; wider panes adjust. Story Block scopes the sheet to the screen's root, where `:root` is
// that root.

export const BASE_CSS = `
:root {
  --sd-gap: var(--ss-gap, 8px);
  --sd-radius: var(--ss-radius, 10px);
  --sd-text: var(--ss-text, var(--SmartThemeBodyColor, inherit));
  --sd-muted: var(--ss-muted, var(--SmartThemeEmColor, currentColor));
  --sd-accent: var(--ss-accent, var(--SmartThemeQuoteColor, currentColor));
  --sd-border: var(--ss-border, var(--SmartThemeBorderColor, rgba(127, 127, 127, 0.35)));
  --sd-surface: var(--ss-chat-surface, var(--SmartThemeBlurTintColor, transparent));
  --sd-good: var(--ss-w-good, #5cb85c);
  --sd-warn: var(--ss-w-warn, #e0a030);
  color: var(--sd-text);
}
.sd-h { display: flex; align-items: baseline; gap: 6px; margin: 0 0 6px; font-size: 1em; }
.sd-h small { opacity: 0.65; font-weight: normal; }
.sd-list { display: grid; gap: var(--sd-gap); margin: 0; padding: 0; list-style: none; }
.sd-card { display: grid; gap: 4px; padding: 10px 12px; border: 1px solid var(--sd-border);
  border-radius: var(--sd-radius); background: var(--sd-surface); min-width: 0; }
.sd-key { font-weight: bold; color: var(--sd-accent); overflow-wrap: anywhere; }
.sd-line { margin: 0; overflow-wrap: anywhere; }
.sd-meta { display: flex; flex-wrap: wrap; gap: 4px 12px; margin: 0; font-size: 0.85em; opacity: 0.8; }
.sd-meta:not(:has(*)) { display: none; }
.sd-tag { display: inline-block; padding: 0 6px; border-radius: 999px; font-size: 0.75em; line-height: 1.6;
  border: 1px solid var(--sd-border); opacity: 0.85; white-space: nowrap; }
.sd-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; }
.sd-btn { min-height: 44px; min-width: 44px; margin: 0; padding: 6px 14px; flex: 1 1 auto; cursor: pointer; }
.sd-btn[disabled] { opacity: 0.5; cursor: not-allowed; }
.sd-btn.ss-busy { opacity: 0.7; cursor: progress; }
.sd-quiet { background: transparent; }
.sd-reason { margin: 0; font-size: 0.85em; color: var(--sd-warn); }
.sd-empty { margin: 0; opacity: 0.65; font-style: italic; }
@media (min-width: 600px) {
  .sd-btn { flex: 0 0 auto; min-height: 36px; }
}
`;
