// Story Director v2, atlas part: the shape of `atlas.trips` (pure). Kept apart from domain.js and trip.js so the domain's
// validator can use it without the two importing each other.

export const MAX_LEGS = 64;
export const MAX_DELAYS = 8;
export const MAX_DELAY_DAYS = 30;
export const MAX_TEXT = 80;
const DAY = 1440;

export const KEY = /^[0-9]{1,12}\.[0-9]{1,4}$/;
const isInt = value => Number.isSafeInteger(value);
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const textOk = (value, max) => typeof value === 'string' && value.length <= max;
const named = value => textOk(value, MAX_TEXT) && value.trim() !== '';

function legProblems(leg, at) {
    if (!isRecord(leg)) return [`${at} is not a leg.`];
    const errors = [];
    for (const field of ['from', 'to']) if (!named(leg[field])) errors.push(`${at}.${field} must be a place name.`);
    if (!textOk(leg.kind, MAX_TEXT)) errors.push(`${at}.kind must be text.`);
    if (!isInt(leg.km) || leg.km < 1) errors.push(`${at}.km must be a whole number of at least 1.`);
    if (!(typeof leg.days === 'number' && Number.isFinite(leg.days) && leg.days >= 0)) errors.push(`${at}.days must be a number.`);
    if (!isInt(leg.start) || !isInt(leg.arrive) || leg.arrive < leg.start) errors.push(`${at} needs a start and a later arrival (whole minutes).`);
    if (leg.skip !== undefined && !(isInt(leg.skip) && leg.skip > 0 && leg.skip < leg.km)) errors.push(`${at}.skip must be whole km inside the road.`);
    for (const key of Object.keys(leg)) if (!['from', 'to', 'km', 'kind', 'days', 'start', 'arrive', 'skip'].includes(key)) errors.push(`${at} has an unknown field "${key}".`);
    return errors;
}

/** The problems of `atlas.trips` (domain.js validates the rest of the slice). */
export function tripsProblems(trips) {
    if (!isRecord(trips)) return ['atlas.trips is not an object.'];
    const errors = [];
    if (Object.keys(trips).length > MAX_DELAYS + 4) errors.push('atlas.trips holds more records than a trip needs.');
    for (const [key, record] of Object.entries(trips)) {
        const at = `atlas.trips.${key}`;
        if (!KEY.test(key) || !isRecord(record)) {
            errors.push(`${at} is not a trip record.`);
            continue;
        }
        if (!isInt(record.at) || !isInt(record.rev) || record.rev < 0) errors.push(`${at} needs the story time and revision it was made at.`);
        if (record.kind === 'delay') {
            if (!isInt(record.minutes) || record.minutes < 1 || record.minutes > MAX_DELAY_DAYS * DAY) errors.push(`${at}.minutes must be 1 to ${MAX_DELAY_DAYS * DAY}.`);
            if (!textOk(record.because, MAX_TEXT)) errors.push(`${at}.because must be text.`);
            for (const field of Object.keys(record)) if (!['kind', 'at', 'rev', 'minutes', 'because'].includes(field)) errors.push(`${at} has an unknown field "${field}".`);
        } else if (record.kind === 'go') {
            if (!named(record.to)) errors.push(`${at}.to must be a place name.`);
            if (!textOk(record.by, 40) || !textOk(record.mode, 20) || !record.mode) errors.push(`${at}.by and .mode must be text.`);
            if (!(typeof record.pace === 'number' && record.pace > 0 && Number.isFinite(record.pace))) errors.push(`${at}.pace must be a number.`);
            if (record.unit !== 'day' && record.unit !== 'hour') errors.push(`${at}.unit must be day or hour.`);
            if (!textOk(record.mount, MAX_TEXT) || typeof record.short !== 'boolean') errors.push(`${at}.mount must be text and .short true or false.`);
            if (!isInt(record.setOut)) errors.push(`${at}.setOut must be a story time.`);
            if (!Array.isArray(record.legs) || !record.legs.length || record.legs.length > MAX_LEGS) errors.push(`${at}.legs is a list of 1 to ${MAX_LEGS} legs.`);
            else record.legs.forEach((leg, index) => errors.push(...legProblems(leg, `${at}.legs[${index}]`)));
            for (const field of Object.keys(record)) if (!['kind', 'at', 'rev', 'to', 'by', 'mode', 'pace', 'unit', 'mount', 'short', 'setOut', 'legs'].includes(field)) errors.push(`${at} has an unknown field "${field}".`);
        } else errors.push(`${at}.kind must be go or delay.`);
    }
    return errors;
}
