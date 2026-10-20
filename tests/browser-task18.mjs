import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const port = 4208;
const base = `http://127.0.0.1:${port}/`;
const output = process.env.TASK18_OUTPUT;
const baseline = process.env.TASK18_BASELINE === '1';
const sizes = [[375, 667], [390, 844], [393, 852], [430, 932]];
const ids = [1, 2, 8, 10, 11, 19, 25];

async function waitForServer() {
  for (let n = 0; n < 100; n++) {
    try { if ((await fetch(base)).ok) return; } catch { /* Vite is starting. */ }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error('Vite did not start');
}

async function run(browser, width, height) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2,
    isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
  try {
    await page.goto(base);
    await page.waitForFunction(() => window.__mysticGame?.scene?.getScene('puzzle')?.menuArt?.active);
    const levels = await page.evaluate(() => {
      const r = window.__mysticGame.scene.getScene('puzzle').levelsButton();
      return { x: r.centerX, y: r.centerY };
    });
    await page.touchscreen.tap(levels.x, levels.y);
    await page.waitForFunction(() => window.__mysticGame.scene.getScene('puzzle').mode === 'levels');
    const first = await page.evaluate(() => {
      const r = window.__mysticGame.scene.getScene('puzzle').cardRects()[0];
      return { x: r.centerX, y: r.centerY };
    });
    await page.touchscreen.tap(first.x, first.y);
    await page.waitForFunction(() => {
      const s = window.__mysticGame.scene.getScene('puzzle');
      return s.mode === 'game' && s.pieces.length === 4;
    });
    if (!baseline) await page.waitForFunction(() => [...document.fonts]
      .some(face => face.family === 'MysticLevelSerif' && face.status === 'loaded'));
    const board = await page.evaluate(() => window.__mysticGame.scene.getScene('puzzle').board);
    const measurements = [];
    for (const id of ids) {
      const tag = await page.evaluate(({ levelId, baseline }) => {
        const scene = window.__mysticGame.scene.getScene('puzzle');
        scene.level = { ...scene.level, id: levelId }; scene.draw();
        const text = scene.children.list.find(c => c.getData('uiText') && c.text.startsWith('УРОВЕНЬ'));
        const ctx = document.createElement('canvas').getContext('2d');
        ctx.font = `${text.style.fontStyle} ${text.style.fontSize} ${text.style.fontFamily}`;
        const bounds = text.getBounds();
        const wordWidth = ctx.measureText('УРОВЕНЬ').width;
        const prefixWidth = ctx.measureText('УРОВЕНЬ ').width;
        const number = baseline ? String(levelId).padStart(2, '0') : String(levelId);
        return { text: text.text, fontFamily: text.style.fontFamily, left: bounds.x, wordWidth, prefixWidth,
          numberWidth: ctx.measureText(number).width, number, board: scene.board };
      }, { levelId: id, baseline });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const screenshot = await page.screenshot({ type: 'png', scale: 'device', timeout: 90000 });
      if (output && id === 1) writeFileSync(`${output}/game-${width}x${height}.png`, screenshot);
      const result = await page.evaluate(async ({ encoded, geometry }) => {
        const image = new Image(); image.src = `data:image/png;base64,${encoded}`;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.width; canvas.height = image.height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(image, 0, 0);
        const { data } = ctx.getImageData(0, 0, image.width, image.height);
        const inkBox = (left, right) => {
          let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1, count = 0;
          for (let y = 6 * 2; y < 29 * 2; y++) {
            for (let x = Math.max(0, Math.floor(left * 2)); x < Math.min(image.width, Math.ceil(right * 2)); x++) {
              const at = (y * image.width + x) * 4;
              const red = data[at], green = data[at + 1], blue = data[at + 2];
              if (red > 150 && green > 95 && red > blue + 34 && green > blue + 13) {
                minX = Math.min(minX, x); minY = Math.min(minY, y);
                maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); count++;
              }
            }
          }
          if (!count) throw new Error('No gold glyph pixels in header');
          return { left: minX / 2, right: (maxX + 1) / 2, top: minY / 2,
            bottom: (maxY + 1) / 2, count };
        };
        const word = inkBox(geometry.left - 1, geometry.left + geometry.wordWidth + .5);
        const number = inkBox(geometry.left + geometry.prefixWidth - .5,
          geometry.left + geometry.prefixWidth + geometry.numberWidth + 1);
        const crop = document.createElement('canvas');
        crop.width = 330; crop.height = 68;
        crop.getContext('2d').drawImage(image, 120, 0, 330, 68, 0, 0, 330, 68);
        return { word, number, topDelta: number.top - word.top,
          bottomDelta: number.bottom - word.bottom, crop: crop.toDataURL('image/png').split(',')[1] };
      }, { encoded: screenshot.toString('base64'), geometry: tag });
      if (output && (width === 390 || id === 1) && [1, 10, 25].includes(id)) {
        writeFileSync(`${output}/tag-${id}-${width}x${height}.png`, Buffer.from(result.crop, 'base64'));
      }
      const { crop, ...metrics } = result;
      measurements.push({ id, text: tag.text, ...metrics });
      if (!baseline) {
        assert.equal(tag.text, `УРОВЕНЬ ${id}`);
        assert.match(tag.fontFamily, /^MysticLevelSerif/);
        assert.ok(Math.abs(metrics.topDelta) <= .5 && Math.abs(metrics.bottomDelta) <= .5,
          `${width}x${height} level ${id}: visible ink edges differ by ${metrics.topDelta}/${metrics.bottomDelta}px`);
      }
    }
    assert.deepEqual(errors, []);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
    return { size: `${width}x${height}`, board, measurements, errors };
  } finally { await context.close(); }
}

const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { stdio: 'ignore' });
let browser;
try {
  await waitForServer();
  browser = await chromium.launch({ executablePath: existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined,
    headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader'] });
  if (output) mkdirSync(output, { recursive: true });
  const report = [];
  for (const [width, height] of sizes) report.push(await run(browser, width, height));
  if (output) writeFileSync(`${output}/measurements.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report.map(({ size, measurements }) => ({ size,
    deltas: measurements.map(({ id, topDelta, bottomDelta }) => ({ id, topDelta, bottomDelta })) })), null, 2));
} finally { await browser?.close(); server.kill(); }
