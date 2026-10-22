import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const port = Number(process.env.COLLECTION_PORT || 4187);
const base = `http://127.0.0.1:${port}/`;
const allSizes = [[375, 667], [390, 844], [1920, 1080]];
const maxLevel = Number(process.env.COLLECTION_MAX_LEVEL || 5);
const firstLevel = Number(process.env.COLLECTION_FIRST_LEVEL || 1);
const output = maxLevel > 5 ? 'docs/screenshots/levels-06-10' : 'docs/screenshots/levels-01-05';
const counts = [10, 11, 12, 12, 12, 14, 14, 15, 15, 15];
const titles = ['Эликсир забвения', 'Колодец забытых имён', 'Часовня забытых', 'Зеркало ворона',
  'Винтовая башня', 'Хранитель библиотеки', 'Печать крови', 'Туманный сад',
  'Песочные часы вечности', 'Ледяная часовня'];
assert.ok(Number.isInteger(maxLevel) && Number.isInteger(firstLevel) && firstLevel >= 1 && firstLevel <= maxLevel && maxLevel <= 10);
const sizes = process.env.COLLECTION_SIZES ? allSizes.filter(([w, h]) =>
  process.env.COLLECTION_SIZES.split(',').includes(`${w}x${h}`)) : allSizes;
assert.ok(sizes.length);
mkdirSync(output, { recursive: true });

async function ready() {
  for (let attempt = 0; attempt < 100; attempt++) {
    try { if ((await fetch(base)).ok) return; } catch { /* Starting. */ }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error('Vite did not start');
}

async function screenPoint(page, { x, y }) {
  return page.evaluate(point => {
    const scene = window.__mysticGame.scene.getScene('puzzle');
    const frame = document.querySelector('#game canvas').getBoundingClientRect();
    return { x: frame.left + point.x * frame.width / scene.viewWidth(),
      y: frame.top + point.y * frame.height / scene.viewHeight() };
  }, { x, y });
}

async function clickControl(page, name, mobile) {
  const point = await page.evaluate(control => {
    const shape = window.__mysticGame.scene.getScene('puzzle')[control]();
    return { x: shape.centerX ?? shape.x, y: shape.centerY ?? shape.y };
  }, name);
  const screen = await screenPoint(page, point);
  if (mobile) await page.touchscreen.tap(screen.x, screen.y);
  else await page.mouse.click(screen.x, screen.y);
}

async function pickup(page, id) {
  return page.evaluate(pieceId => {
    const scene = window.__mysticGame.scene.getScene('puzzle');
    const piece = scene.pieces.find(p => p.id === pieceId);
    const sprite = piece.sprite;
    const higher = scene.pieces.filter(p => p !== piece && !p.placed && p.sprite.depth > sprite.depth);
    let start = null, closest = Infinity;
    for (let y = sprite.y - sprite.displayHeight / 2 + 4; y < sprite.y + sprite.displayHeight / 2 - 4; y += 8)
      for (let x = sprite.x - sprite.displayWidth / 2 + 4; x < sprite.x + sprite.displayWidth / 2 - 4; x += 8) {
        if (!scene.pieceContains(piece, x, y) || higher.some(p => scene.pieceContains(p, x, y))) continue;
        const distance = (x - sprite.x) ** 2 + (y - sprite.y) ** 2;
        if (distance < closest) { closest = distance; start = { x, y }; }
      }
    if (!start) throw new Error(`Piece ${pieceId} has no exposed pickup area`);
    return { start, target: { x: start.x + piece.home.x - sprite.x, y: start.y + piece.home.y - sprite.y } };
  }, id);
}

async function drag(page, cdp, id) {
  const points = await pickup(page, id);
  const start = await screenPoint(page, points.start), target = await screenPoint(page, points.target);
  if (cdp) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...start, id: 1 }] });
    for (let step = 1; step <= 12; step++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{
        x: start.x + (target.x - start.x) * step / 12,
        y: start.y + (target.y - start.y) * step / 12, id: 1,
      }] });
      await page.waitForTimeout(16);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(target.x, target.y, { steps: 12 });
    await page.mouse.up();
  }
  await page.waitForFunction(pieceId => window.__mysticGame.scene.getScene('puzzle').pieces
    .find(p => p.id === pieceId)?.placed, id, { timeout: 10000 });
  await page.waitForTimeout(310);
}

