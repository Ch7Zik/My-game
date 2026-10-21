import { seeded, type Point } from './geometry.ts';
import type { Rect } from './layout';

export interface LoosePieceSize { id: number; home: Point; width: number; height: number }
export interface ScatterQuality { minDistance: number; meanDistance: number; totalOverlap: number; maxOverlap: number }

function gridSize(count: number): { columns: number; rows: number } {
  if (count === 12) return { columns: 3, rows: 4 };
  if (count === 16) return { columns: 4, rows: 4 };
  if (count === 20) return { columns: 4, rows: 5 };
  throw new Error(`Unsupported puzzle size: ${count}`);
}

export function scatterPosition(board: Rect, relative: Point, width: number, height: number): Point {
  return {
    x: Math.max(board.x + width / 2 + 2, Math.min(board.x + board.width - width / 2 - 2, board.x + relative.x * board.width)),
    y: Math.max(board.y + height / 2 + 2, Math.min(board.y + board.height - height / 2 - 2, board.y + relative.y * board.height)),
  };
}

export function assessScatter(pieces: readonly LoosePieceSize[], board: Rect, positions: readonly Point[]): ScatterQuality {
  const rects = pieces.map((piece, index) => {
    const point = scatterPosition(board, positions[index], piece.width, piece.height);
    return { x: point.x - piece.width / 2, y: point.y - piece.height / 2, width: piece.width, height: piece.height,
      distance: Math.hypot(point.x - piece.home.x, point.y - piece.home.y) / board.width };
  });
  let totalOverlap = 0, maxOverlap = 0;
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
    const a = rects[i], b = rects[j];
    const overlap = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
      * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
    const ratio = overlap / Math.min(a.width * a.height, b.width * b.height);
    totalOverlap += ratio; maxOverlap = Math.max(maxOverlap, ratio);
  }
  return { minDistance: Math.min(...rects.map(rect => rect.distance)),
    meanDistance: rects.reduce((sum, rect) => sum + rect.distance, 0) / rects.length,
    totalOverlap, maxOverlap };
}

// Search complete permutations of compact resting slots. Scoring uses actual
// piece bounds and the snap distance, so small screens stay playable too.
export function scatterPieces(pieces: readonly LoosePieceSize[], board: Rect, seed: number): Point[] {
  const { columns, rows } = gridSize(pieces.length), random = seeded(seed);
  const slots = Array.from({ length: pieces.length }, (_, index) => ({
    x: (index % columns + .5 + (random() - .5) * .3) / columns,
    y: (Math.floor(index / columns) + .5 + (random() - .5) * .3) / rows,
  }));
  const order = slots.map((_, index) => index);
  let best: Point[] = [], bestScore = -Infinity;
  for (let attempt = 0; attempt < 5000; attempt++) {
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    const positions = order.map(index => slots[index]);
    const q = assessScatter(pieces, board, positions);
    const score = q.minDistance * 8 + q.meanDistance * 3 - q.totalOverlap * 8 - q.maxOverlap * 12
      - Math.max(0, .44 - q.minDistance) * 250;
    if (score > bestScore) { bestScore = score; best = positions; }
  }
  return best;
}
