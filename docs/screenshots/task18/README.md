# Task 18: level number rendering

These are screenshots of the running game in Chromium at device pixel ratio 2. `before/` was captured from merged PR #17 (`22bc076`); `after/` was captured with this change. The `game-*.png` files show the full game screen. `tag-*.png` files are unscaled crops from those screenshots. `compare-guides-*.png` enlarge both crops with nearest-neighbor scaling and mark the sampled upper and lower visible gold-pixel edges of the word (cyan) and numeral (pink). `compare-game-*.png` juxtapose full screens.

The browser test samples actual screenshot pixels, not Phaser text bounds. It covers viewports 375×667, 390×844, 393×852, 430×932 and displayed numbers 1, 2, 8, 10, 11, 19, 25. In the `after/measurements.json` report, the numeral-to-word top and bottom edge deltas are 0 CSS pixels for every case. The same is true of the local Chromium baseline because this machine resolves Georgia to Noto Serif. That baseline cannot reproduce the native iPhone Georgia font metrics reported by the user. The bundled Noto Serif font makes the level label's glyphs deterministic across platforms. The screenshots do not constitute a test on a physical iPhone or Safari.

The test changes only the displayed level number temporarily to inspect future double-digit labels; it does not add levels or alter game progression.
