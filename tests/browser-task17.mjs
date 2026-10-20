import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const port = 4197;
const base = `http://127.0.0.1:${port}/`;
const output = process.env.TASK17_SHOTS_DIR;
const baseline = process.env.TASK17_BASELINE === '1';
const allSizes = [[360, 640], [375, 667], [390, 844], [393, 852], [430, 932], [1920, 1080]];
const sizes = allSizes.filter(([w, h]) => (baseline ? w === 390 || w === 1920 : true)
  && (!process.env.TASK17_SIZES || process.env.TASK17_SIZES.split(',').includes(`${w}x${h}`)));

async function waitForServer() {
  for (let n = 0; n < 100; n++) {
    try { if ((await fetch(base)).ok) return; } catch { /* Vite is starting. */ }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error('Vite did not start');
}

async function tap(page, mobile, x, y) {
  if (mobile) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
}

async function button(page, method) {
  return page.evaluate(name => {
    const b = window.__mysticGame.scene.getScene('puzzle')[name]();
    return { x: b.centerX ?? b.x, y: b.centerY ?? b.y };
  }, method);
}

async function dragCoordinates(page, id) {
  return page.evaluate(pieceId => {
    const scene = window.__mysticGame.scene.getScene('puzzle');
    const piece = scene.pieces.find(item => item.id === pieceId);
    const sprite = piece.sprite;
    const higher = scene.pieces.filter(item => item !== piece && !item.placed && item.sprite.depth > sprite.depth);
    let start = null, closest = Infinity;
    for (let y = sprite.y - sprite.displayHeight / 2 + 5; y < sprite.y + sprite.displayHeight / 2 - 5; y += 4) {
      for (let x = sprite.x - sprite.displayWidth / 2 + 5; x < sprite.x + sprite.displayWidth / 2 - 5; x += 4) {
        if (!scene.pieceContains(piece, x, y) || higher.some(item => scene.pieceContains(item, x, y))) continue;
        const distance = (x - sprite.x) ** 2 + (y - sprite.y) ** 2;
        if (distance < closest) { closest = distance; start = { x, y }; }
      }
    }
    if (!start) throw new Error(`No visible point for piece ${pieceId}`);
    return { start, target: { x: start.x + piece.home.x - sprite.x, y: start.y + piece.home.y - sprite.y } };
  }, id);
}

async function drag(page, cdp, start, target) {
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
}

async function run(browser, width, height) {
  const mobile = width < 900, suffix = `${width}x${height}`;
  const context = await browser.newContext({ viewport: { width, height }, isMobile: mobile, hasTouch: mobile,
    deviceScaleFactor: width === 390 ? 2 : 1 });
  await context.addInitScript(() => {
    if (localStorage.getItem('mystic-puzzles-v1')) return;
    localStorage.setItem('mystic-puzzles-v1', JSON.stringify({ version: 1, completed: [1, 2, 3, 4, 5], currentLevel: 5 }));
    localStorage.setItem('mystic-puzzles-results-v1', JSON.stringify({
      1: { bestMs: 55000, stars: 3 }, 2: { bestMs: 145000, stars: 2 },
      3: { bestMs: 340000, stars: 1 }, 4: { bestMs: 110000, stars: 3 },
      5: { bestMs: 350000, stars: 2 },
    }));
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('response', r => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
  const shot = async scene => { if (output) await page.screenshot({ path: `${output}/${scene}-${suffix}.jpg`, type: 'jpeg', quality: 88, scale: 'css', timeout: 90000 }); };
  try {
    await page.goto(base);
    await page.waitForFunction(() => window.__mysticGame?.scene?.getScene('puzzle')?.menuArt?.active);
    await shot('menu');
    const levels = await button(page, 'levelsButton');
    await tap(page, mobile, levels.x, levels.y);
    await page.waitForFunction(() => window.__mysticGame.scene.getScene('puzzle').mode === 'levels');
    await shot('levels');
    const levelHeader = await page.evaluate(() => window.__mysticGame.scene.getScene('puzzle')
      .children.list.find(c => c.getData('uiText') && c.text === 'Выбор уровня')?.getBounds());
    assert.ok(levelHeader && Math.abs(levelHeader.x + levelHeader.width / 2 - width / 2) < 1);
    await tap(page, mobile, ...(Object.values(await button(page, 'backButton'))));
    const gallery = await button(page, 'galleryButton');
    await tap(page, mobile, gallery.x, gallery.y);
    await page.waitForFunction(() => window.__mysticGame.scene.getScene('puzzle').mode === 'gallery');
    await shot('gallery');
    const galleryHeader = await page.evaluate(() => window.__mysticGame.scene.getScene('puzzle')
      .children.list.find(c => c.getData('uiText') && c.text === 'Галерея картин')?.getBounds());
    assert.ok(galleryHeader && Math.abs(galleryHeader.x + galleryHeader.width / 2 - width / 2) < 1);
    const first = await page.evaluate(() => { const r = window.__mysticGame.scene.getScene('puzzle').cardRects()[0]; return { x: r.centerX, y: r.centerY }; });
    await tap(page, mobile, first.x, first.y);
    await page.waitForFunction(() => window.__mysticGame.scene.getScene('puzzle').mode === 'view');
    await shot('view');
    const close = await button(page, 'galleryCloseButton');
    await tap(page, mobile, close.x, close.y);
    await page.waitForFunction(() => window.__mysticGame.scene.getScene('puzzle').mode === 'gallery');
    const back = await button(page, 'backButton');
    await tap(page, mobile, back.x, back.y);
    await tap(page, mobile, levels.x, levels.y);
    await page.waitForFunction(() => window.__mysticGame.scene.getScene('puzzle').mode === 'levels');
    const fifth = await page.evaluate(() => { const r = window.__mysticGame.scene.getScene('puzzle').cardRects()[4]; return { x: r.centerX, y: r.centerY }; });
    await tap(page, mobile, fifth.x, fifth.y);
    await page.waitForFunction(() => window.__mysticGame.scene.getScene('puzzle').mode === 'game' && window.__mysticGame.scene.getScene('puzzle').pieces.length === 8);
    await page.waitForFunction(() => [...document.fonts]
      .some(face => face.family === 'MysticLevelSerif' && face.status === 'loaded'));
    await shot('game');
    const gameMetrics = await page.evaluate(() => { const s = window.__mysticGame.scene.getScene('puzzle'); return {
      board: s.board, labels: s.children.list.filter(c => c.getData('uiText')).map(c => ({ text: c.text, bounds: c.getBounds() })),
      scrollWidth: document.documentElement.scrollWidth,
    }; });
    assert.equal(gameMetrics.scrollWidth, width);
    assert.ok(gameMetrics.board.width >= (mobile ? width * .8 : 500));
    if (width === 390) {
      for (const id of [1, 2, 8, 10, 11, 19, 25]) {
        const tag = await page.evaluate(levelId => {
          const s = window.__mysticGame.scene.getScene('puzzle');
          s.level = { ...s.level, id: levelId }; s.draw();
          const items = s.children.list.filter(c => c.getData('uiText'));
          const label = items.find(c => c.text === `УРОВЕНЬ ${levelId}`);
          return { count: items.filter(c => c.text.startsWith('УРОВЕНЬ')).length,
            text: label?.text, bounds: label?.getBounds(), fontFamily: label?.style.fontFamily };
        }, id);
        if (!baseline) {
          assert.equal(tag.count, 1);
          assert.equal(tag.text, `УРОВЕНЬ ${id}`);
          assert.match(tag.fontFamily, /^MysticLevelSerif/);
          assert.ok(tag.bounds.x >= 0 && tag.bounds.x + tag.bounds.width <= width);
        }
        if (output && (id === 1 || id === 25)) await page.screenshot({
          path: `${output}/detail-level-${String(id).padStart(2, '0')}-source.jpg`,
          type: 'jpeg', quality: 90, scale: 'css', timeout: 90000,
        });
      }
      await page.evaluate(() => { const s = window.__mysticGame.scene.getScene('puzzle'); s.level = { ...s.level, id: 5 }; s.draw(); });
    }
    const gameBack = await button(page, 'backButton');
    await tap(page, mobile, gameBack.x, gameBack.y);
    await page.waitForFunction(() => window.__mysticGame.scene.getScene('puzzle').mode === 'levels');
    const levelOne = await page.evaluate(() => { const r = window.__mysticGame.scene.getScene('puzzle').cardRects()[0]; return { x: r.centerX, y: r.centerY }; });
    await tap(page, mobile, levelOne.x, levelOne.y);
    await page.waitForFunction(() => window.__mysticGame.scene.getScene('puzzle').mode === 'game' && window.__mysticGame.scene.getScene('puzzle').pieces.length === 4);
    const cdp = mobile ? await context.newCDPSession(page) : null;
    const ids = await page.evaluate(() => window.__mysticGame.scene.getScene('puzzle').pieces.map(p => p.id).sort((a, b) => b - a));
    for (const id of ids) {
      const { start, target } = await dragCoordinates(page, id);
      await drag(page, cdp, start, target);
      await page.waitForFunction(pieceId => window.__mysticGame.scene.getScene('puzzle').pieces.find(p => p.id === pieceId).placed, id);
      if (id !== ids.at(-1)) await page.waitForTimeout(310);
    }
    await page.waitForFunction(() => window.__mysticGame.scene.getScene('puzzle').mode === 'complete');
    await page.waitForTimeout(750);
    await shot('victory');
    const victory = await page.evaluate(() => { const s = window.__mysticGame.scene.getScene('puzzle'); return {
      layout: s.victoryScreenLayout(), button: s.nextButton(), stars: s.results[1]?.stars, time: s.completedMs,
      labels: s.children.list.filter(c => c.getData('uiText')).map(c => ({ text: c.text, bounds: c.getBounds() })),
      scrollWidth: document.documentElement.scrollWidth,
    }; });
    assert.ok(victory.time > 0 && victory.stars >= 1 && victory.stars <= 3);
    assert.equal(victory.scrollWidth, width);
    const next = victory.button;
    await tap(page, mobile, next.x + next.width / 2, next.y + next.height / 2);
    await page.waitForFunction(() => { const s = window.__mysticGame.scene.getScene('puzzle'); return s.mode === 'game' && s.level.id === 2; });
    if (width === 390) {
      await page.evaluate(() => { document.documentElement.style.setProperty('--safe-top', '47px'); document.documentElement.style.setProperty('--safe-bottom', '34px'); });
      await page.setViewportSize({ width: 375, height: 667 });
      await page.waitForFunction(() => window.__mysticGame.scene.getScene('puzzle').viewWidth() === 375);
      const resizedBack = await button(page, 'backButton');
      await page.touchscreen.tap(resizedBack.x, resizedBack.y);
      await page.waitForFunction(() => window.__mysticGame.scene.getScene('puzzle').mode === 'levels');
    }
    await page.reload();
    await page.waitForFunction(() => window.__mysticGame?.scene?.getScene('puzzle')?.menuArt?.active);
    const saved = await page.evaluate(() => window.__mysticGame.scene.getScene('puzzle').results[1]);
    assert.ok(saved?.bestMs > 0 && saved?.stars >= 1);
    assert.deepEqual(errors, []);
    return { size: suffix, board: gameMetrics.board, victory: { time: victory.time, stars: victory.stars }, errors };
  } finally { await context.close(); }
}

const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { stdio: 'ignore' });
try {
  await waitForServer();
  const executablePath = existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined;
  const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader'] });
  try {
    if (output) mkdirSync(output, { recursive: true });
    const report = [];
    for (const [w, h] of sizes) report.push(await run(browser, w, h));
    if (output) {
      const path = `${output}/browser-results.json`;
      const earlier = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : [];
      const merged = [...earlier.filter(item => !report.some(next => next.size === item.size)), ...report];
      writeFileSync(path, JSON.stringify(merged, null, 2));
    }
    console.log(JSON.stringify(report, null, 2));
  } finally { await browser.close(); }
} finally { server.kill(); }
