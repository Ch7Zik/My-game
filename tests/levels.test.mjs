import test from 'node:test';
import assert from 'node:assert/strict';
import { LEVELS } from '../src/levels.ts';
import { assetUrl } from '../src/assetUrl.ts';
import { createRegions, inspectRegions, qualityProblems } from '../src/geometry.ts';
import { completeLevel, freshProgress, isInGallery, isUnlocked, nextUnplayed, PROGRESS_KEY, restoreProgress, saveProgress, selectLevel } from '../src/progress.ts';

test('five supplied paintings keep their numbered order and exact piece counts', () => {
  assert.equal(assetUrl('assets/level-01.webp'), '/assets/level-01.webp');
  assert.deepEqual(LEVELS.map(level => level.pieces), [10, 11, 12, 12, 12, 12]);
  for (let id = 1; id <= 5; id++) {
    assert.equal(LEVELS[id - 1].art, `/assets/level-0${id}.webp`);
    assert.equal(LEVELS[id - 1].thumbnail, `/assets/level-0${id}-thumb.webp`);
  }
  assert.equal(new Set(LEVELS.map(level => level.art)).size, 6);
  for (const level of LEVELS) {
    assert.ok(level.columns * level.rows >= level.pieces);
    assert.equal(level.slots.length, level.pieces);
    assert.ok(level.phrase.length > 10);
  }
});

test('each authored mask covers every pixel exactly once, without bad or disconnected shapes', () => {
  for (const level of LEVELS) {
    const { labels, regions } = createRegions(240, 360, level.columns, level.rows, level.seed, level.pieces);
    assert.equal(regions.length, level.pieces);
    assert.equal(regions.reduce((sum, region) => sum + region.pixels, 0), labels.length);
    assert.ok(labels.every(label => label < level.pieces));
    for (const region of regions) assert.equal(labels.filter(label => label === region.id).length, region.pixels);
    assert.deepEqual(qualityProblems(inspectRegions(240, 360, labels, regions)), [], `level ${level.id}`);
  }
});

test('production-resolution masks pass the same shape checks', () => {
  for (const level of LEVELS) {
    const { labels, regions } = createRegions(720, 1080, level.columns, level.rows, level.seed, level.pieces);
    assert.equal(regions.reduce((sum, region) => sum + region.pixels, 0), labels.length);
    assert.deepEqual(qualityProblems(inspectRegions(720, 1080, labels, regions)), [], `level ${level.id}`);
  }
});

test('completion opens only the next level and adds its picture to the gallery', () => {
  let progress = freshProgress();
  assert.equal(nextUnplayed(progress), 1);
  assert.equal(isUnlocked(progress, 1), true);
  assert.equal(isUnlocked(progress, 2), false);
  assert.equal(isInGallery(progress, 1), false);
  assert.equal(selectLevel(progress, 3).currentLevel, 1);
  for (let id = 1; id <= 6; id++) {
    progress = completeLevel(progress, id);
    assert.equal(isInGallery(progress, id), true);
    assert.equal(nextUnplayed(progress), id + 1);
    if (id < 6) assert.equal(isUnlocked(progress, id + 1), true);
  }
  assert.equal(progress.completed.length, 6);
  assert.equal(nextUnplayed(progress), 7);
  assert.equal(progress.currentLevel, 6);
});

test('versioned progress survives reload and corrupt saves recover safely', () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const original = completeLevel(freshProgress(), 1);
  saveProgress(storage, original);
  assert.deepEqual(restoreProgress(storage), original);
  values.set(PROGRESS_KEY, '{bad json');
  assert.deepEqual(restoreProgress(storage), freshProgress());
  values.set(PROGRESS_KEY, JSON.stringify({ version: 99, completed: [1, 2], currentLevel: 3 }));
  assert.deepEqual(restoreProgress(storage), freshProgress());
  values.set(PROGRESS_KEY, JSON.stringify({ version: 1, completed: [1, 3, 999], currentLevel: 5 }));
  assert.deepEqual(restoreProgress(storage), { version: 1, completed: [1], currentLevel: 2 });
});

test('existing five-level save unlocks level six without losing history', () => {
  const oldSave = { version: 1, completed: [1, 2, 3, 4, 5], currentLevel: 5 };
  const storage = { getItem: () => JSON.stringify(oldSave) };
  const restored = restoreProgress(storage);
  assert.deepEqual(restored, oldSave);
  assert.equal(nextUnplayed(restored), 6);
  assert.equal(isUnlocked(restored, 6), true);
  assert.equal(isInGallery(restored, 6), false);
});
