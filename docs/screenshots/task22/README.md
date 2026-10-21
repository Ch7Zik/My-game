# Task 22 — piece layers

`before/partial-390x844.png` and `before/partial-1920x1080.png` are copies of the real level-six browser playthrough in `docs/screenshots/task21/`, before this fix. `after/` contains screenshots of the running game after this fix. They were captured by `tests/browser-level-six.mjs` during normal emulated touch or mouse assembly, not by opening a mock victory state. The `partial-*` images were taken after pieces 11 through 6 were placed, leaving pieces 0 through 5 free.

The original depth was `10 + piece.id` for both placed and free pieces. Placing a larger-id piece could cover a smaller-id free piece. The new ordering is placed (10), free (20 + id / 100), active drag (50). A mask-aware browser check confirms every free piece has exposed opaque pixels after each placement. The same test completes level six in descending and ascending order and checks levels 1–5, hints, replay, persistence and navigation.

Captures are from Chromium at the named CSS viewport sizes. No physical iPhone or Safari was available here.
