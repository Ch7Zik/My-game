import test from 'node:test';
import assert from 'node:assert/strict';
import { freshProgress, completeLevel, restoreProgress, saveProgress } from '../src/progress.ts';
import { formatTime, recordResult, restoreResults, saveResults, starsForDisplay, starsForTime, STAR_THRESHOLDS_SECONDS, RESULTS_KEY } from '../src/results.ts';
import { gameLayout } from '../src/layout.ts';

test('configurable star times respect existing timing brackets and have no failure state', () => {
  for (const pieces of [4, 6, 8, 10, 11, 12, 14, 15, 16, 17, 18, 19, 20]) {
    const { three, two } = STAR_THRESHOLDS_SECONDS[pieces >= 10 ? 12 : pieces];
    assert.ok(two > three);
    assert.equal(starsForTime(pieces, three * 1000), 3);
    assert.equal(starsForTime(pieces, three * 1000 + 1), 2);
    assert.equal(starsForTime(pieces, two * 1000 + 1), 1);
  }
  assert.equal(formatTime(84000), '01:24');
  assert.equal(formatTime(3600000), '60:00');
});

test('replays keep fastest time and highest star count independently', () => {
  let results = recordResult({}, 1, 800000);
  assert.deepEqual(results[1], { bestMs: 800000, stars: 1 });
  results = recordResult(results, 1, 500000);
  assert.deepEqual(results[1], { bestMs: 500000, stars: 2 });
  results = recordResult(results, 1, 900000);
  assert.deepEqual(results[1], { bestMs: 500000, stars: 2 });
  results = recordResult(results, 1, 50000);
  assert.deepEqual(results[1], { bestMs: 50000, stars: 3 });
  assert.equal(recordResult(results, 99, 1000), results);
});

test('legacy completions show one star until a timed replay, without inventing a best time', () => {
  const completed = [1, 2, 3, 4, 5];
  assert.equal(starsForDisplay(completed, {}, 1), 1);
  assert.equal(starsForDisplay(completed, {}, 5), 1);
  assert.equal(starsForDisplay([], {}, 1), 0);
  const replay = recordResult({}, 1, 70000);
  assert.equal(starsForDisplay(completed, replay, 1), 3);
  assert.equal(replay[1].bestMs, 70000);
  assert.equal(starsForDisplay(completed, {}, 6), 0);
});

test('results survive reload without changing legacy level progress', () => {
  const data = new Map();
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  const progress = completeLevel(freshProgress(), 1);
  saveProgress(storage, progress);
  saveResults(storage, recordResult({}, 1, 66000));
  assert.deepEqual(restoreProgress(storage), progress);
  assert.deepEqual(restoreResults(storage)[1], { bestMs: 66000, stars: 3 });
  data.set(RESULTS_KEY, '{broken');
  assert.deepEqual(restoreResults(storage), {});
  assert.deepEqual(restoreProgress(storage), progress);
});

test('mobile board gains usable area while retaining its 2:3 geometry', () => {
  const previous = { '360x640': 308.66666666666663, '390x844': 370, '430x932': 410 };
  for (const [w, h] of [[360, 640], [390, 844], [430, 932]]) {
    const { board } = gameLayout(w, h);
    assert.ok(board.width > previous[`${w}x${h}`]);
    assert.equal(board.height, board.width * 1.5);
    assert.ok(board.x >= 0 && board.x + board.width <= w);
    assert.ok(board.y >= 58 && board.y + board.height < h);
  }
});
