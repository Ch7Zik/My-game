import test from 'node:test';
import assert from 'node:assert/strict';
import { createRegions, inspectRegions, qualityProblems } from '../src/geometry.ts';
import { gameLayout, looseScale } from '../src/layout.ts';
import { LEVELS, levelForPlay } from '../src/levels.ts';
import { assessScatter, scatterPieces, scatterPosition } from '../src/scatter.ts';

const sizes = [[360, 640], [375, 667], [390, 844], [393, 852], [430, 932], [1920, 1080]];
const variants = [[3, 4, 10], [3, 4, 11], [3, 4, 12], [4, 4, 16], [4, 5, 20]];

test('16 and 20 pieces are selectable only in development; published level 6 stays at 12', () => {
  assert.deepEqual(LEVELS.map(level => level.pieces), [10, 11, 12, 12, 12, 12]);
  for (const count of [16, 20]) {
    assert.equal(levelForPlay(6, count, true).pieces, count);
    assert.equal(levelForPlay(6, count, false).pieces, 12);
    assert.equal(levelForPlay(5, count, true).pieces, 12);
  }
  assert.equal(levelForPlay(6, 19, true).pieces, 12);
});

test('dense organic masks remain connected, broad and complete', () => {
  for (const [columns, rows, count] of variants.slice(3)) {
    const { labels, regions } = createRegions(240, 360, columns, rows, 1526, count);
    assert.equal(regions.length, columns * rows);
    assert.equal(regions.reduce((sum, piece) => sum + piece.pixels, 0), labels.length);
    assert.deepEqual(qualityProblems(inspectRegions(240, 360, labels, regions)), []);
    assert.ok(regions.every(piece => piece.pixels > labels.length * .035));
  }
});

test('every start is far from its home, inside the board and visibly touchable', () => {
  const raster = { width: 240, height: 360 };
  for (const [columns, rows, count] of variants) {
    const { labels, regions } = createRegions(raster.width, raster.height, columns, rows, 1526, count);
    for (const [width, height] of sizes) for (const seed of [1, 1590, 98274]) {
      const { board } = gameLayout(width, height), scale = looseScale(width, height);
      const pieces = regions.map(region => ({ id: region.id,
        home: { x: board.x + (region.bounds.x + region.bounds.width / 2) / raster.width * board.width,
          y: board.y + (region.bounds.y + region.bounds.height / 2) / raster.height * board.height },
        width: (region.bounds.width + 12) / raster.width * board.width * scale,
        height: (region.bounds.height + 12) / raster.height * board.height * scale }));
      const plan = scatterPieces(pieces, board, seed);
      assert.deepEqual(plan, scatterPieces(pieces, board, seed));
      const quality = assessScatter(pieces, board, plan);
      assert.ok(quality.minDistance > .32, `${columns * rows}, ${width}×${height}: near home ${quality.minDistance}`);
      assert.ok(quality.meanDistance > .55, `${columns * rows}, ${width}×${height}: weak mixing`);
      const starts = plan.map((point, index) => {
        const piece = pieces[index];
        const start = scatterPosition(board, point, piece.width, piece.height);
        assert.ok(start.x - piece.width / 2 >= board.x && start.x + piece.width / 2 <= board.x + board.width);
        assert.ok(start.y - piece.height / 2 >= board.y && start.y + piece.height / 2 <= board.y + board.height);
        assert.ok(Math.min(piece.width, piece.height) >= 65, 'piece too small for a finger');
        return start;
      });
      const total = Array(regions.length).fill(0), visible = Array(regions.length).fill(0);
      for (let y = board.y + 2; y < board.y + board.height - 2; y += 4)
        for (let x = board.x + 2; x < board.x + board.width - 2; x += 4) {
          const hits = [];
          for (const region of regions) {
            const start = starts[region.id], bounds = region.bounds;
            const sourceX = Math.floor((x - start.x) / (board.width * scale) * raster.width + bounds.x + bounds.width / 2);
            const sourceY = Math.floor((y - start.y) / (board.height * scale) * raster.height + bounds.y + bounds.height / 2);
            if (sourceX >= 0 && sourceX < raster.width && sourceY >= 0 && sourceY < raster.height &&
                labels[sourceY * raster.width + sourceX] === region.id) hits.push(region.id);
          }
          for (const id of hits) total[id]++;
          if (hits.length) visible[hits.at(-1)]++;
        }
      assert.ok(visible.every((pixels, id) => total[id] && pixels / total[id] > (count < 12 ? .55 : .75) && pixels * 16 > 1800),
        `${count}, ${width}×${height}: hidden piece ${visible.map((n,i)=>(n/total[i]).toFixed(2)).join(',')}`);
    }
  }
});
