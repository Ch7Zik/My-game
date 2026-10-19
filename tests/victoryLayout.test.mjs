import test from 'node:test';
import assert from 'node:assert/strict';
import { gameLayout } from '../src/layout.ts';
import { victoryScreenLayout } from '../src/victoryLayout.ts';

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
