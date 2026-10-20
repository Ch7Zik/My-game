# Task 19: gameplay and victory screenshots

`before/` records merged main at `ec46265` (including PR #18). `after/` records the same game after the victory star polish. All images are screenshots of the running Phaser game in Chromium. Every victory screenshot follows an actual mouse or touch playthrough of level 1; no victory scene is opened directly.

For each of 360×640, 375×667, 390×844, 393×852, 430×932 and 1920×1080, the folders contain `game`, `victory-early`, `victory-during`, and `victory-final` PNGs. The after screenshots sample the reveal at 80 ms, the star sequence at 610 ms, and the settled result at 1250 ms. The browser clock is held only while encoding each screenshot so slow screenshot capture does not advance to the next phase. Before screenshots were taken with the same capture sequence before the animation change; all earned stars were static in every phase.

The browser test also verifies one, two and three filled star states at 390×844. Its `after/variants/stars-*.png` captures change only the completed time of an already completed level for visual inspection; they do not alter saved results. `after/variants/real-completion-reduced-motion.png` comes from a second real playthrough with `prefers-reduced-motion: reduce` active before the last piece is placed.

Visual review found the gameplay header, artwork frame and touch targets clear at the six requested sizes, so their geometry and styling were left intact. In the victory screen, the art, title, time and button retain their original layout. Only earned star fills and a small contained gold halo animate. The unearned stars remain outlined. No physical iPhone or Safari was available for these captures.
