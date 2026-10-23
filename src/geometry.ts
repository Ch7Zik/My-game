export interface Point { x: number; y: number }
export interface PieceRegion { id: number; center: Point; pixels: number; bounds: { x: number; y: number; width: number; height: number } }
export interface RegionQuality { id: number; areaRatio: number; aspect: number; localWidth: number; localHeight: number; thinRows: number; sharpTurns: number; connected: boolean; signature: number[] }

// Eight authored sites make a staggered 3–2–3 mosaic. A shared smooth warp
// bends every neighbour boundary in the same way, so the masks still tessellate.
const LEVEL_ONE_SITES: Point[] = [
  { x: .18, y: .15 }, { x: .77, y: .15 },
  { x: .12, y: .47 }, { x: .42, y: .42 }, { x: .85, y: .44 },
  { x: .27, y: .78 }, { x: .59, y: .61 }, { x: .73, y: .79 },
];
const LEVEL_ONE_WEIGHTS = [.003, .004, -.005, -.006, -.006, .006, -.018, .003];
const FOUR_SITES: Point[] = [{ x: .23, y: .23 }, { x: .77, y: .26 }, { x: .29, y: .77 }, { x: .72, y: .73 }];
const SIX_SITES: Point[] = [
  { x: .21, y: .16 }, { x: .78, y: .18 }, { x: .28, y: .48 },
  { x: .72, y: .47 }, { x: .19, y: .82 }, { x: .78, y: .81 },
];
// A staggered 3×4 mosaic for the collection's denser levels. Shared warps
// make every border curved while leaving broad, connected finger-sized masks.
const TWELVE_SITES: Point[] = [
  { x: .16, y: .11 }, { x: .49, y: .13 }, { x: .83, y: .10 },
  { x: .19, y: .37 }, { x: .52, y: .36 }, { x: .77, y: .38 },
  { x: .16, y: .63 }, { x: .48, y: .62 }, { x: .84, y: .64 },
  { x: .18, y: .88 }, { x: .52, y: .86 }, { x: .81, y: .89 },
];
// Keep the same four-row silhouette family when the first two collection
// levels need exactly 10 and 11 pieces. Removing central sites lets the
// neighbouring masks fill the space without creating tiny fragments.
const COLLECTION_SITES: Record<10 | 11, Point[]> = {
  10: TWELVE_SITES.filter((_, i) => i !== 4 && i !== 10),
  11: TWELVE_SITES.filter((_, i) => i !== 10),
};
const LOBES = [
  { id: 0, x: .28, y: .30, rx: .15, ry: .13, power: .031 },
  { id: 1, x: .48, y: .32, rx: .16, ry: .13, power: .041 },
  { id: 2, x: .73, y: .33, rx: .15, ry: .12, power: .035 },
  { id: 3, x: .49, y: .46, rx: .15, ry: .15, power: .046 },
  { id: 4, x: .54, y: .55, rx: .15, ry: .14, power: .040 },
  { id: 5, x: .29, y: .68, rx: .15, ry: .14, power: .037 },
  { id: 6, x: .47, y: .66, rx: .16, ry: .14, power: .038 },
  { id: 7, x: .72, y: .69, rx: .15, ry: .14, power: .039 },
];
const BENDS = [
  { x: .34, y: .22, rx: .16, ry: .14, dx: .052, dy: -.018 },
  { x: .65, y: .23, rx: .15, ry: .13, dx: -.048, dy: .020 },
  { x: .39, y: .43, rx: .17, ry: .16, dx: -.040, dy: -.043 },
  { x: .63, y: .53, rx: .18, ry: .17, dx: .047, dy: .024 },
  { x: .28, y: .68, rx: .15, ry: .15, dx: .042, dy: -.020 },
  { x: .68, y: .72, rx: .16, ry: .15, dx: -.049, dy: .027 },
];
function warp(u: number, v: number): Point {
  let x = u + .018 * Math.sin(v * Math.PI * 4.1 + .6) * Math.sin(u * Math.PI);
  let y = v + .018 * Math.sin(u * Math.PI * 4.4 + 1.1) * Math.sin(v * Math.PI);
  for (const bend of BENDS) {
    const dx = (u - bend.x) / bend.rx, dy = (v - bend.y) / bend.ry;
    const influence = Math.exp(-2 * (dx * dx + dy * dy));
    x += bend.dx * influence; y += bend.dy * influence;
  }
  return { x, y };
}

