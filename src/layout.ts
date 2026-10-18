import type { Point } from './geometry';

export interface Rect { x: number; y: number; width: number; height: number }
export const SLOT_ORDER = [5, 2, 7, 0, 6, 1, 4, 3];
export const SLOT_POINTS = [
  [.245, .125], [.745, .124], [.275, .365], [.737, .365],
  [.239, .608], [.755, .602], [.272, .855], [.741, .853],
];
export function looseScale(viewportWidth: number, viewportHeight: number): number {
  return viewportHeight < 700 ? .70 : viewportWidth < 700 ? .75 : .82;
}
export function gameLayout(w: number, h: number): { board: Rect; preview: Rect | null } {
  const desktop = w >= 1000 && w / h > 1.3;
  const top = h < 700 ? 83 : 94;
  const foot = h < 700 ? 94 : 112;
  const boardWidth = Math.max(190, Math.min(desktop ? 590 : w - 20, (h - top - foot) * 2 / 3));
  const boardHeight = boardWidth * 1.5;
  const y = top + Math.max(0, (h - top - foot - boardHeight) * (desktop ? .5 : .30));
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
