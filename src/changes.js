// Change lines: the short `<Director>` lines the main model writes at the end of each reply
// (`+ agenda Courier — now: … | then: …`). Parsing is lenient because models drift (bold,
// bullets, either dash, a colon instead of a dash); a line that is not an op becomes an
// error entry, never an exception. Pure: no DOM, no globals.

export const KINDS = ['agenda', 'event', 'hook', 'clock', 'beat', 'secret'];

// The old World_State list names and Megumin's blueprint names, so a model that writes the
// list it remembers still lands on the right kind.
export const KIND_ALIASES = Object.freeze({
    offscreen: 'agenda',
    'off-screen': 'agenda',
    npc: 'agenda',
    world: 'event',
    thread: 'hook',
    hooks: 'hook',
    timer: 'clock',
    clocks: 'clock',
    plan: 'beat',
    'off-limits': 'secret',
});

export const FIELDS = ['desc', 'now', 'then', 'on', 'due', 'shown', 'leg', 'arrive', 'place', 'people'];

// Only a spaced hyphen ends a key, so `Jean-Luc` and `Hall-Warden` stay whole; em and en
// dashes never appear inside names, so they count with or without spaces.
const KEY_DASH = /\s*[—–]\s*|\s+-(?:\s+|$)/;

// `label: value`: the label is words (so the `09` of `09:00` is not one) and the colon is
// followed by a space or the end (so `09:00` and `a:b` stay inside values).
const LABELLED = /^(\p{L}[\p{L}\p{N}'’ -]*?)\s*:(?:\s+|$)(.*)$/su;
// A known field may skip the space (`on:Haywane 13`); an arbitrary label may not.
const TIGHT_FIELD = /^(\p{L}+):(.*)$/su;

const MAX_COLON_KEY_WORDS = 8;
const MAX_EXTRA_LABEL_WORDS = 3;

function stripMarkdown(text) {
    return String(text ?? '').replace(/\*\*|__|[*`]/g, '');
}

function wordCount(text) {
    const trimmed = text.trim();
    return trimmed ? trimmed.split(/\s+/).length : 0;
}

/** Identity of a key: lowercase, markdown and punctuation squashed, single spaces. */
export function lineKey(key) {
    return stripMarkdown(key)
        .normalize('NFKC')
        .toLowerCase()
        // Dropped rather than spaced, so `Hollin's` and `Hollins` are the same record.
        .replace(/['’‘`]/g, '')
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim();
}

function kindOf(word) {
    const lower = word.toLowerCase();
    if (KINDS.includes(lower)) return lower;
    return Object.hasOwn(KIND_ALIASES, lower) ? KIND_ALIASES[lower] : null;
}

function inferKind(fields) {
    if (fields.leg || fields.now) return 'agenda';
    if (fields.due) return 'clock';
    return 'event';
}

/** `{ field, value }`, `{ label, value }` (extra) or null for an unlabeled part. */
function splitLabel(part) {
    const match = part.match(LABELLED);
    if (match) {
        const label = match[1].trim().toLowerCase();
        const value = match[2].trim();
        if (FIELDS.includes(label)) return { field: label, value };
        if (wordCount(label) <= MAX_EXTRA_LABEL_WORDS) return { label, value };
        return null;
    }
    const tight = part.match(TIGHT_FIELD);
    if (tight && FIELDS.includes(tight[1].toLowerCase())) {
        return { field: tight[1].toLowerCase(), value: tight[2].trim() };
    }
    return null;
}

/** Splits the first part into the key and whatever follows it. */
function splitKey(first) {
    const dash = first.match(KEY_DASH);
    if (dash) {
        return { key: first.slice(0, dash.index), head: first.slice(dash.index + dash[0].length) };
    }
    const colon = first.search(/:(?:\s|$)/);
    if (colon > 0 && wordCount(first.slice(0, colon)) <= MAX_COLON_KEY_WORDS) {
        let key = first.slice(0, colon);
        let head = first.slice(colon + 1).trim();
        // `Geva now: Court` (what is left of `**Geva now:** Court`): the trailing field word
        // labels the first part. Lowercase only, so a name like `The Long Leg` keeps its word.
        const tail = key.match(/^(.*\S)\s+([a-z]+)$/);
        if (tail && FIELDS.includes(tail[2])) {
            key = tail[1];
            head = `${tail[2]}: ${head}`;
        }
        return { key, head };
    }
    return { key: first, head: '' };
}

// Repeated loose text is joined rather than overwritten, so nothing the model wrote is lost.
function addText(target, name, value) {
    target[name] = target[name] && value ? `${target[name]}; ${value}` : target[name] || value;
}

function parseLine(raw) {
    let text = raw.replace(/\*\*|__/g, '').trim();
    // A bullet is decoration only when an op follows it: `- Thys — …` is itself an op.
    text = text.replace(/^[*•-]\s*(?=[+~!-]\s)/, '');
    const opMatch = text.match(/^([+~!-])\s+(.*)$/s);
    if (!opMatch) return { error: 'not a change line (expected + ~ - or ! followed by a key)' };
    const op = opMatch[1];
    let body = opMatch[2].trim();

    let kind = null;
    if (op === '+') {
        const first = body.match(/^(\S+)\s+(.*)$/s);
        // The kind word only counts when a key follows it, not a separator.
        if (first && kindOf(first[1]) && !/^(?:[—–:|]|-(?:\s|$))/.test(first[2])) {
            kind = kindOf(first[1]);
            body = first[2];
        }
    }

    const parts = body.split(/\s*\|\s*/);
    const { key: rawKey, head } = splitKey(parts.shift());
    const key = stripMarkdown(rawKey).trim();
    const id = lineKey(key);
    if (!id) return { error: 'missing key' };
    if (head.trim()) parts.unshift(head);

    const closing = op === '-' || op === '!';
    const fields = {};
    const extra = {};
    const loose = { text: '' };
    for (const part of parts) {
        const trimmed = part.trim();
        if (!trimmed) continue;
        const labelled = splitLabel(trimmed);
        if (labelled?.field === 'desc') addText(fields, 'desc', labelled.value);
        else if (labelled?.field) fields[labelled.field] = labelled.value;
        else if (labelled && closing && labelled.label === 'reason') addText(loose, 'text', labelled.value);
        else if (labelled) extra[labelled.label] = labelled.value;
        else addText(loose, 'text', trimmed);
    }

    let reason = '';
    if (closing) reason = loose.text;
    else if (loose.text) {
        // Unlabeled text comes before an explicit `desc:` in the joined description.
        const labelled = fields.desc;
        fields.desc = '';
        addText(fields, 'desc', loose.text);
        addText(fields, 'desc', labelled ?? '');
    }

    if (op === '+' && !kind) kind = inferKind(fields);
    return { op: { op, kind, key, id, fields, extra, reason, raw: raw.trim() } };
}

/**
 * Parses change lines, one op per line. Blank lines are ignored; any other line that is not
 * an op becomes `{ line, text, message }` in `errors` (line is 1-based).
 */
export function parseChanges(text) {
    const ops = [];
    const errors = [];
    String(text ?? '').split(/\r?\n/).forEach((raw, index) => {
        if (!raw.trim()) return;
        const result = parseLine(raw);
        if (result.op) ops.push(result.op);
        else errors.push({ line: index + 1, text: raw.trim(), message: result.error });
    });
    return { ops, errors };
}

function labelledPart(name, value) {
    return value ? `${name}: ${value}` : `${name}:`;
}

// Unlabeled leading text that would read back as `label: value` gets its label written out,
// so the round trip cannot reclassify it.
function leadPart(name, value) {
    return splitLabel(value) ? labelledPart(name, value) : value;
}

/** One change line for an op; `parseChanges(formatOp(op))` gives the same op back. */
export function formatOp(op) {
    const fields = op.fields ?? {};
    const extra = op.extra ?? {};
    const closing = op.op === '-' || op.op === '!';
    const parts = [];

    if (closing) {
        if (op.reason) parts.push(leadPart('reason', op.reason));
    } else if (Object.hasOwn(fields, 'desc')) {
        parts.push(fields.desc ? leadPart('desc', fields.desc) : 'desc:');
    }
    for (const name of FIELDS) {
        if (name === 'desc' && !closing) continue;
        if (Object.hasOwn(fields, name)) parts.push(labelledPart(name, fields[name]));
    }
    for (const [label, value] of Object.entries(extra)) parts.push(labelledPart(label, value));

    // A `+` always names its kind: inference could differ, and a key starting with an alias
    // word (`World Bank`) would otherwise lose that word to the kind.
    const kind = op.op === '+' ? ` ${op.kind || inferKind(fields)}` : '';
    const head = `${op.op}${kind} ${op.key}`;
    if (parts.length) return `${head} — ${parts.join(' | ')}`;
    // A bare dash keeps a key containing `: ` from being split at the colon.
    return /:(?:\s|$)/.test(op.key) ? `${head} —` : head;
}
