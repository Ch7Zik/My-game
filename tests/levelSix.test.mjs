import test from 'node:test';
import assert from 'node:assert/strict';
import { LEVELS } from '../src/levels.ts';
import { createRegions, inspectRegions, qualityProblems } from '../src/geometry.ts';
import { gameLayout, looseScale, startPosition } from '../src/layout.ts';

const level = LEVELS[5];
const raster = { width: 240, height: 360 };
const { labels, regions } = createRegions(raster.width, raster.height, level.columns, level.rows, level.seed);

test('experiment has twelve broad, unique, connected silhouettes without holes', () => {
  assert.equal(level.id, 6);
  assert.equal(regions.length, 12);
  assert.equal(regions.reduce((total, piece) => total + piece.pixels, 0), labels.length);
  assert.deepEqual(qualityProblems(inspectRegions(raster.width, raster.height, labels, regions)), []);
  assert.ok(regions.every(piece => piece.pixels / labels.length >= .065));
});

test('actual mobile and desktop raster masks retain the same shape quality', () => {
  for (const width of [840, 960]) {
    const height = width * 1.5;
    const full = createRegions(width, height, level.columns, level.rows, level.seed);
    assert.deepEqual(qualityProblems(inspectRegions(width, height, full.labels, full.regions)), []);
  }
});

test('every experimental piece has a visible finger-sized pickup area at all target sizes', () => {
  for (const [width, height] of [[360, 640], [375, 667], [390, 844], [393, 852], [430, 932], [1920, 1080]]) {
    const { board } = gameLayout(width, height);
    const scale = looseScale(width, height);
    const starts = regions.map(region => {
      const pieceWidth = (region.bounds.width + 12) / raster.width * board.width * scale;
      const pieceHeight = (region.bounds.height + 12) / raster.height * board.height * scale;
      const point = startPosition(board, width, level.slots[region.id], pieceWidth, pieceHeight);
      const home = { x: board.x + region.center.x / raster.width * board.width,
        y: board.y + region.center.y / raster.height * board.height };
      assert.ok(Math.min(pieceWidth, pieceHeight) >= 80, `${width}: piece ${region.id} too small`);
      assert.ok(point.x - pieceWidth / 2 >= 0 && point.x + pieceWidth / 2 <= width);
      assert.ok(point.y - pieceHeight / 2 >= board.y && point.y + pieceHeight / 2 <= board.y + board.height);
      assert.ok(Math.hypot(point.x - home.x, point.y - home.y) > Math.max(28, board.width * .14));
      return point;
    });
    const total = Array(12).fill(0), visible = Array(12).fill(0);
    let covered = 0, overlapped = 0;
    for (let y = board.y + 2; y < board.y + board.height - 2; y += 4)
      for (let x = board.x + 2; x < board.x + board.width - 2; x += 4) {
        const hits = [];
        for (const region of regions) {
          const center = starts[region.id], b = region.bounds;
          const sourceX = Math.floor((x - center.x) / (board.width * scale) * raster.width + b.x + b.width / 2);
          const sourceY = Math.floor((y - center.y) / (board.height * scale) * raster.height + b.y + b.height / 2);
          if (sourceX >= 0 && sourceY >= 0 && sourceX < raster.width && sourceY < raster.height &&
            labels[sourceY * raster.width + sourceX] === region.id) hits.push(region.id);
        }
        if (hits.length) {
          covered++;
          for (const id of hits) total[id]++;
          visible[hits.at(-1)]++;
          if (hits.length > 1) overlapped++;
        }
      }
    assert.ok(overlapped / covered < .03, `${width}: occupied pieces overlap`);
    assert.ok(visible.every((pixels, id) => pixels / total[id] > .9 && pixels * 16 > 1800),
      `${width}: hidden or too-small pickup area`);
  }
});
