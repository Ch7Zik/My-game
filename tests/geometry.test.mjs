import test from 'node:test';
import assert from 'node:assert/strict';
import { createRegions, isNear } from '../src/geometry.ts';

test('eight deterministic organic regions cover every source pixel exactly once', () => {
  const a = createRegions(160, 240), b = createRegions(160, 240);
  assert.equal(a.regions.length, 8);
  assert.equal(a.labels.length, 160 * 240);
  assert.deepEqual([...a.labels], [...b.labels]);
  assert.equal(a.regions.reduce((sum, region) => sum + region.pixels, 0), a.labels.length);
  assert.ok(a.regions.every(region => region.pixels > 160 * 240 * 0.055));
});

test('magnet accepts only points inside the configured radius', () => {
  assert.equal(isNear({ x: 0, y: 0 }, { x: 3, y: 4 }, 5), true);
  assert.equal(isNear({ x: 0, y: 0 }, { x: 3, y: 4 }, 4.9), false);
});
