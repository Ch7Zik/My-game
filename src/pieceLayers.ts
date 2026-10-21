// The board guide sits at depth 1 and the completed picture at depth 60.
// Keep all puzzle pieces between them, with a stable order among free pieces.
export function pieceDepth(id: number, placed: boolean, active = false): number {
  if (placed) return 10;
  if (active) return 50;
  return 20 + id / 100;
}
