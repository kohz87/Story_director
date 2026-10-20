// Story Director: whether an offer's giver is in the scene (pure).
//
// (0.9.34) Taking a job on is done in front of whoever offers it: the Quests tab's Take on is
// there while the giver is in the scene, read from the scene block's "NPCs Present" (Story
// Block's World State) or, failing that, from the latest reply naming them. The reader can
// always say they are with them; turning a job down needs no one.

// Titles and kinship words that do not tell one giver from another ("Brother Aldo" is Aldo).
const TITLES = new Set([
    'the', 'of', 'for', 'and', 'old', 'young', 'master', 'mistress', 'brother', 'sister', 'father', 'mother', 'lord', 'lady',
    'sir', 'dame', 'captain', 'watch', 'reeve', 'factor', 'elder', 'priest', 'priestess', 'guildmaster', 'miller', 'mayor',
    'magistrate', 'sergeant', 'chief', 'king', 'queen', 'prince', 'princess', 'baron', 'baroness', 'mr', 'mrs', 'ms', 'goodwife', 'goodman',
]);

const words = text => String(text ?? '').toLowerCase().normalize('NFKC').split(/[^\p{L}\p{N}'-]+/u).filter(Boolean);

/**
 * The names a giver goes by: "Elke (for Watch-Captain)" → ['elke']; "Reeve Hollis" →
 * ['hollis', 'reeve hollis']; a giver that is only a title ("the quarry master") keeps it.
 */
export function giverNames(giver) {
    const own = String(giver ?? '').split(/[,(;—–]/)[0].trim();
    if (!own) return [];
    const all = words(own);
    const names = all.filter(word => word.length >= 3 && !TITLES.has(word));
    const whole = all.join(' ');
    return [...new Set([...(names.length ? names : [whole]), ...(all.length > 1 ? [whole] : [])])].filter(Boolean);
}

/** The scene block's "NPCs Present" part, '' when it has none (its Off-Screen list never counts). */
export function presentPart(sceneText) {
    const text = String(sceneText ?? '');
    const start = text.search(/NPCs?\s+Present/i);
    if (start < 0) return '';
    const rest = text.slice(start);
    const end = rest.slice(1).search(/\n\s*-{3,}\s*\n|Off-?Screen|Scene Phase/i);
    return end < 0 ? rest : rest.slice(0, end + 1);
}

const names = (text, name) => new RegExp(`(?<![\\p{L}\\p{N}])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')}(?![\\p{L}\\p{N}])`, 'iu').test(text);

/**
 * Whether `giver` is in the scene: true when the scene block's NPCs Present (`scene`) or the
 * latest reply (`reply`) names them, false when neither does, null when there is no giver to
 * look for (no check then).
 */
export function giverPresent(giver, { scene = '', reply = '' } = {}) {
    const list = giverNames(giver);
    if (!list.length) return null;
    const present = presentPart(scene);
    return list.some(name => (present && names(present, name)) || names(String(reply ?? ''), name));
}
