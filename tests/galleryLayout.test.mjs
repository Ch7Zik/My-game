import test from 'node:test';
import assert from 'node:assert/strict';
import { galleryGrid } from '../src/galleryLayout.ts';

test('portrait gallery has two large art columns and every row is reachable', () => {
  for (const [w, h] of [[360, 640], [390, 844], [430, 932]]) {
    const layout = galleryGrid(w, h, 25);
    assert.equal(layout.cards[0].y, layout.cards[1].y);
    assert.ok(layout.cards[0].width >= 160);
    assert.ok(layout.cards[0].height > layout.cards[0].width);
    assert.ok(layout.maxScrollRow > 0);
    const last = galleryGrid(w, h, 25, layout.maxScrollRow);
    assert.ok(last.cards[24].y >= last.top);
    assert.ok(last.cards[24].y + last.cards[24].height <= last.bottom + .01);
  }
});

test('desktop gallery keeps paintings compact and reaches a 25-image catalog', () => {
  const layout = galleryGrid(1920, 1080, 25);
  assert.equal(layout.cards[0].y, layout.cards[4].y);
  assert.ok(layout.cards[0].width <= 300);
  const last = galleryGrid(1920, 1080, 25, 99);
  assert.equal(last.scrollRow, last.maxScrollRow);
  assert.ok(last.cards[24].y + last.cards[24].height <= last.bottom + .01);
});

test('gallery scroll accepts finger-sized pixel increments and safe insets', () => {
  const base = galleryGrid(375, 667, 25, 0, 44, 34);
  const shifted = galleryGrid(375, 667, 25, 28 / base.rowStep, 44, 34);
  assert.equal(base.top, 152);
  assert.equal(base.bottom, 623);
  assert.ok(Math.abs(shifted.cards[0].y - (base.cards[0].y - 28)) < .01);
  assert.ok(shifted.scrollRow > 0 && shifted.scrollRow < 1);
});
