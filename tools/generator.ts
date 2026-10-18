import { createRegions, inspectRegions, qualityProblems } from '../src/geometry';

const fileInput = document.querySelector<HTMLInputElement>('#source')!;
const generateButton = document.querySelector<HTMLButtonElement>('#generate')!;
const status = document.querySelector<HTMLDivElement>('#status')!;
const preview = document.querySelector<HTMLImageElement>('#preview')!;
const downloads = document.querySelector<HTMLDivElement>('#downloads')!;

fileInput.addEventListener('change', () => { generateButton.disabled = !fileInput.files?.length; });
generateButton.addEventListener('click', async () => {
  const file = fileInput.files?.[0]; if (!file) return;
  generateButton.disabled = true; status.textContent = 'Создаю маски…'; downloads.replaceChildren();
  try {
    const image = new Image(); image.src = URL.createObjectURL(file); await image.decode();
    const cols = Number((document.querySelector<HTMLInputElement>('#cols')!).value);
    const rows = Number((document.querySelector<HTMLInputElement>('#rows')!).value);
    const seed = Number((document.querySelector<HTMLInputElement>('#seed')!).value);
    if (!Number.isInteger(cols * rows) || cols < 1 || rows < 1 || cols > 6 || rows > 8 || !Number.isFinite(seed)) throw new Error('Проверьте столбцы, строки и seed.');
    const source = document.createElement('canvas'); source.width = image.naturalWidth; source.height = image.naturalHeight;
    const sctx = source.getContext('2d', { willReadFrequently: true })!; sctx.drawImage(image, 0, 0);
    const data = sctx.getImageData(0, 0, source.width, source.height);
    const { labels, regions } = createRegions(source.width, source.height, cols, rows, seed);
    const quality = inspectRegions(source.width, source.height, labels, regions);
    const problems = qualityProblems(quality);
    if (cols === 2 && rows === 4 && problems.length) throw new Error(`Форма требует доработки: ${problems.join('; ')}`);
    const atlasHeight = Math.max(...regions.map(r => r.bounds.height));
    const atlasWidth = regions.reduce((sum, r) => sum + r.bounds.width, 0);
    const atlas = document.createElement('canvas'); atlas.width = atlasWidth; atlas.height = atlasHeight;
    const actx = atlas.getContext('2d')!; const frames: Array<Record<string, unknown>> = [];
    let offsetX = 0;
    for (const region of regions) {
      const { x, y, width, height } = region.bounds;
      const piece = document.createElement('canvas'); piece.width = width; piece.height = height;
      const pctx = piece.getContext('2d')!, pieceData = pctx.createImageData(width, height);
      for (let py = 0; py < height; py++) for (let px = 0; px < width; px++) {
        const sourceIndex = ((y + py) * source.width + x + px) * 4;
        if (labels[(y + py) * source.width + x + px] === region.id) {
          const targetIndex = (py * width + px) * 4;
          pieceData.data[targetIndex] = data.data[sourceIndex]; pieceData.data[targetIndex + 1] = data.data[sourceIndex + 1];
          pieceData.data[targetIndex + 2] = data.data[sourceIndex + 2]; pieceData.data[targetIndex + 3] = data.data[sourceIndex + 3];
        }
      }
      pctx.putImageData(pieceData, 0, 0); actx.drawImage(piece, offsetX, 0);
      frames.push({ id: region.id, atlas: { x: offsetX, y: 0, width, height }, sourceBounds: region.bounds, targetCenter: region.center, pixels: region.pixels });
      offsetX += width;
    }
    const png = await new Promise<Blob>((resolve, reject) => atlas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Не удалось создать PNG.')), 'image/png'));
    const authored = cols === 2 && rows === 4;
    const json = { version: 2, source: file.name, width: source.width, height: source.height, columns: cols, rows, seed: authored ? null : seed, algorithm: authored ? 'authored staggered organic mosaic' : 'experimental smooth warped Voronoi', totalPixels: labels.length, coveredPixels: regions.reduce((sum, region) => sum + region.pixels, 0), minAreaRatio: Math.min(...regions.map(region => region.pixels / labels.length)), quality: quality.map(({ signature, ...metrics }) => metrics), qualityProblems: problems, frames };
    addDownload('Фрагменты PNG', URL.createObjectURL(png), `${stripExtension(file.name)}-pieces.png`);
    addDownload('Координаты JSON', URL.createObjectURL(new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' })), `${stripExtension(file.name)}-pieces.json`);
    preview.src = URL.createObjectURL(png); preview.hidden = false;
    status.textContent = `${regions.length} частей. Покрытие: ${json.coveredPixels}/${json.totalPixels} пикселей. Минимальная площадь фрагмента: ${(json.minAreaRatio * 100).toFixed(1)}%. Проверки формы: ${problems.length ? problems.join('; ') : 'пройдены'}.`;
    URL.revokeObjectURL(image.src);
  } catch (error) { status.textContent = error instanceof Error ? error.message : 'Ошибка генерации.'; }
  finally { generateButton.disabled = false; }
});

function addDownload(label: string, href: string, name: string) {
  const link = document.createElement('a'); link.href = href; link.download = name; link.textContent = label; downloads.append(link);
}
function stripExtension(name: string) { return name.replace(/\.[^.]+$/, ''); }
