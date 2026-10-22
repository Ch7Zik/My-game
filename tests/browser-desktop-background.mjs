import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const port = 4184;
const base = `http://127.0.0.1:${port}/`;
const output = 'docs/screenshots/desktop-cave-background';
const sizes = [[375, 667], [390, 844], [932, 430], [1366, 768], [1920, 1080]];
mkdirSync(output, { recursive: true });

async function ready() {
  for (let attempt = 0; attempt < 100; attempt++) {
    try { if ((await fetch(base)).ok) return; } catch { /* Vite is starting. */ }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error('Background test server did not start');
}

async function clickControl(page, name, touch) {
  const point = await page.evaluate(control => {
    const scene = window.__mysticGame.scene.getScene('puzzle');
    const shape = scene[control]();
    const canvas = document.querySelector('#game canvas').getBoundingClientRect();
    return { x: canvas.left + (shape.centerX ?? shape.x) * canvas.width / scene.viewWidth(),
      y: canvas.top + (shape.centerY ?? shape.y) * canvas.height / scene.viewHeight() };
  }, name);
  if (touch) await page.touchscreen.tap(point.x, point.y);
  else await page.mouse.click(point.x, point.y);
}

async function runSize(browser, width, height) {
  const touch = width < 900 || height < 600;
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch });
  const page = await context.newPage();
  const errors = [];
  const backgroundRequests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => {
    if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
    if (response.url().includes('desktop-cave.webp')) backgroundRequests.push(response.url());
  });
  try {
    await page.goto(base);
    await page.waitForFunction(() => window.__mysticGame?.scene?.getScene('puzzle')?.menuArt?.active);
    if (!touch) await page.waitForFunction(() => performance.getEntriesByType('resource')
      .some(resource => resource.name.includes('desktop-cave.webp')));
    const layout = await page.evaluate(() => {
      const canvas = document.querySelector('#game canvas').getBoundingClientRect();
      const body = getComputedStyle(document.body);
      return { canvas: { x: canvas.x, y: canvas.y, width: canvas.width, height: canvas.height },
        scrollWidth: document.documentElement.scrollWidth,
        background: body.backgroundImage, size: body.backgroundSize };
    });
    assert.ok(layout.scrollWidth <= width, `${width}x${height}: horizontal scroll`);
    assert.ok(Math.abs(layout.canvas.x + layout.canvas.width / 2 - width / 2) <= 2, `${width}x${height}: canvas center`);
    assert.ok(Math.abs(layout.canvas.height - height) <= 2, `${width}x${height}: canvas height`);
    assert.equal(layout.background.includes('desktop-cave.webp'), !touch);
    if (touch) assert.equal(backgroundRequests.length, 0, `${width}x${height}: desktop asset loaded on phone`);
    else {
      assert.equal(layout.size, 'cover, cover');
      assert.ok(Math.abs(layout.canvas.width / layout.canvas.height - 9 / 16) < .002);
      assert.ok(backgroundRequests.length > 0);
    }
    if (height < 600) return { size: `${width}x${height}`, backgroundRequests: backgroundRequests.length, canvas: layout.canvas };
    await page.screenshot({ path: `${output}/menu-${width}x${height}.png` });
    assert.ok(await page.evaluate(() => window.__mysticGame.scene.getScene('puzzle').children.list
      .some(child => child.getData('uiText') && child.text === 'Играть')));
    await clickControl(page, 'settingsButton', touch);
    assert.ok(await page.evaluate(() => window.__mysticGame.scene.getScene('puzzle').soundPanelOpen));
    await clickControl(page, 'musicButton', touch);
    await clickControl(page, 'effectsButton', touch);
    assert.deepEqual(await page.evaluate(() => window.__mysticGame.scene.getScene('puzzle').audio.settings),
      { music: false, effects: false });
    await clickControl(page, 'settingsButton', touch);
    await clickControl(page, 'levelsButton', touch);
    await page.waitForFunction(() => window.__mysticGame.scene.getScene('puzzle').mode === 'levels');
    if (!touch) await page.screenshot({ path: `${output}/levels-${width}x${height}.png` });
    await clickControl(page, 'backButton', touch);
    await clickControl(page, 'galleryButton', touch);
    await page.waitForFunction(() => window.__mysticGame.scene.getScene('puzzle').mode === 'gallery');
    if (!touch) await page.screenshot({ path: `${output}/gallery-${width}x${height}.png` });
    await clickControl(page, 'backButton', touch);
    await clickControl(page, 'menuButton', touch);
    await page.waitForFunction(() => window.__mysticGame.scene.getScene('puzzle').pieces.length === 10);
    if (!touch) await page.screenshot({ path: `${output}/game-${width}x${height}.png` });
    assert.deepEqual(errors, []);
    return { size: `${width}x${height}`, backgroundRequests: backgroundRequests.length, canvas: layout.canvas };
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
  } finally { await browser.close(); }
} finally { server.kill(); }
