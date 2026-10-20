import type { Rect } from './layout';

// Keep the centre of every decorative stroke inside the canvas. The puzzle
// image and every piece retain their original rectangle and coordinates.
export function strokeFrameRect(picture: Rect, viewportWidth: number, outset: number, edgeInset: number): Rect {
  const x = Math.max(edgeInset, picture.x - outset);
  const right = Math.min(viewportWidth - edgeInset, picture.x + picture.width + outset);
  return { x, y: picture.y - outset, width: right - x, height: picture.height + outset * 2 };
}
