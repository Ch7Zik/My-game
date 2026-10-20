import type { Point } from './geometry';

export interface Rect { x: number; y: number; width: number; height: number }
// Curated scattered composition. Slots correspond to the eight authored masks;
// uneven gaps and heights avoid the two-column or near-solved appearance.
export const SLOT_ORDER = [0, 1, 2, 3, 4, 5, 6, 7];
export const SLOT_POINTS = [
  [.722, .147], [.162, .153], [.857, .404], [.262, .788],
  [.772, .844], [.498, .281], [.183, .455], [.601, .596],
  // Twelve separate resting places for the experimental level. Its pieces
  // retain the same board and finger scale as the existing levels.
  [.18, .13], [.50, .14], [.82, .13],
  [.18, .38], [.50, .38], [.82, .38],
  [.18, .62], [.50, .62], [.82, .62],
  [.18, .87], [.50, .86], [.82, .87],
];
export function looseScale(viewportWidth: number, viewportHeight: number): number {
  return viewportHeight < 700 ? .66 : viewportWidth < 700 ? .70 : .78;
}
export function gameLayout(w: number, h: number): { board: Rect; preview: Rect | null } {
  const desktop = w >= 1000 && w / h > 1.3;
  const top = desktop ? 84 : h < 700 ? 62 : 60;
  const foot = desktop ? 86 : 42;
  const boardWidth = Math.max(190, Math.min(desktop ? 590 : w - (h < 700 ? 8 : 4), (h - top - foot) * 2 / 3));
  const boardHeight = boardWidth * 1.5;
  const y = top + Math.max(0, (h - top - foot - boardHeight) * (desktop ? .5 : .14));
  if (desktop) {
    const previewWidth = Math.min(390, Math.max(260, w * .225));
    const gap = Math.min(92, Math.max(45, w * .045));
    const groupWidth = boardWidth + gap + previewWidth;
    const board = { x: (w - groupWidth) / 2, y, width: boardWidth, height: boardHeight };
    return { board, preview: { x: board.x + boardWidth + gap, y: y + Math.max(30, (boardHeight - previewWidth * 1.5) / 2), width: previewWidth, height: previewWidth * 1.5 } };
  }
  return { board: { x: (w - boardWidth) / 2, y, width: boardWidth, height: boardHeight }, preview: null };
}
export function startPosition(board: Rect, viewportWidth: number, slot: number, pieceWidth: number, pieceHeight: number): Point {
  const [sx, sy] = SLOT_POINTS[slot];
  const margin = 4;
  return {
    x: Math.max(margin + pieceWidth / 2, Math.min(viewportWidth - margin - pieceWidth / 2, board.x + sx * board.width)),
    y: Math.max(board.y + pieceHeight / 2 + 2, Math.min(board.y + board.height - pieceHeight / 2 - 2, board.y + sy * board.height)),
  };
}
