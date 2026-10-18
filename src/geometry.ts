export interface Point { x: number; y: number }
export interface PieceRegion { id: number; center: Point; pixels: number; bounds: { x: number; y: number; width: number; height: number } }
export interface RegionQuality { id: number; areaRatio: number; aspect: number; localWidth: number; localHeight: number; thinRows: number; sharpTurns: number; signature: number[] }

// A hand tuned 2 x 4 cutting pattern. Every border is shared by its neighbours.
// Broad curves form lobes without the noisy teeth of perturbed Voronoi cells.
function seamX(v: number): number {
  return .5 + .078 * Math.sin(Math.PI * 2.7 * v + .42) + .032 * Math.sin(Math.PI * 5.1 * v + 1.65);
}
function seamY(u: number, line: number): number {
  const offsets = [0, .247, .502, .752, 1];
  if (line === 0 || line === 4) return offsets[line];
  const amplitude = [.038, .045, .037][line - 1];
  const phase = [.35, 1.8, 3.65][line - 1];
  return offsets[line] + amplitude * Math.sin(Math.PI * 2.2 * u + phase)
    + .018 * Math.sin(Math.PI * 4.1 * u + phase * 1.7);
}

export function createRegions(width: number, height: number, cols = 2, rows = 4, seed = 713): { labels: Uint8Array; regions: PieceRegion[] } {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 8 || height < 8 || !Number.isInteger(cols * rows) || cols < 1 || rows < 1 || cols * rows > 254) throw new Error('Invalid puzzle dimensions');
  const count = cols * rows;
  const labels = new Uint8Array(width * height);
  const sums = Array.from({ length: count }, () => ({ x: 0, y: 0, n: 0, minX: width, minY: height, maxX: 0, maxY: 0 }));
  const sites = Array.from({ length: count }, (_, i) => ({ x: ((i % cols) + .5) / cols, y: (Math.floor(i / cols) + .5) / rows }));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const u = (x + .5) / width, v = (y + .5) / height;
    let id: number;
    if (cols === 2 && rows === 4) {
      const side = u < seamX(v) ? 0 : 1;
      let row = 0;
      while (row < 3 && v >= seamY(u, row + 1)) row++;
      id = row * 2 + side;
    } else {
      // Smooth domain warp for experimental sizes; the first level uses the authored pattern above.
      const warpX = u + .035 * Math.sin(v * Math.PI * 3 + seed * .01);
      const warpY = v + .028 * Math.sin(u * Math.PI * 3.5 + seed * .013);
      id = 0; let best = Infinity;
      for (let i = 0; i < count; i++) {
        const dx = (warpX - sites[i].x) * cols, dy = (warpY - sites[i].y) * rows;
        const d = dx * dx + dy * dy;
        if (d < best) { best = d; id = i; }
      }
    }
    labels[y * width + x] = id;
    const s = sums[id]; s.x += x; s.y += y; s.n++;
    if (x < s.minX) s.minX = x; if (x > s.maxX) s.maxX = x;
    if (y < s.minY) s.minY = y; if (y > s.maxY) s.maxY = y;
  }
  return { labels, regions: sums.map((s, id) => ({ id, center: { x: s.x / s.n, y: s.y / s.n }, pixels: s.n, bounds: { x: s.minX, y: s.minY, width: s.maxX - s.minX + 1, height: s.maxY - s.minY + 1 } })) };
}

// The metrics are based on actual raster masks, not only bounding boxes.
export function inspectRegions(width: number, height: number, labels: Uint8Array, regions: PieceRegion[]): RegionQuality[] {
  return regions.map(region => {
    const b = region.bounds, rowWidths: number[] = [], colHeights: number[] = [];
    let thinRows = 0;
    for (let y = b.y; y < b.y + b.height; y++) {
      let first = width, last = -1;
      for (let x = b.x; x < b.x + b.width; x++) if (labels[y * width + x] === region.id) { if (x < first) first = x; last = x; }
      if (last >= 0) rowWidths.push(last - first + 1);
    }
    for (let x = b.x; x < b.x + b.width; x++) {
      let first = height, last = -1;
      for (let y = b.y; y < b.y + b.height; y++) if (labels[y * width + x] === region.id) { if (y < first) first = y; last = y; }
      if (last >= 0) colHeights.push(last - first + 1);
    }
    const sortedRows = [...rowWidths].sort((a, b) => a - b), sortedCols = [...colHeights].sort((a, b) => a - b);
    const localWidth = sortedRows[Math.floor(sortedRows.length * .22)] / width;
    const localHeight = sortedCols[Math.floor(sortedCols.length * .22)] / height;
    const threshold = width * .085;
    for (let i = Math.floor(rowWidths.length * .22); i < rowWidths.length * .78; i++) if (rowWidths[i] < threshold) thinRows++;
    // Radial occupancy signature distinguishes the eight silhouettes after normalization.
    const signature: number[] = [];
    for (let gy = 0; gy < 7; gy++) for (let gx = 0; gx < 7; gx++) {
      const px = Math.min(width - 1, Math.floor(b.x + (gx + .5) / 7 * b.width));
      const py = Math.min(height - 1, Math.floor(b.y + (gy + .5) / 7 * b.height));
      signature.push(labels[py * width + px] === region.id ? 1 : 0);
    }
    // Turn angle of the authored seams at a useful visual scale, excluding raster stair steps.
    let sharpTurns = 0;
    if (regions.length === 8) {
      const samples = 48;
      for (let i = 2; i < samples - 2; i++) {
        const t = i / samples, d = 2 / samples;
        for (const curve of [seamX, (v: number) => seamY(v, Math.floor(region.id / 2) + 1)]) {
          const a = curve(t - d), m = curve(t), c = curve(t + d);
          const angle = Math.atan2(c - m, d) - Math.atan2(m - a, d);
          if (Math.abs(angle) > .55) sharpTurns++;
        }
      }
    }
    return { id: region.id, areaRatio: region.pixels / labels.length, aspect: (b.width / width) / (b.height / height), localWidth, localHeight, thinRows, sharpTurns, signature };
  });
}

export function qualityProblems(quality: RegionQuality[]): string[] {
  const problems: string[] = [];
  for (const q of quality) {
    if (q.areaRatio < .065) problems.push(`Piece ${q.id}: area too small`);
    if (q.aspect < .44 || q.aspect > 2.7) problems.push(`Piece ${q.id}: too elongated`);
    if (q.localWidth < .085 || q.localHeight < .075 || q.thinRows > 7) problems.push(`Piece ${q.id}: narrow section`);
    if (q.sharpTurns > 0) problems.push(`Piece ${q.id}: sharp bend`);
  }
  for (let i = 0; i < quality.length; i++) for (let j = i + 1; j < quality.length; j++) {
    const difference = quality[i].signature.reduce((n, bit, k) => n + (bit === quality[j].signature[k] ? 0 : 1), 0);
    if (difference < 3) problems.push(`Pieces ${i} and ${j}: similar silhouettes`);
  }
  return problems;
}

export function isNear(a: Point, b: Point, radius: number): boolean { return Math.hypot(a.x - b.x, a.y - b.y) <= radius; }
export function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 0x100000000; };
}
