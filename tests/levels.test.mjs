import test from 'node:test';
import assert from 'node:assert/strict';
import { LEVELS } from '../src/levels.ts';
import { assetUrl } from '../src/assetUrl.ts';
import { createRegions, inspectRegions, qualityProblems } from '../src/geometry.ts';
import { completeLevel, freshProgress, isInGallery, isUnlocked, nextUnplayed, PROGRESS_KEY, restoreProgress, saveProgress, selectLevel } from '../src/progress.ts';

test('twenty supplied paintings keep their numbered order, titles and exact piece counts', () => {
  assert.equal(assetUrl('assets/level-01.webp'), '/assets/level-01.webp');
  assert.deepEqual(LEVELS.map(level => level.pieces), [10, 11, 12, 12, 12, 14, 14, 15, 15, 15, 16, 16, 17, 17, 18, 18, 18, 19, 20, 20]);
  assert.deepEqual(LEVELS.map(level => level.title), [
    'Эликсир забвения', 'Колодец забытых имён', 'Часовня забытых', 'Зеркало ворона', 'Винтовая башня',
    'Хранитель библиотеки', 'Печать крови', 'Туманный сад', 'Песочные часы вечности', 'Ледяная часовня',
    'Обсерватория', 'Портрет хранителя', 'Кузница забвенных клинков', 'Белый олень', 'Костяной склеп',
    'Аметистовые врата', 'Медный механизм', 'Серебряный мост', 'Корни мирового древа', 'Пепельная пустошь',
  ]);
  for (let id = 1; id <= 20; id++) {
    const number = String(id).padStart(2, '0');
    assert.equal(LEVELS[id - 1].art, `/assets/level-${number}.webp`);
    assert.equal(LEVELS[id - 1].thumbnail, `/assets/level-${number}-thumb.webp`);
  }
  assert.equal(new Set(LEVELS.map(level => level.art)).size, 20);
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
  for (let id = 1; id <= 20; id++) {
    progress = completeLevel(progress, id);
    assert.equal(isInGallery(progress, id), true);
    assert.equal(nextUnplayed(progress), id + 1);
    if (id < 20) assert.equal(isUnlocked(progress, id + 1), true);
  }
  assert.equal(progress.completed.length, 20);
  assert.equal(nextUnplayed(progress), 21);
  assert.equal(progress.currentLevel, 20);
  assert.equal(isUnlocked(progress, 21), false);
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

test('existing ten- and fifteen-level saves open the next painting and completed collection survives replay', () => {
  const prior = { version: 1, completed: Array.from({ length: 10 }, (_, i) => i + 1), currentLevel: 10 };
  assert.deepEqual(restoreProgress({ getItem: () => JSON.stringify(prior) }), prior);
  assert.equal(nextUnplayed(prior), 11);
  assert.equal(isUnlocked(prior, 11), true);
  const priorFifteen = { version: 1, completed: Array.from({ length: 15 }, (_, i) => i + 1), currentLevel: 15 };
  assert.deepEqual(restoreProgress({ getItem: () => JSON.stringify(priorFifteen) }), priorFifteen);
  assert.equal(nextUnplayed(priorFifteen), 16);
  assert.equal(isUnlocked(priorFifteen, 16), true);
  let progress = freshProgress();
  for (let id = 1; id <= 20; id++) progress = completeLevel(progress, id);
  const values = new Map();
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  saveProgress(storage, progress);
  assert.deepEqual(restoreProgress(storage).completed, Array.from({ length: 20 }, (_, i) => i + 1));
  progress = completeLevel(restoreProgress(storage), 1);
  assert.deepEqual(progress.completed, Array.from({ length: 20 }, (_, i) => i + 1));
  assert.equal(nextUnplayed(progress), 21);
  assert.equal(isUnlocked(progress, 21), false);
});
