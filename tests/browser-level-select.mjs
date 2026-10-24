import assert from 'node:assert/strict';
import { mkdirSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const port = 4187, base = `http://127.0.0.1:${port}/`;
const screenshots = 'docs/screenshots/level-select-redesign';
mkdirSync(screenshots, { recursive: true });
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { stdio: 'ignore' });
async function ready() {
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(base)).ok) return; } catch { /* Vite starting. */ }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error('Vite did not start');
}
async function point(page, x, y) {
  return page.evaluate(({ x, y }) => {
    const scene = window.__mysticGame.scene.getScene('puzzle');
    const canvas = document.querySelector('#game canvas').getBoundingClientRect();
    return { x: canvas.left + x * canvas.width / scene.viewWidth(),
      y: canvas.top + y * canvas.height / scene.viewHeight() };
  }, { x, y });
}
async function control(page, name) {
  const center = await page.evaluate(name => {
    const r = window.__mysticGame.scene.getScene('puzzle')[name]();
    return { x: r.centerX ?? r.x, y: r.centerY ?? r.y };
  }, name);
  const p = await point(page, center.x, center.y);
  await page.mouse.click(p.x, p.y);
}
async function card(page, index) {
  const center = await page.evaluate(index => {
    const r = window.__mysticGame.scene.getScene('puzzle').cardRects()[index];
    return { x: r.centerX, y: r.centerY };
  }, index);
  return point(page, center.x, center.y);
}
async function tap(page, x, y) {
  if (page.viewportSize().width < 500) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
}
async function enterLevels(page) {
  await control(page, 'levelsButton');
  await page.waitForFunction(() => window.__mysticGame.scene.getScene('puzzle').mode === 'levels');
}
async function scrollTo(page, index) {
  const delta = await page.evaluate(index => {
    const scene = window.__mysticGame.scene.getScene('puzzle'), r = scene.cardRects()[index], g = scene.levelGridLayout();
    return r.y - g.top - 42;
  }, index);
  const viewport = page.viewportSize();
  await page.mouse.move(viewport.width / 2, viewport.height / 2);
  await page.mouse.wheel(0, delta);
  await page.waitForTimeout(180);
  const visible = await page.evaluate(index => {
    const scene = window.__mysticGame.scene.getScene('puzzle'), r = scene.cardRects()[index], g = scene.levelGridLayout();
    return r.y >= g.top - 1 && r.bottom <= g.bottom + 1;
  }, index);
  assert.ok(visible, `level ${index + 1} should be visible`);
}
async function runCase(browser, width, height, completed) {
  const context = await browser.newContext({ viewport: { width, height }, isMobile: width < 500, hasTouch: width < 500 });
  if (completed.length) await context.addInitScript(completed => {
    localStorage.setItem('mystic-puzzles-v1', JSON.stringify({ version: 1, completed, currentLevel: completed.length + 1 }));
    localStorage.setItem('mystic-puzzles-results-v1', JSON.stringify(Object.fromEntries(completed.map(id => [id, { bestMs: 60000, stars: 3 }]))));
  }, completed);
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
  try {
    await page.goto(base);
    await page.waitForFunction(() => window.__mysticGame?.scene?.getScene('puzzle')?.menuArt?.active);
    await enterLevels(page);
    const initial = await page.evaluate(() => {
      const s = window.__mysticGame.scene.getScene('puzzle');
      return { chapters: s.levelGridLayout().chapters.length, cards: s.cardRects().length,
        progress: s.children.list.filter(c => c.getData('uiText')).map(c => c.text),
        shownArt: s.levelLayer.list.filter(c => c.texture?.key?.startsWith('art-')).length,
        canvas: document.querySelector('#game canvas').getBoundingClientRect().toJSON(),
        scrollWidth: document.documentElement.scrollWidth };
    });
    assert.equal(initial.chapters, 5);
    assert.equal(initial.cards, 25);
    assert.equal(initial.shownArt, Math.min(25, completed.length + 1));
    assert.ok(initial.progress.includes(`Пройдено ${completed.length} из 25`));
    assert.equal(initial.scrollWidth, width);
    assert.ok(initial.canvas.width <= Math.min(width, height * 9 / 16) + 2);
    if (width === 375) await page.screenshot({ path: `${screenshots}/top-375x667.png` });
    if (width === 375) {
      const safe = await page.evaluate(() => {
        document.documentElement.style.setProperty('--safe-top', '44px');
        document.documentElement.style.setProperty('--safe-bottom', '34px');
        const scene = window.__mysticGame.scene.getScene('puzzle'); scene.draw();
        return { backTop: scene.backButton().top, bottom: scene.levelGridLayout().bottom };
      });
      assert.ok(safe.backTop >= 44 && safe.bottom <= height - 34);
      await page.evaluate(() => {
        document.documentElement.style.setProperty('--safe-top', '0px');
        document.documentElement.style.setProperty('--safe-bottom', '0px');
        window.__mysticGame.scene.getScene('puzzle').draw();
      });
    }
    if (width === 320) await page.screenshot({ path: `${screenshots}/top-320x568.png` });
    if (width === 1920) await page.screenshot({ path: `${screenshots}/desktop-1920x1080.png` });
    if (width === 1366) await page.screenshot({ path: `${screenshots}/desktop-1366x768.png` });
    if (width === 390) {
      const c = await point(page, initial.canvas.width / 2, height * .7);
      const cdp = await context.newCDPSession(page);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: c.x, y: c.y, id: 1 }] });
      for (let step = 1; step <= 10; step++)
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove',
          touchPoints: [{ x: c.x, y: c.y - step * 22, id: 1 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      assert.equal(await page.evaluate(() => window.__mysticGame.scene.getScene('puzzle').mode), 'levels');
      assert.ok(await page.evaluate(() => window.__mysticGame.scene.getScene('puzzle').levelScrollY > 100));
      await scrollTo(page, 10);
      await page.screenshot({ path: `${screenshots}/middle-390x844.png` });
    }
    if (width === 430) {
      await scrollTo(page, 24);
      await page.screenshot({ path: `${screenshots}/chapter-v-430x932.png` });
    }
    if (!completed.length) {
      await scrollTo(page, 1);
      const locked = await card(page, 1);
      await tap(page, locked.x, locked.y);
      assert.equal(await page.evaluate(() => window.__mysticGame.scene.getScene('puzzle').mode), 'levels');
      await scrollTo(page, 0);
      const available = await card(page, 0);
      await tap(page, available.x, available.y);
      await page.waitForFunction(() => window.__mysticGame.scene.getScene('puzzle').mode === 'game');
      assert.equal(await page.evaluate(() => window.__mysticGame.scene.getScene('puzzle').level.id), 1);
      await control(page, 'backButton');
      assert.equal(await page.evaluate(() => window.__mysticGame.scene.getScene('puzzle').mode), 'levels');
    }
    if (completed.length === 8) {
      const before = await page.evaluate(() => localStorage.getItem('mystic-puzzles-v1'));
      await scrollTo(page, 0);
      const replay = await card(page, 0);
      await page.mouse.click(replay.x, replay.y);
      await page.waitForFunction(() => window.__mysticGame.scene.getScene('puzzle').mode === 'game');
      assert.equal(await page.evaluate(() => window.__mysticGame.scene.getScene('puzzle').level.id), 1);
      await control(page, 'backButton');
      assert.deepEqual(JSON.parse(await page.evaluate(() => localStorage.getItem('mystic-puzzles-v1'))).completed,
        JSON.parse(before).completed);
      await page.reload();
      await page.waitForFunction(() => window.__mysticGame?.scene?.getScene('puzzle')?.menuArt?.active);
      await enterLevels(page);
      assert.ok(await page.evaluate(() => window.__mysticGame.scene.getScene('puzzle').progress.completed.length === 8));
      await scrollTo(page, 8);
      const current = await card(page, 8);
      await page.mouse.click(current.x, current.y);
      await page.waitForFunction(() => window.__mysticGame.scene.getScene('puzzle').mode === 'game');
      assert.equal(await page.evaluate(() => window.__mysticGame.scene.getScene('puzzle').level.id), 9);
    }
    assert.deepEqual(errors, []);
    return `${width}×${height} (${completed.length} complete)`;
  } finally { await context.close(); }
}
try {
  await ready();
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
  const browser = await chromium.launch({ executablePath, headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader'] });
  try {
    const report = [];
    for (const [width, height, done] of [[320, 568, 0], [375, 667, 0], [390, 844, 8],
      [430, 932, 25], [1366, 768, 8], [1920, 1080, 8]]) {
      report.push(await runCase(browser, width, height, Array.from({ length: done }, (_, i) => i + 1)));
    }
    console.log(`Level selection verified: ${report.join(', ')}`);
  } finally { await browser.close(); }
} finally { server.kill(); }
