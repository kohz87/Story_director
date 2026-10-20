// Story Director: the one sidebar tab's views (prototype). One quiet line at the top of the
// pane, "Quests · Journal · Director", the current view accented; each view draws below it as
// its own tab did. Keyboard: Tab reaches the line, the arrow keys move between views.
// Everything arrives as parameters; this module only draws.

import { el } from './dom.js';

/**
 * The line of views: `views` [{ id, label, count }], `current` the id shown, `onSelect(id)`.
 * A count above 0 shows small after its label.
 */
export function renderViews(views, current, onSelect) {
    const nav = el('div', { className: 'story-director-views', attrs: { role: 'tablist', 'aria-label': 'Story Director views' } });
    const buttons = views.map((view, index) => {
        const selected = view.id === current;
        const node = el('button', {
            className: `story-director-view${selected ? ' is-current' : ''}`,
            attrs: { role: 'tab', 'aria-selected': String(selected), tabindex: selected ? '0' : '-1', 'data-view': view.id },
        }, [
            el('span', { className: 'story-director-view-label', text: view.label }),
            view.count > 0 ? el('span', { className: 'story-director-view-count', text: String(view.count) }) : null,
        ]);
        node.type = 'button';
        node.addEventListener('click', () => { if (!selected) onSelect?.(view.id); });
        node.addEventListener('keydown', event => {
            const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
            if (!step) return;
            event.preventDefault?.();
            const next = views[(index + step + views.length) % views.length];
            onSelect?.(next.id, { focus: true });
        });
        return node;
    });
    buttons.forEach((node, index) => {
        if (index) nav.append(el('span', { className: 'story-director-view-sep', text: '·', attrs: { 'aria-hidden': 'true' } }));
        nav.append(node);
    });
    return nav;
}
