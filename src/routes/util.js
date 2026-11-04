// Story Director: small shared helpers for the route files (pure).
//
// Number and shape checks, calendar-abs helpers and DAY_MINUTES, split out of routes.js so
// pack.js, plan.js, leg.js and text.js can share them without importing each other in a cycle.

export const DAY_MINUTES = 1440;

// ---------------------------------------------------------------------------------------
// Small helpers

export function toAbs(value, calendar, reference = null) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && calendar) return calendar.parse(value, { reference })?.abs ?? null;
    return null;
}

// To the minute: hours in thirds and quarters must not land on 09:59.
export function addDays(abs, days, calendar) {
    return Math.round(calendar?.addDays ? calendar.addDays(abs, days) : abs + days * DAY_MINUTES);
}

// 6.500000000001 → 6.5, so sums and printed numbers stay clean.
export function tidy(value) {
    return Math.round(value * 1e9) / 1e9;
}

export function num(value) {
    return String(Number(Number(value).toFixed(2)));
}

export function names(list) {
    return Array.isArray(list) ? list.filter(name => typeof name === 'string' && name.trim()).map(name => name.trim()) : [];
}

export function positive(value) {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

export function nonNegative(value) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

export function finite(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
