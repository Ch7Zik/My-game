export interface Point { x: number; y: number }
export interface PieceRegion { id: number; center: Point; pixels: number; bounds: { x: number; y: number; width: number; height: number } }

// Seeded, perturbed Voronoi regions create eight distinct, organic silhouettes.
export function createRegions(width: number, height: number, cols = 2, rows = 4, seed = 713): { labels: Uint8Array; regions: PieceRegion[] } {
  const count = cols * rows;
  const rand = seeded(seed);
  const sites: Point[] = [];
  for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
    sites.push({
      x: width * ((col + 0.5 + (rand() - 0.5) * 0.34) / cols),
      y: height * ((row + 0.5 + (rand() - 0.5) * 0.28) / rows),
    });
  }
  const labels = new Uint8Array(width * height);
  const sums = Array.from({ length: count }, () => ({ x: 0, y: 0, n: 0, minX: width, minY: height, maxX: 0, maxY: 0 }));
  const sx = width / 100, sy = height / 100;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let winner = 0, best = Infinity;
    for (let i = 0; i < sites.length; i++) {
      const site = sites[i];
      const dx = (x - site.x) / sx, dy = (y - site.y) / sy;
      const ripple = 2.15 * Math.sin(x * 0.17 + y * 0.071 + i * 2.4) + 1.3 * Math.sin(y * 0.23 - x * 0.09 + i * 1.7);
      const distance = dx * dx + dy * dy + ripple * Math.sqrt(dx * dx + dy * dy + 1);
      if (distance < best) { best = distance; winner = i; }
    }
    labels[y * width + x] = winner;
    const region = sums[winner]; region.x += x; region.y += y; region.n++;
    region.minX = Math.min(region.minX, x); region.minY = Math.min(region.minY, y);
    region.maxX = Math.max(region.maxX, x); region.maxY = Math.max(region.maxY, y);
  }
  return {
    labels,
    regions: sums.map((p, id) => ({ id, center: { x: p.x / p.n, y: p.y / p.n }, pixels: p.n, bounds: { x: p.minX, y: p.minY, width: p.maxX - p.minX + 1, height: p.maxY - p.minY + 1 } })),
  };
}

export function isNear(a: Point, b: Point, radius: number): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) <= radius;
}

export function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 0x100000000; };
}
