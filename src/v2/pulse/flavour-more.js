// Story Director v2, pulse part: extra fixed fallback lines (pulse step version 2 and later only; older steps keep tables.js FLAVOUR alone so
// a replayed roll picks the same line). Same shape and slots as FLAVOUR: {name}, {place}; setting-agnostic; one sentence, under 128 characters filled.
// Used when "Pulse invents events" is off, or when the note has no people or threads to draw from.

const set = (group, lines) => lines.map(text => Object.freeze({ group, text }));

export const FLAVOUR_MORE = Object.freeze({
    BACKGROUND_INCIDENT: Object.freeze([
        ...set('wild', ['Something large crashes through the undergrowth near {place} and is gone.', 'A hawk drops from the sky near {place} and comes up with something small.', 'Smoke from a distant fire stains the sky above {place}.', 'A tree limb comes down in the trees by {place} with a long groan.']),
        ...set('town', ['A shopfront shutter falls with a bang near {place}; a child laughs.', 'Two carters argue over right of way near {place} until a guard waves them apart.', 'A pigeon flock bursts from a rooftop at {place}, and a shadow passes below.', 'A window opens above {place} and a basin of water meets the gutter.']),
        ...set('indoors', ['A shutter bangs open in {place} and a draught runs through the room.', 'A chair scrapes back in {place} and someone leaves without a word.', 'A dog sleeping near the hearth in {place} stands up and growls at the door.', 'A shout from the kitchen of {place} is followed by a short silence.']),
        ...set('road', ['A wagon axle groans somewhere behind you on the road near {place}.', 'A flock of sheep spills across the road by {place} and the drover swears.', 'A horse shies at something in the ditch near {place}.', 'Crows lift from a field by {place} all together.']),
        ...set('water', ['A bell rings out over the water near {place} and goes unanswered.', 'A fish jumps near the landing at {place}, and a net is hauled in.', 'A gull screams over {place} and drops its catch on a deck.', 'A skiff bumps the quay at {place} with a loud knock.']),
    ]),
    MUNDANE_INTERRUPTION: Object.freeze([
        ...set('wild', ['A beetle the size of a thumb crawls across the pack at {place}.', 'A pot lid slips and rolls off down the slope near {place}.', 'A cold drip finds its way down your neck at {place}.', 'A mule at {place} decides it has done enough walking for now.']),
        ...set('town', ['A child asks you the time, then runs off before you answer.', 'A baker\'s boy offers you a day-old loaf for a coin.', 'Someone sweeping the step at {place} shoos you a pace to one side.', 'A messenger asks you where {place} is, standing in front of it.']),
        ...set('indoors', ['A server asks whether you are finished, though you have barely begun.', 'A candle gutters and someone leans over to relight it.', 'A stranger at the next table asks you to pass the salt.', 'The keeper of {place} wipes the table beside you with a damp rag.']),
        ...set('road', ['A peddler holds up a handful of ribbons as you pass and names a price.', 'A boy on a donkey asks if you have seen his father.', 'A traveller asks for water and says nothing else.', 'A milestone near {place} has been scratched with someone\'s initials.']),
        ...set('water', ['A deckhand asks you to mind a coil of rope for a moment.', 'A fisherman at {place} offers to sell you the smaller half of his catch.', 'A child drops a toy boat from the quay at {place} and watches it float.', 'Someone coils rope on the dock at {place} and hums off-key.']),
    ]),
    MOOD_SWING: Object.freeze([
        ...set('wild', ['{name} laughs suddenly at nothing, then looks away.', '{name} stops to listen to the wind in the trees and will not say why.', '{name} grows short-tempered with the pack straps for a while.', '{name} hums an old tune under their breath, then catches themself.']),
        ...set('town', ['{name} looks at the crowd as if searching it for one face.', '{name} grows restless and drifts toward the edge of the square.', '{name} laughs too loudly at something a vendor said.', '{name} goes quiet and studies their hands.']),
        ...set('indoors', ['{name} begins to fidget with a cup, turning it round and round.', '{name} falls silent mid-sentence and stares at the fire.', '{name} sits straighter, as if someone had looked at them.', '{name} gives a short laugh and then says nothing more.']),
        ...set('road', ['{name} slows down and lets you get ahead, saying nothing.', '{name} sighs for no reason and kicks a stone along the road.', '{name} starts to whistle and then breaks off.', '{name} keeps looking over their shoulder for a while.']),
        ...set('water', ['{name} stares at the horizon a little too long.', '{name} grows tense whenever a boat comes near the landing.', '{name} taps their fingers on the rail in a steady rhythm.', '{name} smiles to themself at something in the water.']),
    ]),
    PHYSICAL_REACTION: Object.freeze([
        ...set('wild', ['A chill runs down your back near {place}, though the air is still.', 'A sudden gust of cold air hits you from between the trees at {place}.', 'The ground gives a little underfoot near {place}, as if soft beneath the moss.', 'A bee bumps your hand at {place} and flies off, and your arm tingles.']),
        ...set('town', ['A drumbeat starts up somewhere near {place} and the cobbles hum with it.', 'A sudden smell of smoke drifts through {place} and thins out.', 'A cold draught runs through {place} out of an alley.', 'The crowd near {place} surges briefly and you are pushed a step aside.']),
        ...set('indoors', ['The air in {place} turns hot and close for a moment.', 'A draught finds your neck and the candle flames lean over.', 'A low knock sounds in the wall of {place} and stops.', 'A tankard rattles on the table as something heavy is dragged overhead.']),
        ...set('road', ['The wind picks up on the road near {place} and drives dust into your eyes.', 'Your foot slips on a patch of wet clay near {place}.', 'A deep rumble of thunder rolls across the road by {place}.', 'The road dips near {place} and a cold air pools in the hollow.']),
        ...set('water', ['A gust off the water at {place} tugs at your hood.', 'The landing at {place} sways for a moment as a larger boat passes.', 'A smell of weed and rot rises from the water at {place}.', 'A spray of cold water catches you at {place} and runs down your sleeve.']),
    ]),
    OBJECT_DISCOVERY: Object.freeze([
        ...set('wild', ['A rusted buckle lies half hidden in the mud near {place}.', 'A bundle of cloth is wedged in the roots of a tree at {place}.', 'A line of old marks cut in a stone near {place}.', 'A bone-handled knife sits in the grass near {place}, the blade clean.']),
        ...set('town', ['A coin lies in the gutter at {place}, with a notch cut in the edge.', 'A glove hangs on a railing near {place}, as if left for its owner to find.', 'A torn handbill clings to the wall at {place}, half peeled away.', 'A small key lies under a barrow at {place}.']),
        ...set('indoors', ['A stray button lies under the bench at {place}, bright as a new coin.', 'A page folded small is tucked behind a cup at {place}.', 'A scrap of cloth hangs on a nail in {place}, as if torn in haste.', 'A ring of keys sits on a ledge in {place}, nobody near.']),
        ...set('road', ['A broken wheel lies in the ditch near {place}, its spokes fresh-cut.', 'A bundle of letters tied with string lies at the roadside near {place}.', 'A horseshoe lies in the road near {place}, still warm to the touch.', 'A cairn of small stones has been built beside the road at {place}.']),
        ...set('water', ['A sealed jar bobs against the pilings at {place}.', 'A length of good cord is wound around a mooring post at {place}.', 'A boot is wedged between two stones at the edge of the water at {place}.', 'A tarred package floats near the steps at {place}.']),
    ]),
    OUTSIDE_INTRUSION: Object.freeze([
        ...set('wild', ['A lone traveller stands at the edge of the trees near {place}, watching.', 'Smoke from a fresh campfire rises beyond the ridge near {place}.', 'A horn sounds far off beyond {place}, twice, and goes quiet.', 'Fresh hoofprints cross the track near {place}, heading in.']),
        ...set('town', ['A guard captain stops at {place} and looks over the faces in the crowd.', 'A runner pushes through {place} with a sealed letter, calling a name.', 'A stranger asks the way to a house in {place} and waits for an answer.', 'A group of men in matching coats takes a table at {place} and says little.']),
        ...set('indoors', ['A cloaked stranger takes the corner seat in {place} and orders nothing.', 'Muddy boots appear at the door of {place}; the owner is breathless.', 'A letter is pushed under the door of {place} and footsteps recede.', 'The door of {place} opens on a damp figure who scans the room.']),
        ...set('road', ['A rider overtakes you near {place} without a word and glances back once.', 'Two travellers wait on the verge near {place} and watch you pass.', 'A wagon with no markings stands on the road by {place}, its driver gone.', 'A messenger on a blown horse stops by {place} and asks who passed.']),
        ...set('water', ['A boat nears the landing at {place}, its crew watching the shore.', 'Someone waves a lamp from the far bank across from {place}.', 'A barge with a closed hatch ties up at {place} and no one comes out.', 'A stranger steps off a ferry at {place} and studies the faces on the quay.']),
    ]),
    MEMORY_TRIGGER: Object.freeze([
        ...set('wild', ['{name} touches a scar and looks off down the path.', '{name} crouches to study something in the dirt, then stands and moves on.', '{name} finds the scent of the trees at {place} oddly familiar.', '{name} names a flower beside the track, to no one in particular.']),
        ...set('town', ['{name} stops before a shopfront and reads its sign twice.', '{name} watches a child at play and loses the thread of the talk.', '{name} smells something baking at {place} and goes quiet.', '{name} looks up at the rooftops of {place} as if counting them.']),
        ...set('indoors', ['{name} runs a hand along the doorframe of {place} and says nothing.', '{name} hears a song from the next room and goes still.', '{name} glances at a stranger at {place} and looks away at once.', '{name} picks up a cup and turns it, studying the maker\'s mark.']),
        ...set('road', ['{name} slows at a bend in the road near {place} and looks at it carefully.', '{name} glances at a waymarker near {place} and murmurs a name.', '{name} says the weather is the same as it was one year ago.', '{name} walks on in silence, one hand on a pocket.']),
        ...set('water', ['{name} watches a gull land on a post at {place} and smiles faintly.', '{name} listens to the water at {place} and is quiet a while.', '{name} says the landing at {place} smells just as it used to.', '{name} turns a coin in their fingers, watching the boats.']),
    ]),
    POWER_SHIFT: Object.freeze([
        ...set('wild', ['A new set of boundary stones has been set near {place}, the earth still raw.', 'A patrol near {place} turns travellers back and will not say why.', 'A tax collector\'s cart stands empty at the edge of {place}.', 'A banner you do not know hangs from a post near {place}.']),
        ...set('town', ['A line forms at the doors of a counting house near {place}.', 'Guards near {place} have changed their colours since yesterday.', 'A crier at {place} reads a short proclamation and is not asked questions.', 'A shop near {place} is closed, its owner\'s sign taken down.']),
        ...set('indoors', ['The owner of {place} hangs a new licence on the wall, still smelling of ink.', 'Two clerks argue in low voices at the counter of {place}.', 'A seat at the head table of {place} is empty, and no one will take it.', 'A toast is cut short in {place} as a messenger enters.']),
        ...set('road', ['A new toll post stands on the road near {place}, the paint barely dry.', 'Soldiers near {place} wave some travellers through and stop others.', 'A milestone near {place} has had the old name chiselled off.', 'A herald rides by {place} with an unfamiliar crest on his sleeve.']),
        ...set('water', ['A harbour clerk at {place} turns away a ship the crew say is expected.', 'A new flag flies at {place}, and the dockhands look at it, not at each other.', 'A customs officer at {place} is not the one who was there yesterday.', 'Crates at {place} are being counted twice, by two different men.']),
    ]),
});
