// Story Suite's overlay (docs/STORY_SUITE.md, "One place to manage them all"): what Story
// Director announces, and the handle (api.manage) the overlay uses to change its Source of
// truth choices and its tracking switch. Pure: index.js passes in how to read, save and show
// the settings, so the overlay goes through the same path as an edit in the panel.

/** The reader's choices per area: the suite's order, this extension, or the other one. */
export const SOURCE_CHOICES = Object.freeze(['auto', 'mine', 'theirs']);

/** Every area in `areas` with a valid choice; anything unknown or missing reads as 'auto'. */
export function sourceChoices(saved, areas) {
    const given = saved && typeof saved === 'object' ? saved : {};
    return Object.fromEntries(areas.map(area => [area, SOURCE_CHOICES.includes(given[area]) ? given[area] : 'auto']));
}

/**
 * What to tell the Story Suite. `{ key, provider }`: `provider` null means withdraw; `key`
 * names the state so an unchanged one is never announced twice (every announcement wakes
 * every listener).
 *
 * - Story Block missing: withdrawn. Story Director cannot run, and without Story Block there
 *   is no overlay to switch it back on.
 * - Tracking on: offers every area in `areas` except one the reader gave to "the other one".
 * - Tracking off: announced with `enabled: false` and nothing offered, keeping `settings` and
 *   `api.manage`, so the overlay can switch it back on (the registry's owner, has and api
 *   already skip a disabled provider).
 */
export function suiteAnnouncement({ id, name, version, areas, settings, storyBlock, api, panel }) {
    if (!storyBlock) return { key: '', provider: null };
    const enabled = settings?.enabled !== false;
    const choices = sourceChoices(settings?.sourceOfTruth, areas);
    const owns = enabled ? areas.filter(area => choices[area] !== 'theirs') : [];
    return {
        key: enabled ? `on:${owns.join(',')}` : 'off',
        provider: { id, name, version, owns, enabled, settings: panel, api },
    };
}

/**
 * api.manage: the same choices as the settings panel. `read()` gives the saved settings;
 * `save(next)` stores a full new settings object and applies it the way an edit in the panel
 * does (save, re-announce, refresh); `panel()` gives the settings panel, or null, so its
 * controls show the change. `tokens()` (v0.8.2) gives what Story Director adds to the next
 * ordinary reply, `{ input, output, parts: [{ label, input, output }] }` (src/note.js
 * noteTokens); manage.tokens() hands over a clean copy, and nothing at all on a failure.
 */
export function makeManage({ areas, read, save, panel = () => null, tokens = () => null }) {
    const known = Object.freeze([...areas]);
    return Object.freeze({
        areas: known,
        /** The Source of truth choices now, as a copy. */
        sources: () => sourceChoices(read()?.sourceOfTruth, known),
        /** Save one choice; false (and nothing changed) for an unknown area or choice. */
        setSource(area, choice) {
            if (!known.includes(area) || !SOURCE_CHOICES.includes(choice)) return false;
            const own = read() ?? {};
            panel()?.setSource?.(area, choice);
            save({ ...own, sourceOfTruth: { ...sourceChoices(own.sourceOfTruth, known), [area]: choice } });
            return true;
        },
        /** The tracking switch ("Track the story"). */
        enabled: () => read()?.enabled !== false,
        /**
         * The tokens Story Director adds to the next ordinary reply (≈ 4 characters each, no
         * model call): `input` the note as it would be injected now, `output` an allowance for
         * the <Director> lines it asks for, `parts` per note section. Never throws.
         */
        tokens() {
            try {
                return tokenCopy(tokens());
            } catch {
                return tokenCopy(null);
            }
        },
        /** Flip the tracking switch, as the panel's own switch does. */
        setEnabled(on) {
            const enabled = Boolean(on);
            panel()?.setEnabled?.(enabled);
            save({ ...(read() ?? {}), enabled });
            return true;
        },
    });
}

const count = value => (Number.isFinite(Number(value)) && Number(value) > 0 ? Math.round(Number(value)) : 0);

// A plain, well-formed copy: counts are whole numbers ≥ 0, anything unreadable is nothing.
function tokenCopy(report) {
    const parts = (Array.isArray(report?.parts) ? report.parts : [])
        .filter(entry => entry && typeof entry === 'object')
        .map(entry => ({ label: String(entry.label ?? ''), input: count(entry.input), output: count(entry.output) }));
    return { input: count(report?.input), output: count(report?.output), parts };
}

/**
 * Opens Story Suite's overlay on `tab`, or null while it is not available: two or more
 * extensions announced (on or off) and Story Block sharing `openSuite`.
 */
export function suiteOpener(suite) {
    try {
        if (!(suite?.providers?.().length >= 2)) return null;
        const host = suite.api?.('story-block');
        if (typeof host?.openSuite !== 'function') return null;
        return tab => host.openSuite(tab);
    } catch {
        return null;
    }
}
