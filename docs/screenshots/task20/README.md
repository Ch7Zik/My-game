# Task 20: victory screen visual comparison

The concept attached to the task is the visual reference. Its explanatory callouts and arrows are not game UI. The portrait painting, existing buttons and result flow remain in their previous positions.

`before/` contains real Chromium screenshots from the running game at the merged PR #19 baseline (`af86ac6`). These were captured by the same full puzzle playthrough browser test used for `after/`; PR #19 is part of `main` at `828c5ae`. `after/` records task #20 at 360×640, 375×667, 390×844, 393×852, 430×932 and 1920×1080. Each size includes `game`, `victory-early`, `victory-during` and `victory-final`. The game frames verify that only the victory view changed.

The final victory captures show the new thin double gold frame, symmetric corner scrollwork, title flourish on taller screens, faceted earned stars, clock badge and the existing gold Continue button with a restrained halo. On 360×640 the title flourish is intentionally omitted so the painting keeps its full original area. The concept's much larger stars and elaborate full-height framing would crowd this viewport, so those proportions were adapted while preserving the picture size and touch target.

`after/variants/stars-1.png`, `stars-2.png`, `stars-3.png` and `stars-reduced-motion.png` show the award states at 390×844. The test changes only the elapsed time of an already completed scene for these variant captures; normal scoring, saved results and the full playthrough remain unmodified. The three phase captures sample the existing sequential star animation at 80 ms, 610 ms and 1250 ms. A real reduced-motion completion is also captured in `after/variants/real-completion-reduced-motion.png`.

All images are screenshots of the running Phaser game in Chromium, not mockups. No physical iPhone or Safari was available.
