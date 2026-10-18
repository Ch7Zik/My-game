import test from 'node:test';
import assert from 'node:assert/strict';
import { LEVELS } from '../src/levels.ts';
import { assetUrl } from '../src/assetUrl.ts';
import { createRegions, inspectRegions, qualityProblems } from '../src/geometry.ts';
import { gameLayout, looseScale, startPosition } from '../src/layout.ts';
import { completeLevel, freshProgress, isInGallery, isUnlocked, nextUnplayed, PROGRESS_KEY, restoreProgress, saveProgress, selectLevel } from '../src/progress.ts';

test('five unique images use the planned 4/4/6/6/8 progression', () => {
  assert.equal(assetUrl('assets/moonlit-cottage.png'), '/assets/moonlit-cottage.png');
  assert.deepEqual(LEVELS.map(level => level.pieces), [4, 4, 6, 6, 8]);
  assert.equal(new Set(LEVELS.map(level => level.art)).size, 5);
  for (const level of LEVELS) {
    assert.equal(level.columns * level.rows, level.pieces);
    assert.equal(level.slots.length, level.pieces);
    assert.ok(level.phrase.length > 10);
  }
});

test('each authored mask covers every pixel exactly once, without bad or disconnected shapes', () => {
  for (const level of LEVELS) {
    const { labels, regions } = createRegions(240, 360, level.columns, level.rows, level.seed);
    assert.equal(regions.length, level.pieces);
    assert.equal(regions.reduce((sum, region) => sum + region.pixels, 0), labels.length);
    assert.ok(labels.every(label => label < level.pieces));
    for (const region of regions) assert.equal(labels.filter(label => label === region.id).length, region.pixels);
    assert.deepEqual(qualityProblems(inspectRegions(240, 360, labels, regions)), [], `level ${level.id}`);
    for (const [w, h] of [[360, 640], [390, 844], [430, 932], [768, 1024], [1920, 1080]]) {
      const { board } = gameLayout(w, h), scale = looseScale(w, h);
      for (const region of regions) {
        const pieceW = (region.bounds.width + 12) / 240 * board.width * scale;
        const pieceH = (region.bounds.height + 12) / 360 * board.height * scale;
        const point = startPosition(board, w, level.slots[region.id], pieceW, pieceH);
        const home = { x: board.x + (region.bounds.x + region.bounds.width / 2) / 240 * board.width, y: board.y + (region.bounds.y + region.bounds.height / 2) / 360 * board.height };
        assert.ok(point.x - pieceW / 2 >= 0 && point.x + pieceW / 2 <= w);
        assert.ok(point.y - pieceH / 2 >= board.y && point.y + pieceH / 2 <= board.y + board.height);
        assert.ok(Math.hypot(point.x - home.x, point.y - home.y) > Math.max(28, board.width * .14));
      }
    }
  }
});

test('production-resolution masks pass the same shape checks', () => {
  for (const level of LEVELS) {
    const { labels, regions } = createRegions(720, 1080, level.columns, level.rows, level.seed);
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
  for (let id = 1; id <= 5; id++) {
    progress = completeLevel(progress, id);
    assert.equal(isInGallery(progress, id), true);
    assert.equal(nextUnplayed(progress), id + 1);
    if (id < 5) assert.equal(isUnlocked(progress, id + 1), true);
  }
  assert.equal(progress.completed.length, 5);
  assert.equal(nextUnplayed(progress), 6);
  assert.equal(progress.currentLevel, 5);
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
