# Thread ownership and acceptance

Story Director owns `director.threads`, its key index and retry ledger. The story can create and update threads, including story-told quests. The Quests screen reads the same threads; it does not calculate battle objectives or pay battle rewards. Older quest extensions remain readable and are refused by the writers.

`threads.offer` creates a neutral offer. `threads.accept` accepts a neutral offer only with a reader action or validated acceptance evidence. `threads.intent` checks the reader's words before accepting. Writers compare an expected thread hash and record a write ID for safe retries. Acceptance uses Story Block's evidence and replay guard so removing or changing its source does not silently preserve an unsupported acceptance.

See `src/v2/tracker/writers.js`, `acceptance.js`, `thread-writes.js`, and the tests in `tests/v2/tracker/`.
