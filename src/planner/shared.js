// Story Director: the arc planner's tiny shared helpers (pure).

export function capitalize(text) {
    const value = String(text ?? '');
    return value.charAt(0).toUpperCase() + value.slice(1);
}

export function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function isNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}
