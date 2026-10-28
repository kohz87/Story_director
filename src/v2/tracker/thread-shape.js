// Shared validation for neutral thread metadata and acceptance proofs.
export const recordId = value => typeof value === 'string' && /^[a-z][a-z0-9]*_[0-9a-z]{8}$/.test(value);
export const map = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const count = value => Number.isSafeInteger(value) && value >= 0;
export const minute = value => value === null || Number.isSafeInteger(value);
export const text = (value, max, nonempty = false) => typeof value === 'string' && [...value].length <= max
    && (!nonempty || value.trim().length > 0) && !/[\p{Cc}<>]/u.test(value);
export const closed = (value, required, optional = []) => map(value) && required.every(key => Object.hasOwn(value, key))
    && Object.keys(value).every(key => [...required, ...optional].includes(key));
export const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export const source = value => closed(value, ['sid', 'swipeKey', 'evidence', 'ordinal'])
    && ['sid', 'swipeKey', 'evidence'].every(key => recordId(value[key])) && count(value.ordinal) && value.ordinal <= 1000000;
export const cursor = value => closed(value, ['sid', 'swipeKey', 'block', 'op', 'rev'])
    && ['sid', 'swipeKey', 'block'].every(key => recordId(value[key])) && count(value.op) && count(value.rev);
