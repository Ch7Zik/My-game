# Task 23 — library shuffle and development experiments

The `before/` images are copies of actual level-six Chromium gameplay screenshots from Task 22, before the new shuffle. The `after/` images are captured from the running Phaser game by `tests/browser-task23.mjs`, using emulated touch at mobile CSS sizes and mouse at 1920×1080. Each `start-*` image shows the opening arrangement; `partial-*` shows normal assembly at the halfway point; `victory-*` follows placement of the final piece; and `assembled-*` crops the finished picture from that victory screenshot.

The published sixth level still contains twelve pieces and uses the same art, masks, hint, timer, star thresholds, saves, and three depth layers. Its starting positions are now generated from a fresh seeded permutation for each playthrough. The 16- and 20-piece configurations are available only on the Vite development server with `?devPieces=16` or `?devPieces=20`. Production builds have `devPieces` fixed to zero and retain the published twelve-piece configuration.

`after/production-query-390x844.png` is a screenshot of the actual `build:pages` output served with `vite preview --base=/My-game/` at `?devPieces=20`; it still opens the ordinary menu. The production run loaded all assets without JavaScript or HTTP errors.

The browser test uses opaque pixels to find visible pickup points, simulates touch movement, checks for a jump at pickup, places every piece in two orders at 390×844, and checks the hint, resize, victory, saved result, and continuation button. The six tested sizes are 360×640, 375×667, 390×844, 393×852, 430×932, and 1920×1080. Screenshots are from Chromium browser viewports, not a physical iPhone or Safari.
