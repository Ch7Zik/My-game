import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const port = 4198;
const base = `http://127.0.0.1:${port}/`;
const output = 'docs/screenshots/final-release-audit';
const sizes = [[320, 568], [375, 667], [390, 844], [430, 932], [1366, 768], [1920, 1080]];
mkdirSync(output, { recursive: true });

async function point(page, shape) {
  return page.evaluate(({ x, y }) => {
    const scene = window.__mysticGame.scene.getScene('puzzle');
    const rect = document.querySelector('#game canvas').getBoundingClientRect();
    return { x: rect.left + x * rect.width / scene.viewWidth(),
      y: rect.top + y * rect.height / scene.viewHeight() };
  }, shape);
}
async function tap(page, mobile, name) {
  const shape = await page.evaluate(name => {
    const r = window.__mysticGame.scene.getScene('puzzle')[name]();
    return { x: r.centerX ?? r.x, y: r.centerY ?? r.y };
  }, name);
  const p = await point(page, shape);
  if (mobile) await page.touchscreen.tap(p.x, p.y);
  else await page.mouse.click(p.x, p.y);
}
async function shot(page, size, name) {
  await page.screenshot({ path: `${output}/${name}-${size}.jpg`, type: 'jpeg', quality: 86 });
}
async function mode(page, value) {
  await page.waitForFunction(value => window.__mysticGame?.scene?.getScene('puzzle')?.mode === value, value);
}
async function run(browser, width, height) {
  const size = `${width}x${height}`, mobile = width < 900;
  const context = await browser.newContext({ viewport: { width, height }, isMobile: mobile, hasTouch: mobile });
  const completed = width === 320 ? [] : Array.from({ length: 22 }, (_, i) => i + 1);
  if (completed.length) await context.addInitScript(completed => localStorage.setItem('mystic-puzzles-v1',
    JSON.stringify({ version: 1, completed, currentLevel: 23 })), completed);
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
  try {
    await page.goto(base);
    await page.waitForFunction(() => window.__mysticGame?.scene?.getScene('puzzle')?.menuArt?.active);
    const canvas = await page.locator('#game canvas').boundingBox();
    assert.ok(Math.abs(canvas.x + canvas.width / 2 - width / 2) < 2, `${size} centered`);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${size} overflow`);
    await shot(page, size, 'menu');
    await tap(page, mobile, 'settingsButton');
    await shot(page, size, 'settings');
    const before = await page.evaluate(() => window.__mysticGame.scene.getScene('puzzle').audio.settings.music);
    await tap(page, mobile, 'musicButton');
    assert.equal(await page.evaluate(() => window.__mysticGame.scene.getScene('puzzle').audio.settings.music), !before);
    await tap(page, mobile, 'musicButton');
    await tap(page, mobile, 'effectsButton');
    assert.equal(await page.evaluate(() => window.__mysticGame.scene.getScene('puzzle').audio.settings.effects), false);
    await page.reload();
    await page.waitForFunction(() => window.__mysticGame?.scene?.getScene('puzzle')?.menuArt?.active);
    assert.equal(await page.evaluate(() => window.__mysticGame.scene.getScene('puzzle').audio.settings.effects), false);
    await tap(page, mobile, 'settingsButton');
    await tap(page, mobile, 'effectsButton');
    await tap(page, mobile, 'settingsButton');
    await tap(page, mobile, 'levelsButton'); await mode(page, 'levels');
    await shot(page, size, 'levels');
    // Verify the fifth chapter can be reached by normal wheel or touch scrolling.
    if (!mobile) await page.mouse.wheel(0, 8000);
    else {
      const cdp = await context.newCDPSession(page);
      for (let i = 0; i < 8; i++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: width / 2, y: height * .8, id: 1 }] });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: width / 2, y: height * .18, id: 1 }] });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      }
    }
    await page.waitForTimeout(150);
    await shot(page, size, 'levels-last-chapter');
    assert.equal(await page.evaluate(() => window.__mysticGame.scene.getScene('puzzle').mode), 'levels');
    await tap(page, mobile, 'backButton'); await mode(page, 'menu');
    await tap(page, mobile, 'menuButton'); await mode(page, 'game');
    await page.waitForFunction(() => window.__mysticGame.scene.getScene('puzzle').pieces.length > 0);
    const level = await page.evaluate(() => window.__mysticGame.scene.getScene('puzzle').level.id);
    assert.equal(level, completed.length ? 23 : 1);
    await shot(page, size, 'puzzle');
    if (width === 375) {
      const pickup = await page.evaluate(() => {
        const scene = window.__mysticGame.scene.getScene('puzzle');
        const piece = scene.pieces[0];
        const higher = scene.pieces.filter(other => other !== piece && other.sprite.depth > piece.sprite.depth);
        for (let y = piece.sprite.y - piece.sprite.displayHeight / 2 + 4; y < piece.sprite.y + piece.sprite.displayHeight / 2 - 4; y += 7)
          for (let x = piece.sprite.x - piece.sprite.displayWidth / 2 + 4; x < piece.sprite.x + piece.sprite.displayWidth / 2 - 4; x += 7)
            if (scene.pieceContains(piece, x, y) && !higher.some(other => scene.pieceContains(other, x, y)))
              return { x, y };
        throw new Error('No exposed area on piece 0');
      });
      const start = await point(page, pickup);
      const cdp = await context.newCDPSession(page);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...start, id: 1 }] });
      assert.equal(await page.evaluate(() => window.__mysticGame.scene.getScene('puzzle').dragging?.id), 0);
      assert.equal(await page.evaluate(() => window.__mysticGame.scene.getScene('puzzle').dragging?.sprite.tintTopLeft), 0xffe2ac);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: start.x + 18, y: start.y, id: 1 }] });
      await shot(page, size, 'held');
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      assert.equal(await page.evaluate(() => window.__mysticGame.scene.getScene('puzzle').pieces[0].placed), false);
      assert.equal(await page.evaluate(() => window.__mysticGame.scene.getScene('puzzle').dragging), null);
    }
    await tap(page, mobile, 'hintButton');
    assert.ok(await page.evaluate(() => window.__mysticGame.scene.getScene('puzzle').hintPiece !== null));
    await shot(page, size, 'hint');
    await tap(page, mobile, 'backButton'); await mode(page, 'levels');
    await tap(page, mobile, 'backButton'); await mode(page, 'menu');
    await tap(page, mobile, 'galleryButton'); await mode(page, 'gallery');
    await shot(page, size, 'gallery');
    if (completed.length) {
      const r = await page.evaluate(() => { const r = window.__mysticGame.scene.getScene('puzzle').cardRects()[0];
        return { x: r.centerX, y: r.centerY }; });
      const p = await point(page, r);
      if (mobile) await page.touchscreen.tap(p.x, p.y); else await page.mouse.click(p.x, p.y);
      await mode(page, 'view');
      await page.waitForFunction(() => window.__mysticGame.scene.getScene('puzzle').textures.exists('full-art-1'));
      await shot(page, size, 'picture-view');
      await tap(page, mobile, 'backButton'); await mode(page, 'gallery');
    }
    assert.deepEqual(errors, [], `${size} JS/HTTP errors`);
    return { size, level, completed: completed.length, errors };
  } finally { await context.close(); }
}

const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { stdio: 'ignore' });
try {
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(base)).ok) break; } catch { /* Wait for Vite. */ }
    await new Promise(resolve => setTimeout(resolve, 200));
    if (i === 99) throw Error('Vite did not start');
  }
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
  const browser = await chromium.launch({ executablePath, headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader'] });
  try { for (const [w, h] of sizes) console.log(JSON.stringify(await run(browser, w, h))); }
  finally { await browser.close(); }
} finally { server.kill(); }
