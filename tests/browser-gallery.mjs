import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const port = 4187;
const base = `http://127.0.0.1:${port}/`;
const baseline = process.env.GALLERY_BASELINE === '1';
const output = process.env.GALLERY_SCREENSHOT_DIR;
const sizes = baseline ? [[390, 844], [1920, 1080]] : [[360, 640], [390, 844], [430, 932], [1920, 1080]];

async function waitForServer() {
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(base)).ok) return; } catch { /* Starting. */ }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error('Vite did not start');
}

async function tap(page, mobile, x, y) {
  const point = await page.evaluate(({ x, y }) => {
    const s = window.__mysticGame.scene.getScene('puzzle');
    const canvas = document.querySelector('#game canvas').getBoundingClientRect();
    return { x: canvas.left + x * canvas.width / s.viewWidth(),
      y: canvas.top + y * canvas.height / s.viewHeight() };
  }, { x, y });
  if (mobile) await page.touchscreen.tap(point.x, point.y);
  else await page.mouse.click(point.x, point.y);
}

async function run(browser, width, height) {
  const mobile = width < 900;
  const context = await browser.newContext({ viewport: { width, height }, isMobile: mobile, hasTouch: mobile });
  await context.addInitScript(() => {
    localStorage.setItem('mystic-puzzles-v1', JSON.stringify({ version: 1, completed: [1, 2, 3, 4, 5], currentLevel: 5 }));
    localStorage.setItem('mystic-puzzles-results-v1', JSON.stringify({
      1: { bestMs: 55000, stars: 3 }, 2: { bestMs: 145000, stars: 2 },
      3: { bestMs: 340000, stars: 1 }, 4: { bestMs: 110000, stars: 3 },
      5: { bestMs: 350000, stars: 2 },
    }));
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
  try {
    await page.goto(base);
    await page.waitForFunction(() => window.__mysticGame?.scene?.getScene('puzzle')?.menuArt?.active);
    const galleryButton = await page.evaluate(() => { const b = window.__mysticGame.scene.getScene('puzzle').galleryButton(); return { x: b.centerX, y: b.centerY }; });
    await tap(page, mobile, galleryButton.x, galleryButton.y);
    await page.waitForFunction(() => window.__mysticGame.scene.getScene('puzzle').mode === 'gallery');
    if (output) {
      mkdirSync(output, { recursive: true });
      await page.screenshot({ path: `${output}/gallery-${width}x${height}.jpg`, type: 'jpeg', quality: 88, scale: 'css' });
    }
    const gallery = await page.evaluate(() => { const s = window.__mysticGame.scene.getScene('puzzle'); return {
      rects: s.cardRects().map(r => ({ x: r.x, y: r.y, width: r.width, height: r.height })),
      labels: s.children.list.filter(c => c.getData('uiText')).map(c => c.text),
      scrollWidth: document.documentElement.scrollWidth,
    }; });
    if (!baseline) {
      assert.equal(gallery.scrollWidth, width);
      if (mobile) assert.ok(Math.abs(gallery.rects[0].y - gallery.rects[1].y) < 1, 'gallery must have two columns');
      assert.ok(gallery.labels.includes('Галерея'));
      if (mobile) {
        const cdp = await context.newCDPSession(page);
        const x = width / 2, from = height * .76, to = height * .2;
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: from, id: 1 }] });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: to, id: 1 }] });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await page.waitForFunction(() => window.__mysticGame.scene.getScene('puzzle').galleryScrollRow > 0);
        assert.equal(await page.evaluate(() => window.__mysticGame.scene.getScene('puzzle').mode), 'gallery');
        const scroll = await page.evaluate(() => { const s = window.__mysticGame.scene.getScene('puzzle');
          return { row: s.galleryScrollRow, max: s.galleryGridLayout().maxScrollRow }; });
        assert.ok(scroll.row > 0 && scroll.row < scroll.max);
        if (output) await page.screenshot({ path: `${output}/gallery-scrolled-${width}x${height}.jpg`, type: 'jpeg', quality: 88, scale: 'css' });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: to, id: 1 }] });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: from, id: 1 }] });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await page.waitForFunction(() => window.__mysticGame.scene.getScene('puzzle').galleryScrollRow === 0);
      }
    }
    const card = gallery.rects[0];
    await tap(page, mobile, card.x + card.width / 2, card.y + Math.min(80, card.height / 2));
    await page.waitForFunction(() => window.__mysticGame.scene.getScene('puzzle').mode === 'view');
    if (output) await page.screenshot({ path: `${output}/view-${width}x${height}.jpg`, type: 'jpeg', quality: 88, scale: 'css' });
    const view = await page.evaluate(() => { const s = window.__mysticGame.scene.getScene('puzzle'); return {
      texts: s.children.list.filter(c => c.getData('uiText')).map(c => c.text),
      stars: s.results[1].stars, progress: s.progress.completed,
      close: s.galleryCloseButton?.(), scrollWidth: document.documentElement.scrollWidth,
    }; });
    assert.equal(view.stars, 3);
    assert.deepEqual(view.progress, [1, 2, 3, 4, 5]);
    if (!baseline) {
      assert.ok(view.texts.some(t => t.includes('00:55')));
      assert.ok(view.texts.includes('Закрыть'));
      assert.equal(view.scrollWidth, width);
      await tap(page, mobile, view.close.x + view.close.width / 2, view.close.y + view.close.height / 2);
    } else {
      const back = await page.evaluate(() => { const b = window.__mysticGame.scene.getScene('puzzle').backButton(); return { x: b.x, y: b.y }; });
      await tap(page, mobile, back.x, back.y);
    }
    await page.waitForFunction(() => window.__mysticGame.scene.getScene('puzzle').mode === 'gallery');
    if (!baseline) {
      await page.reload();
      await page.waitForFunction(() => window.__mysticGame?.scene?.getScene('puzzle')?.menuArt?.active);
      const saved = await page.evaluate(() => { const s = window.__mysticGame.scene.getScene('puzzle'); return { stars: s.results[1].stars, bestMs: s.results[1].bestMs }; });
      assert.deepEqual(saved, { stars: 3, bestMs: 55000 });
      await tap(page, mobile, galleryButton.x, galleryButton.y);
      await page.waitForFunction(() => window.__mysticGame.scene.getScene('puzzle').mode === 'gallery');
      const back = await page.evaluate(() => { const b = window.__mysticGame.scene.getScene('puzzle').backButton(); return { x: b.x, y: b.y }; });
      await tap(page, mobile, back.x, back.y);
      const levels = await page.evaluate(() => { const b = window.__mysticGame.scene.getScene('puzzle').levelsButton(); return { x: b.centerX, y: b.centerY }; });
      await tap(page, mobile, levels.x, levels.y);
      await page.waitForFunction(() => window.__mysticGame.scene.getScene('puzzle').mode === 'levels');
      if (output) await page.screenshot({ path: `${output}/levels-${width}x${height}.jpg`, type: 'jpeg', quality: 88, scale: 'css' });
      if (width === 390) {
        await page.evaluate(() => { const s = window.__mysticGame.scene.getScene('puzzle');
          s.progress = { version: 1, completed: [1, 2], currentLevel: 3 }; s.mode = 'gallery'; s.draw(); });
        const locked = await page.evaluate(() => { const s = window.__mysticGame.scene.getScene('puzzle');
          return { art: s.uiImages.map(i => i.texture?.key), r: s.cardRects()[2] }; });
        assert.ok(!locked.art.includes('art-3'), 'uncollected art must stay hidden');
        if (output) await page.screenshot({ path: `${output}/gallery-locked-${width}x${height}.jpg`, type: 'jpeg', quality: 88, scale: 'css' });
        await tap(page, mobile, locked.r.x + locked.r.width / 2, locked.r.y + locked.r.height / 2);
        assert.equal(await page.evaluate(() => window.__mysticGame.scene.getScene('puzzle').mode), 'gallery');
      }
    }
    assert.deepEqual(errors, []);
    return { size: `${width}x${height}`, gallery, view, errors };
  } finally { await context.close(); }
}

const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { stdio: 'ignore' });
try {
  await waitForServer();
  const executablePath = existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined;
  const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader'] });
  try {
    const report = [];
    for (const [w, h] of sizes) report.push(await run(browser, w, h));
    if (output) writeFileSync(`${output}/browser-results.json`, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report.map(({ size, errors }) => ({ size, errors })), null, 2));
  } finally { await browser.close(); }
} finally { server.kill(); }
