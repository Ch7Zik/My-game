import test from 'node:test';
import assert from 'node:assert/strict';
import { fitPainting, levelGrid } from '../src/levelGrid.ts';

test('five chapters contain two pairs and a wide fifth painting', () => {
  for (const [w, h] of [[320, 568], [375, 667], [390, 844], [430, 932], [432, 768], [607, 1080]]) {
    const grid = levelGrid(w, h, 25);
    assert.equal(grid.cards.length, 25);
    assert.deepEqual(grid.chapters.map(({ first, last }) => [first, last]),
      [[1, 5], [6, 10], [11, 15], [16, 20], [21, 25]]);
    assert.ok(grid.maxScroll > 0);
    for (let chapter = 0; chapter < 5; chapter++) {
      const cards = grid.cards.slice(chapter * 5, chapter * 5 + 5);
      assert.equal(cards[0].y, cards[1].y);
      assert.equal(cards[2].y, cards[3].y);
      assert.equal(cards[4].width, grid.contentWidth);
      assert.ok(cards[4].y > cards[2].y + cards[2].height);
      assert.ok(cards.every(card => card.x >= 0 && card.x + card.width <= w));
    }
    const last = levelGrid(w, h, 25, Infinity);
    assert.equal(last.scroll, last.maxScroll);
    assert.ok(last.cards[24].y >= last.top);
    assert.ok(last.cards[24].y + last.cards[24].height <= last.bottom - 14);
  }
});

test('safe area and continuous scroll keep the last card reachable', () => {
  const grid = levelGrid(390, 844, 25, 218.5, 44, 34);
  assert.equal(grid.scroll, 218.5);
  assert.ok(grid.top >= 44);
  assert.ok(grid.bottom <= 844 - 34);
  const end = levelGrid(390, 844, 25, grid.maxScroll, 44, 34);
  assert.ok(end.cards[24].y >= end.top && end.cards[24].y + end.cards[24].height <= end.bottom);
});

test('painting fit preserves its full aspect ratio inside narrow and wide cards', () => {
  const grid = levelGrid(390, 844, 25);
  for (const card of [grid.cards[0], grid.cards[4]]) {
    const frame = { x: card.x + 8, y: card.y + 8, width: card.width - 16, height: card.height - 20 };
    const image = fitPainting(frame, 848, 1264);
    assert.ok(image.x >= frame.x && image.y >= frame.y);
    assert.ok(image.x + image.width <= frame.x + frame.width + .001);
    assert.ok(image.y + image.height <= frame.y + frame.height + .001);
    assert.ok(Math.abs(image.width / image.height - 848 / 1264) < .00001);
  }
});
