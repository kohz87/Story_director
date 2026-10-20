// Story Director: the small DOM helpers every tab and the settings panel share (0.9.35).
// Every node is filled through textContent, never HTML: the values are written by the model.

/** An element: class, text, a title (also its aria-label), attributes, children (gaps skipped). */
export function el(tag, { className, text, title, attrs } = {}, children = []) {
    const node = globalThis.document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    if (title) {
        node.title = title;
        node.setAttribute('aria-label', title);
    }
    for (const [name, value] of Object.entries(attrs ?? {})) node.setAttribute(name, value);
    for (const child of children) if (child) node.append(child);
    return node;
}

export function icon(name) {
    return el('i', { className: `fa-solid ${name}`, attrs: { 'aria-hidden': 'true' } });
}

/** A SillyTavern menu button: icon, label, the title as its tooltip and name. */
export function button(label, className, { iconName, title, onClick } = {}) {
    const node = el('button', { className: `menu_button ${className}`, title });
    node.type = 'button';
    if (iconName) node.append(icon(iconName));
    if (label) node.append(el('span', { text: label }));
    if (onClick) node.addEventListener('click', onClick);
    return node;
}

/** The quiet section label: an icon, then the name in small capitals, and a count. */
export function sub(label, iconName, count = null) {
    return el('div', { className: 'story-director-sub' }, [
        icon(iconName),
        el('span', { text: label }),
        count === null ? null : el('span', { className: 'story-director-count', text: String(count) }),
    ]);
}
