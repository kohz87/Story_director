# Story Suite

Story Block hosts Story Director and other registered modules. Story Director provides the clock, calendar, map, story threads, standalone checks, World, Chronicle and optional arc planning. NPC State Delta is optional; when present, Director can read its people and social context through guarded queries.

Modules register through Story Block's SDK. The host owns state, the change-line capture and the shared interface; modules expose their own commands, queries, features and screens. See Story Block's `docs/v2/SPEC.md` and `docs/v2/MODULES.md` for the module API, and this repository's README for installation and play.
