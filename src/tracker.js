// The tracker: agendas, events, hooks, clocks, beats and secrets, built only from change
// lines. Because every change lives in the reply that made it, the tracker for any point in
// the chat is a replay of the entries up to it. Pure: every function returns new objects and
// never mutates its inputs (records are copied on write, unchanged ones are shared).
//
// This path stays the public facade: apply, replay and the queries moved to small helper files.

export { keyWords, nearMatches } from './tracker-words.js';
export { waitsForPay, looksFinished, givenUpIn, isOffer, offersChosenIn } from './tracker-said.js';
export { emptyTracker } from './tracker-records.js';
export { applyOps } from './tracker-apply.js';
export { markSeen, replay } from './tracker-replay.js';
export { untrackedCorrections, questOutcome, findRecord, activeRecords, questsDoneIn } from './tracker-queries.js';