export function createRegions(width: number, height: number, cols = 2, rows = 4, seed = 713, pieces = cols * rows): { labels: Uint8Array; regions: PieceRegion[] } {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 8 || height < 8 || !Number.isInteger(pieces) || cols < 1 || rows < 1 || pieces < 1 || pieces > cols * rows || pieces > 254) throw new Error('Invalid puzzle dimensions');
  const count = pieces;
  const authored = cols === 2 && (rows === 2 || rows === 3 || rows === 4);
  const experimental = cols === 3 && rows === 4 && count >= 10 && count <= 12;
  const dense = cols === 4 && (rows === 4 || rows === 5);
  // Distribute the unused anchors through the five rows. Leaving
  // them all at the bottom would compress the preceding row into thin masks.
  const denseAnchors = count === 17 ? Array.from({ length: 20 }, (_, i) => i).filter(i => ![5, 10, 15].includes(i))
    : count === 18 ? Array.from({ length: 20 }, (_, i) => i).filter(i => ![6, 13].includes(i))
      : count === 19 ? Array.from({ length: 20 }, (_, i) => i).filter(i => i !== 10)
      : Array.from({ length: count }, (_, i) => i);
  const curatedSites = dense ? denseAnchors.map((anchor, i) => {
    const column = anchor % cols, row = Math.floor(anchor / cols);
    return { x: (column + .5 + .09 * Math.sin(i * 2.71 + seed * .01)) / cols,
      y: (row + .5 + .09 * Math.cos(i * 3.17 + seed * .007)) / rows };
  }) : experimental ? count === 12 ? TWELVE_SITES : COLLECTION_SITES[count as 10 | 11] : count === 4 ? FOUR_SITES : count === 6 ? SIX_SITES : LEVEL_ONE_SITES;
  const labels = new Uint8Array(width * height);
  const sums = Array.from({ length: count }, () => ({ x: 0, y: 0, n: 0, minX: width, minY: height, maxX: 0, maxY: 0 }));
  const sites = Array.from({ length: count }, (_, i) => ({ x: ((i % cols) + .5) / cols, y: (Math.floor(i / cols) + .5) / rows }));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const u = (x + .5) / width, v = (y + .5) / height;
    let id: number;
    if (authored || experimental || dense) {
      const p = warp(u, v);
      if (count === 4) {
        // Broad waves give the first two difficulty tiers recognisable, shared
        // organic borders while keeping every silhouette thick and connected.
        p.x += .070 * Math.sin(v * Math.PI * 2.5 + seed * .002) * Math.sin(u * Math.PI);
        p.y += .050 * Math.sin(u * Math.PI * 2.9 + seed * .001) * Math.sin(v * Math.PI);
      }
      if (experimental || dense) {
        p.x += .022 * Math.sin(v * Math.PI * 4.4 + seed * .001) * Math.sin(u * Math.PI);
        p.y += .018 * Math.sin(u * Math.PI * 5.1 + seed * .001) * Math.sin(v * Math.PI);
      }
      id = 0; let best = Infinity;
      for (let i = 0; i < curatedSites.length; i++) {
        const site = curatedSites[i];
        const dx = (p.x - site.x) * 1.02, dy = p.y - site.y;
        let score = dx * dx + dy * dy + (count === 8 ? LEVEL_ONE_WEIGHTS[i] : experimental || dense ? .0015 * Math.sin(seed * .012 + i * 2.3) : .007 * Math.sin(seed * .012 + i * 2.3));
        for (const lobe of LOBES) if (!experimental && !dense && lobe.id % count === i) {
          const lx = (u - lobe.x) / lobe.rx, ly = (v - lobe.y) / lobe.ry;
          score -= lobe.power * (count === 8 ? 1 : .75) * Math.exp(-2 * (lx * lx + ly * ly));
        }
        if (score < best) { best = score; id = i; }
      }
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
  if (authored || experimental || dense) {
    const smooth = smoothLabels(labels, width, height, count, Math.max(2, Math.round(width * (experimental || dense ? .018 : .032))));
    labels.set(smooth);
    for (const s of sums) { s.x = 0; s.y = 0; s.n = 0; s.minX = width; s.minY = height; s.maxX = 0; s.maxY = 0; }
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const s = sums[labels[y * width + x]]; s.x += x; s.y += y; s.n++;
      if (x < s.minX) s.minX = x; if (x > s.maxX) s.maxX = x;
      if (y < s.minY) s.minY = y; if (y > s.maxY) s.maxY = y;
    }
  }
  return { labels, regions: sums.map((s, id) => ({ id, center: { x: s.x / s.n, y: s.y / s.n }, pixels: s.n, bounds: { x: s.minX, y: s.minY, width: s.maxX - s.minX + 1, height: s.maxY - s.minY + 1 } })) };
}

