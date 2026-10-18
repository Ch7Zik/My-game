import test from 'node:test';
import assert from 'node:assert/strict';
import { canAdvance, canDrag, isComplete, shouldSnap } from '../src/puzzleRules.ts';

test('placed fragments are locked while loose fragments remain draggable', () => {
  assert.equal(canDrag(false), true);
  assert.equal(canDrag(true), false);
});

test('a puzzle completes only after every piece is installed', () => {
  assert.equal(isComplete(Array(8).fill(false)), false);
  assert.equal(isComplete([true, true, true, true, true, true, true, false]), false);
  assert.equal(isComplete(Array(8).fill(true)), true);
});

test('completion does not advance until the next button is pressed', () => {
  assert.equal(canAdvance(false, false), false);
  assert.equal(canAdvance(true, false), false);
  assert.equal(canAdvance(true, true), true);
});

test('the magnet uses a configurable radius', () => {
  assert.equal(shouldSnap({ x: 0, y: 0 }, { x: 3, y: 4 }, 5), true);
  assert.equal(shouldSnap({ x: 0, y: 0 }, { x: 3, y: 4 }, 4.9), false);
});
