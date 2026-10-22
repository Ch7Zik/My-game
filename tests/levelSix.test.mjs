import test from 'node:test';
import assert from 'node:assert/strict';
import { LEVELS } from '../src/levels.ts';
import { createRegions, inspectRegions, qualityProblems } from '../src/geometry.ts';

const level = LEVELS[5];
const raster = { width: 240, height: 360 };
const { labels, regions } = createRegions(raster.width, raster.height, level.columns, level.rows, level.seed, level.pieces);

test('the library painting has fourteen broad, connected silhouettes without holes', () => {
  assert.equal(level.id, 6);
  assert.equal(level.title, 'Хранитель библиотеки');
  assert.equal(regions.length, 14);
  assert.equal(regions.reduce((total, piece) => total + piece.pixels, 0), labels.length);
  assert.deepEqual(qualityProblems(inspectRegions(raster.width, raster.height, labels, regions)), []);
  assert.ok(regions.every(piece => piece.pixels / labels.length >= .04));
});

test('actual mobile and desktop raster masks retain the same shape quality', () => {
  for (const width of [840, 960]) {
    const height = width * 1.5;
    const full = createRegions(width, height, level.columns, level.rows, level.seed, level.pieces);
    assert.deepEqual(qualityProblems(inspectRegions(width, height, full.labels, full.regions)), []);
  }
});
