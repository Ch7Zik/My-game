import test from 'node:test';
import assert from 'node:assert/strict';
import { gameLayout } from '../src/layout.ts';
import { fitVictoryStars, victoryAwardProgress, victoryScreenLayout } from '../src/victoryLayout.ts';

test('independent victory composition fits art, time, stars and button at every target size', () => {
  for (const [w, h] of [[360, 640], [390, 844], [430, 932], [1920, 1080]]) {
    for (const [safeTop, safeBottom] of [[0, 0], [47, 34]]) {
      const layout = victoryScreenLayout(w, h, safeTop, safeBottom);
      const { picture, button } = layout;
      assert.equal(picture.width * 1.5, picture.height);
      assert.ok(picture.width >= 240);
      assert.ok(picture.y >= safeTop);
      assert.ok(picture.y + picture.height < layout.timeY || !layout.portrait);
      assert.ok(layout.timeY < button.y || !layout.portrait);
      assert.ok(layout.titleY < layout.nameY && layout.nameY < layout.starsY);
      assert.ok(layout.starsY < picture.y || !layout.portrait);
      assert.ok(button.width >= 44 && button.height >= 44);
      assert.ok(button.y + button.height <= h - safeBottom);
      assert.ok(picture.x >= 0 && picture.x + picture.width <= w);
      assert.ok(button.x >= 0 && button.x + button.width <= w);
      if (w < 900) assert.notDeepEqual(picture, gameLayout(w, h).board);
    }
  }
});

test('star art and its glow remain between the measured name and picture frame', () => {
  for (const [w, h] of [[360, 640], [390, 844], [430, 932]]) {
    const layout = victoryScreenLayout(w, h);
    const frameTop = layout.picture.y - 7;
    // Allow for the measured lower edge of a portrait Phaser title.
    const nameBottom = layout.nameY + 10;
    const fit = fitVictoryStars(nameBottom, frameTop, layout.starsY, layout.starRadius);
    assert.ok(fit.glowRadius >= layout.starRadius, `${w}: glow must contain the stars`);
    assert.ok(fit.y - fit.glowRadius >= nameBottom - fit.headingShift + fit.gap, `${w}: name clearance`);
    assert.ok(fit.y + fit.glowRadius <= frameTop - fit.gap, `${w}: frame clearance`);
  }
});

test('earned stars appear in three short beats and reduced motion shows them immediately', () => {
  for (let index = 0; index < 3; index++) {
    assert.equal(victoryAwardProgress(0, index), 0);
    assert.equal(victoryAwardProgress(900, index), 1);
    assert.equal(victoryAwardProgress(0, index, true), 1);
    for (let ms = 1; ms <= 900; ms++)
      assert.ok(victoryAwardProgress(ms, index) >= victoryAwardProgress(ms - 1, index));
  }
  assert.ok(victoryAwardProgress(610, 0) > victoryAwardProgress(610, 1));
  assert.equal(victoryAwardProgress(610, 2), 0);
});