async function capture(page, name) {
  await page.screenshot({ path: `${output}/${name}.jpg`, type: 'jpeg', quality: 84, scale: 'css', timeout: 120000 });
}

async function runSize(browser, width, height) {
  const mobile = width < 900, context = await browser.newContext({ viewport: { width, height }, isMobile: mobile, hasTouch: mobile });
  if (firstLevel > 1) await context.addInitScript(completed => {
    if (!localStorage.getItem('mystic-puzzles-v1')) localStorage.setItem('mystic-puzzles-v1',
      JSON.stringify({ version: 1, completed, currentLevel: completed.length + 1 }));
  },
  Array.from({ length: firstLevel - 1 }, (_, i) => i + 1));
  const page = await context.newPage(), errors = [], fullRequests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => {
    if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
    if (/level-(?:0[1-9]|10)\.webp$/.test(new URL(response.url()).pathname)) fullRequests.push(response.url());
  });
  try {
    await page.goto(base);
    await page.waitForFunction(() => window.__mysticGame?.scene?.getScene('puzzle')?.menuArt?.active);
    assert.equal(fullRequests.length, 0, 'full-size art loaded on menu');
    const canvas = await page.locator('#game canvas').boundingBox();
    assert.ok(Math.abs(canvas.x + canvas.width / 2 - width / 2) < 2);
    assert.ok(Math.abs(canvas.width / canvas.height - 9 / 16) < .003 || mobile);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await clickControl(page, 'menuButton', mobile);
    const cdp = mobile ? await context.newCDPSession(page) : null;
    for (let level = firstLevel; level <= maxLevel; level++) {
      console.log(`Checking ${width}x${height} level ${level}`);
      await page.waitForFunction(({ level, count }) => { const scene = window.__mysticGame.scene.getScene('puzzle');
        return scene.mode === 'game' && scene.level.id === level && scene.pieces.length === count;
      }, { level, count: counts[level - 1] });
      const state = await page.evaluate(() => { const s = window.__mysticGame.scene.getScene('puzzle');
        return { art: s.level.art, title: s.level.title, count: s.pieces.length,
          loaded: s.art.complete && s.art.naturalWidth > 0 }; });
      assert.equal(state.art, `/assets/level-${String(level).padStart(2, '0')}.webp`);
      assert.equal(state.title, titles[level - 1]);
      assert.ok(state.loaded);
      await capture(page, `level-${String(level).padStart(2, '0')}-start-${width}x${height}`);
      for (let id = counts[level - 1] - 1; id >= 0; id--) {
        console.log(`  piece ${id}`);
        await drag(page, cdp, id);
      }
      await page.waitForFunction(() => window.__mysticGame.scene.getScene('puzzle').mode === 'complete');
      await page.waitForTimeout(1000);
      const victory = await page.evaluate(() => { const s = window.__mysticGame.scene.getScene('puzzle');
        return { completed: s.progress.completed, result: s.results[s.level.id], image: s.completeImage?.texture.key }; });
      assert.deepEqual(victory.completed, Array.from({ length: level }, (_, i) => i + 1));
      assert.ok(victory.result?.stars >= 1 && victory.image === 'whole-picture');
      await capture(page, `level-${String(level).padStart(2, '0')}-complete-${width}x${height}`);
      if (level < maxLevel) await clickControl(page, 'nextButton', mobile);
    }
    assert.equal(fullRequests.length, maxLevel - firstLevel + 1, 'each played full-size art should load only when needed');
    await clickControl(page, 'nextButton', mobile);
    if (maxLevel < 10) await page.waitForFunction(next => { const s = window.__mysticGame.scene.getScene('puzzle');
      return s.mode === 'game' && s.level.id === next; }, maxLevel + 1);
    else {
      await page.waitForFunction(() => window.__mysticGame.scene.getScene('puzzle').mode === 'gallery');
      for (let row = 0; row < 4; row++) await page.mouse.wheel(0, 600);
      await page.waitForFunction(() => window.__mysticGame.scene.getScene('puzzle').galleryScrollRow >= 3);
      await capture(page, `gallery-completed-${width}x${height}`);
      const lastCard = await page.evaluate(() => { const r = window.__mysticGame.scene.getScene('puzzle').cardRects()[9];
        return { x: r.centerX, y: r.centerY }; });
      const lastPoint = await screenPoint(page, lastCard);
      if (mobile) await page.touchscreen.tap(lastPoint.x, lastPoint.y);
      else await page.mouse.click(lastPoint.x, lastPoint.y);
      await page.waitForFunction(() => { const s = window.__mysticGame.scene.getScene('puzzle');
        return s.mode === 'view' && s.viewedLevel === 10 && s.textures.exists('full-art-10'); });
      await capture(page, `gallery-level-10-${width}x${height}`);
    }
    await page.reload();
    await page.waitForFunction(() => window.__mysticGame?.scene?.getScene('puzzle')?.menuArt?.active);
    assert.deepEqual(await page.evaluate(() => window.__mysticGame.scene.getScene('puzzle').progress.completed),
      Array.from({ length: maxLevel }, (_, i) => i + 1));
    assert.ok(await page.evaluate(id => window.__mysticGame.scene.getScene('puzzle').progress.completed.includes(id), maxLevel));
    await clickControl(page, 'galleryButton', mobile);
    await page.waitForFunction(() => window.__mysticGame.scene.getScene('puzzle').mode === 'gallery');
    const firstCard = await page.evaluate(() => { const r = window.__mysticGame.scene.getScene('puzzle').cardRects()[0];
      return { x: r.centerX, y: r.centerY }; });
    const cardPoint = await screenPoint(page, firstCard);
    if (mobile) await page.touchscreen.tap(cardPoint.x, cardPoint.y);
    else await page.mouse.click(cardPoint.x, cardPoint.y);
    await page.waitForFunction(() => { const s = window.__mysticGame.scene.getScene('puzzle');
      return s.mode === 'view' && s.viewedLevel === 1 && s.textures.exists('full-art-1'); });
    assert.ok(await page.evaluate(() => window.__mysticGame.scene.getScene('puzzle').uiImages
      .some(image => image.texture.key === 'full-art-1')));
    await capture(page, `gallery-level-01-${width}x${height}`);
    await clickControl(page, 'backButton', mobile);
    await clickControl(page, 'backButton', mobile);
    await clickControl(page, 'menuButton', mobile);
    await page.waitForFunction(next => { const s = window.__mysticGame.scene.getScene('puzzle');
      return s.mode === 'game' && s.level.id === next; }, maxLevel === 10 ? 1 : maxLevel + 1);
    assert.deepEqual(await page.evaluate(() => window.__mysticGame.scene.getScene('puzzle').progress.completed),
      Array.from({ length: maxLevel }, (_, i) => i + 1));
    assert.deepEqual(errors, []);
    return { size: `${width}x${height}`, levels: counts.slice(firstLevel - 1, maxLevel), fullRequests: fullRequests.length, errors };
  } finally { await context.close(); }
}

const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { stdio: 'ignore' });
try {
  await ready();
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
  const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader'] });
  try {
    const report = [];
    for (const [width, height] of sizes) report.push(await runSize(browser, width, height));
    console.log(JSON.stringify(report, null, 2));
  }
  finally { await browser.close(); }
} finally { server.kill(); }
