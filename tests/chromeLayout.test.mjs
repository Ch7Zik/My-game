import test from 'node:test';
import assert from 'node:assert/strict';
import { gameLayout } from '../src/layout.ts';
import { victoryScreenLayout } from '../src/victoryLayout.ts';
import { strokeFrameRect } from '../src/chromeLayout.ts';

test('gold frame stroke remains whole and symmetric inside every canvas', () => {
  for (const [w, h] of [[360, 640], [390, 844], [430, 932], [1920, 1080]]) {
    const board = gameLayout(w, h).board;
    const gameFrame = strokeFrameRect(board, w, 2, 1.5);
    assert.ok(gameFrame.x >= 1.5 && gameFrame.x + gameFrame.width <= w - 1.5);
    if (w < 900) assert.ok(Math.abs(gameFrame.x - (w - gameFrame.x - gameFrame.width)) < .01);
    assert.equal(gameFrame.y, board.y - 2);
    const art = victoryScreenLayout(w, h).picture;
    const victoryFrame = strokeFrameRect(art, w, 7, 2.5);
    assert.ok(victoryFrame.x >= 2.5 && victoryFrame.x + victoryFrame.width <= w - 2.5);
    if (w < 900) assert.ok(Math.abs(victoryFrame.x - (w - victoryFrame.x - victoryFrame.width)) < .01);
  }
});
