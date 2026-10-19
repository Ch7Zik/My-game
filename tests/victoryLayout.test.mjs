import test from 'node:test';
import assert from 'node:assert/strict';
import { gameLayout } from '../src/layout.ts';
import { mobileVictoryLayout } from '../src/victoryLayout.ts';

test('portrait victory reserves a visible results area below the complete picture', () => {
  for (const [w, h] of [[360, 640], [390, 844], [430, 932]]) {
    const { board } = gameLayout(w, h);
    for (const [safeTop, safeBottom] of [[0, 0], [47, 34]]) {
      const layout = mobileVictoryLayout(w, h, board, safeTop, safeBottom);
      const { picture, results, button } = layout;
      assert.equal(picture.width * 1.5, picture.height);
      assert.ok(picture.width >= 240);
      assert.ok(picture.y >= safeTop + 60);
      assert.ok(results.y >= picture.y + picture.height + 8);
      assert.ok(layout.titleY > results.y && layout.titleY < layout.detailsY);
      assert.ok(layout.detailsY < button.y);
      assert.ok(button.width >= 44 && button.height >= 44);
      assert.ok(button.y + button.height <= h - safeBottom);
      assert.ok(results.y + results.height <= h - safeBottom);
      assert.ok(picture.x >= 0 && picture.x + picture.width <= w);
      assert.ok(results.x >= 0 && results.x + results.width <= w);
    }
  }
});
