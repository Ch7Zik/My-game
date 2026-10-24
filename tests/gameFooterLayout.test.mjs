import test from 'node:test';
import assert from 'node:assert/strict';
import { gameFooterLayout, gameLayout } from '../src/layout.ts';

test('progress stays below the full painting and inside portrait screens', () => {
  for (const [w, h] of [[320, 568], [375, 667], [390, 844], [430, 932], [432, 768], [607, 1080]]) {
    const { board } = gameLayout(w, h);
    const footer = gameFooterLayout(w, h, board);
    assert.ok(footer.progress.y >= board.y + board.height - 1, `${w}x${h}: progress covers art`);
    assert.ok(footer.progress.x >= 0 && footer.progress.x + footer.progress.width <= w);
    assert.ok(footer.progress.y + footer.progress.height <= h);
    if (footer.hintBelow) {
      assert.ok(footer.hint.y - 24 >= board.y + board.height);
      assert.ok(footer.progress.x + footer.progress.width < footer.hint.x - 24);
    }
  }
});

test('safe insets move controls without cropping the painting', () => {
  const w = 375, h = 667, top = 44, bottom = 34;
  const { board } = gameLayout(w, h, top, bottom);
  const footer = gameFooterLayout(w, h, board, bottom);
  assert.ok(board.y >= top + 58);
  assert.ok(board.x >= 0 && board.x + board.width <= w);
  assert.ok(footer.progress.y >= board.y + board.height - 1);
  assert.ok(footer.progress.y + footer.progress.height <= h - bottom);
});
