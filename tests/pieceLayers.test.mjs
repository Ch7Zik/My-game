import test from 'node:test';
import assert from 'node:assert/strict';
import { LEVELS } from '../src/levels.ts';
import { pieceDepth } from '../src/pieceLayers.ts';

test('placed, free and active pieces retain distinct depths on every level', () => {
  for (const level of LEVELS) {
    for (let id = 0; id < level.pieces; id++) {
      const placed = pieceDepth(id, true);
      const free = pieceDepth(id, false);
      const active = pieceDepth(id, false, true);
      assert.ok(placed < free && free < active, `level ${level.id}, piece ${id}`);
      for (let other = 0; other < level.pieces; other++)
        assert.ok(placed < pieceDepth(other, false) && active > pieceDepth(other, false));
    }
  }
});
