import test from 'node:test';
import assert from 'node:assert/strict';
import { levelGrid } from '../src/levelGrid.ts';

test('five levels retain their established two-column mobile layout', () => {
  for (const [w, h] of [[360, 640], [375, 667], [390, 844], [393, 852], [430, 932]]) {
    const grid = levelGrid(w, h, 5);
    assert.equal(grid.maxScrollRow, 0);
    assert.equal(grid.cards[0].y, grid.cards[1].y);
    assert.ok(grid.cards[4].y >= grid.top);
    assert.ok(grid.cards[4].y + grid.cards[4].height <= grid.bottom + .01);
  }
});

test('a future 25-level collection scrolls in whole rows without card clipping', () => {
  for (const [w, h] of [[360, 640], [390, 844], [430, 932], [1920, 1080]]) {
    const first = levelGrid(w, h, 25);
    assert.ok(first.maxScrollRow > 0);
    const last = levelGrid(w, h, 25, 99);
    assert.equal(last.scrollRow, last.maxScrollRow);
    assert.ok(last.cards[24].y >= last.top);
    assert.ok(last.cards[24].y + last.cards[24].height <= last.bottom + .01);
    assert.ok(last.cards[24].x + last.cards[24].width <= w);
  }
});