function smoothLabels(labels: Uint8Array, width: number, height: number, count: number, radius: number): Uint8Array {
  const stride = width + 1, best = new Uint32Array(labels.length), result = labels.slice();
  for (let id = 0; id < count; id++) {
    const integral = new Uint32Array(stride * (height + 1));
    for (let y = 1; y <= height; y++) {
      let row = 0;
      for (let x = 1; x <= width; x++) {
        if (labels[(y - 1) * width + x - 1] === id) row++;
        integral[y * stride + x] = integral[(y - 1) * stride + x] + row;
      }
    }
    for (let y = 0; y < height; y++) {
      const y0 = Math.max(0, y - radius), y1 = Math.min(height, y + radius + 1);
      for (let x = 0; x < width; x++) {
        const x0 = Math.max(0, x - radius), x1 = Math.min(width, x + radius + 1);
        const sum = integral[y1 * stride + x1] - integral[y0 * stride + x1] - integral[y1 * stride + x0] + integral[y0 * stride + x0];
        const index = y * width + x;
        if (sum > best[index]) { best[index] = sum; result[index] = id; }
      }
    }
  }
  return result;
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
    // A radial contour profile detects isolated needle-like tips. Sampling at
    // several angles ignores single raster stair steps while catching spikes.
    const profile: number[] = [];
    for (let angle = 0; angle < 64; angle++) {
      const theta = angle * Math.PI * 2 / 64;
      let radius = 0;
      while (radius < 1.6) {
        const px = Math.floor(region.center.x + Math.cos(theta) * radius * b.width / 2);
        const py = Math.floor(region.center.y + Math.sin(theta) * radius * b.height / 2);
        if (px < 0 || py < 0 || px >= width || py >= height || labels[py * width + px] !== region.id) break;
        radius += .014;
      }
      profile.push(radius);
    }
    let sharpTurns = 0;
    for (let i = 0; i < profile.length; i++) {
      const left = profile[(i + 61) % 64], right = profile[(i + 3) % 64];
      const theta = i * Math.PI * 2 / 64;
      const tipX = region.center.x + Math.cos(theta) * profile[i] * b.width / 2;
      const tipY = region.center.y + Math.sin(theta) * profile[i] * b.height / 2;
      const onFrame = tipX < 6 || tipX > width - 6 || tipY < 6 || tipY > height - 6;
      if (!onFrame && profile[i] - Math.max(left, right) > .31) sharpTurns++;
    }
    const visited = new Uint8Array(labels.length);
    const queue = new Int32Array(region.pixels); let head = 0, tail = 0;
    const first = b.y * width + b.x;
    let origin = first;
    while (origin < labels.length && labels[origin] !== region.id) origin++;
    if (origin < labels.length) { queue[tail++] = origin; visited[origin] = 1; }
    while (head < tail) {
      const pos = queue[head++], px = pos % width, py = Math.floor(pos / width);
      for (const next of [px > 0 ? pos - 1 : -1, px + 1 < width ? pos + 1 : -1, py > 0 ? pos - width : -1, py + 1 < height ? pos + width : -1]) {
        if (next >= 0 && !visited[next] && labels[next] === region.id) { visited[next] = 1; queue[tail++] = next; }
      }
    }
    return { id: region.id, connected: tail === region.pixels, areaRatio: region.pixels / labels.length, aspect: (b.width / width) / (b.height / height), localWidth, localHeight, thinRows, sharpTurns, signature };
  });
}

export function qualityProblems(quality: RegionQuality[]): string[] {
  const problems: string[] = [];
  for (const q of quality) {
    if (!q.connected) problems.push(`Piece ${q.id}: disconnected`);
    if (q.areaRatio < (quality.length > 12 ? .72 / quality.length : .065)) problems.push(`Piece ${q.id}: area too small`);
    if (q.aspect < .44 || q.aspect > 2.7) problems.push(`Piece ${q.id}: too elongated`);
    if (q.localWidth < .085 || q.localHeight < .075 || q.thinRows > 7) problems.push(`Piece ${q.id}: narrow section`);
    if (q.sharpTurns > (quality.length > 12 ? 1 : 0)) problems.push(`Piece ${q.id}: sharp bend`);
  }
  for (let i = 0; i < quality.length; i++) for (let j = i + 1; j < quality.length; j++) {
    const difference = quality[i].signature.reduce((n, bit, k) => n + (bit === quality[j].signature[k] ? 0 : 1), 0);
    if (difference < (quality.length > 12 ? 2 : 3)) problems.push(`Pieces ${i} and ${j}: similar silhouettes`);
  }
  return problems;
}

export function isNear(a: Point, b: Point, radius: number): boolean { return Math.hypot(a.x - b.x, a.y - b.y) <= radius; }
export function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 0x100000000; };
}
