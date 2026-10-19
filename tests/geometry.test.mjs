import test from 'node:test';
import assert from 'node:assert/strict';
import { createRegions, inspectRegions, qualityProblems, isNear } from '../src/geometry.ts';
import { gameLayout, looseScale, startPosition, SLOT_ORDER } from '../src/layout.ts';

const picture = createRegions(240, 360);

test('eight authored silhouettes cover the image with no holes or duplicate pixels', () => {
  const again = createRegions(240, 360);
  assert.equal(picture.regions.length, 8);
  assert.deepEqual(picture.labels, again.labels);
  assert.equal(picture.regions.reduce((sum, region) => sum + region.pixels, 0), picture.labels.length);
  for (let id = 0; id < 8; id++) {
    assert.equal(picture.labels.filter(label => label === id).length, picture.regions[id].pixels);
  }
});

test('shape checks reject narrow, elongated, angular, or repeated silhouettes', () => {
  const quality = inspectRegions(240, 360, picture.labels, picture.regions);
  assert.deepEqual(qualityProblems(quality), []);
  assert.ok(quality.every(piece => piece.areaRatio > .08));
  assert.ok(quality.every(piece => piece.connected));
  assert.ok(quality.every(piece => piece.localWidth > .08 && piece.localHeight > .07));
  const damaged = quality.map(q => ({ ...q }));
  damaged[0].localWidth = .01; damaged[1].aspect = 4;
  damaged[2].sharpTurns = 1; damaged[3].signature = [...damaged[4].signature];
  assert.ok(qualityProblems(damaged).some(problem => problem.includes('narrow section')));
  assert.ok(qualityProblems(damaged).some(problem => problem.includes('too elongated')));
  assert.ok(qualityProblems(damaged).some(problem => problem.includes('sharp bend')));
  assert.ok(qualityProblems(damaged).some(problem => problem.includes('similar silhouettes')));
});

test('mobile and desktop layouts keep the picture proportional and every start piece visible', () => {
  for (const [width, height] of [[360,640],[390,844],[430,932],[768,1024],[1920,1080]]) {
    const { board, preview } = gameLayout(width, height);
    assert.ok(Math.abs(board.width / board.height - 2 / 3) < 1e-10);
    assert.ok(board.x >= 0 && board.y >= 58);
    assert.ok(board.x + board.width <= width && board.y + board.height <= height - 40);
    if (preview) assert.ok(preview.x + preview.width <= width);
    const scale = looseScale(width, height);
    for (const region of picture.regions) {
      const pieceW = (region.bounds.width + 12) / 240 * board.width * scale;
      const pieceH = (region.bounds.height + 12) / 360 * board.height * scale;
      const p = startPosition(board, width, SLOT_ORDER[region.id], pieceW, pieceH);
      const home = {
        x: board.x + (region.bounds.x + region.bounds.width / 2) / 240 * board.width,
        y: board.y + (region.bounds.y + region.bounds.height / 2) / 360 * board.height,
      };
      assert.ok(p.x - pieceW / 2 >= 0 && p.x + pieceW / 2 <= width, `${width}: piece ${region.id} x`);
      assert.ok(p.y - pieceH / 2 >= board.y && p.y + pieceH / 2 <= board.y + board.height, `${width}: piece ${region.id} y`);
      assert.ok(Math.hypot(p.x - home.x, p.y - home.y) > Math.max(28, board.width * .14), `${width}: piece ${region.id} starts outside magnet`);
    }
  }
});

test('start layout exposes most of every silhouette with little overlap', () => {
  for (const [width, height] of [[360,640],[390,844],[430,932],[768,1024],[1920,1080]]) {
    const { board } = gameLayout(width, height), scale = looseScale(width,height);
    const starts = picture.regions.map(region => {
      const pieceW = region.bounds.width / 240 * board.width * scale;
      const pieceH = region.bounds.height / 360 * board.height * scale;
      return startPosition(board, width, SLOT_ORDER[region.id], pieceW, pieceH);
    });
    const all = Array(8).fill(0), visible = Array(8).fill(0);
    let covered = 0, overlap = 0;
    for (let y = board.y + 3; y < board.y + board.height - 3; y += 3) for (let x = board.x + 3; x < board.x + board.width - 3; x += 3) {
      const hits = [];
      for (const region of picture.regions) {
        const start = starts[region.id], b = region.bounds;
        const sourceX = Math.floor((x - start.x) / (board.width * scale) * 240 + b.x + b.width / 2);
        const sourceY = Math.floor((y - start.y) / (board.height * scale) * 360 + b.y + b.height / 2);
        if (sourceX >= 0 && sourceY >= 0 && sourceX < 240 && sourceY < 360 && picture.labels[sourceY * 240 + sourceX] === region.id) hits.push(region.id);
      }
      if (hits.length) { covered++; for (const id of hits) all[id]++; visible[hits[hits.length - 1]]++; if (hits.length > 1) overlap++; }
    }
    assert.ok(overlap / covered < .06, `${width}: overlap ${overlap / covered}`);
    assert.ok(visible.every((pixels, id) => pixels / all[id] > .75), `${width}: visible fraction`);
  }
});

test('magnet accepts only points inside the configured radius', () => {
  assert.equal(isNear({ x: 0, y: 0 }, { x: 3, y: 4 }, 5), true);
  assert.equal(isNear({ x: 0, y: 0 }, { x: 3, y: 4 }, 4.9), false);
});
