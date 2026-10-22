import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { LEVELS } from '../src/levels.ts';

const port = 4182;
const base = `http://127.0.0.1:${port}/`;
const output = 'docs/screenshots/menu-final';
const allSizes = [[360, 640], [375, 667], [390, 844], [393, 852], [430, 932],
  [1366, 768], [1920, 1080], [2560, 1440], [768, 1024], [1024, 768]];
const sizes = process.env.MENU_SIZES
  ? allSizes.filter(([width, height]) => process.env.MENU_SIZES.split(',').includes(`${width}x${height}`)) : allSizes;
assert.ok(sizes.length, 'No matching MENU_SIZES');
mkdirSync(output, { recursive: true });

async function ready() {
  for (let attempt = 0; attempt < 100; attempt++) {
    try { if ((await fetch(base)).ok) return; } catch { /* Vite is starting. */ }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error('Menu server did not start');
}

async function clickControl(page, name) {
  const point = await page.evaluate(control => {
    const scene = window.__mysticGame.scene.getScene('puzzle');
    const shape = scene[control]();
    const canvas = document.querySelector('#game canvas').getBoundingClientRect();
    return { x: canvas.left + (shape.centerX ?? shape.x) * canvas.width / scene.viewWidth(),
      y: canvas.top + (shape.centerY ?? shape.y) * canvas.height / scene.viewHeight() };
  }, name);
  await page.mouse.click(point.x, point.y);
}

async function runSize(browser, width, height) {
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
  try {
    await page.goto(base);
    await page.waitForFunction(() => window.__mysticGame?.scene?.getScene('puzzle')?.menuArt?.active);
    await page.waitForTimeout(150);
    const layout = await page.evaluate(() => {
      const scene = window.__mysticGame.scene.getScene('puzzle');
      const canvas = document.querySelector('#game canvas').getBoundingClientRect();
      const buttons = ['menuButton', 'levelsButton', 'galleryButton', 'settingsButton']
        .map(name => {
          const shape = scene[name]();
          return { name, shape: { x: shape.x, y: shape.y, radius: shape.radius ?? 0,
            right: shape.right, bottom: shape.bottom } };
        });
      return { canvas: { x: canvas.x, y: canvas.y, width: canvas.width, height: canvas.height },
        view: { width: scene.viewWidth(), height: scene.viewHeight() }, buttons,
        titleSprite: scene.uiImages.some(image => image.texture.key === 'menu-title') };
    });
    assert.equal(layout.titleSprite, true);
    assert.ok(Math.abs(layout.canvas.height - height) <= 2, `${width}x${height}: game height`);
    assert.ok(layout.canvas.width <= Math.min(width, height * 9 / 16) + 2, `${width}x${height}: portrait width`);
    assert.ok(Math.abs(layout.canvas.x + layout.canvas.width / 2 - width / 2) <= 2, `${width}x${height}: centered`);
    for (const { name, shape } of layout.buttons) {
      const r = shape.radius ?? 0;
      assert.ok(shape.x - r >= -1 && shape.y - r >= -1, `${width}x${height}: ${name} starts inside canvas`);
      assert.ok((shape.right ?? shape.x + r) <= layout.view.width + 1, `${width}x${height}: ${name} right edge`);
      assert.ok((shape.bottom ?? shape.y + r) <= layout.view.height + 1, `${width}x${height}: ${name} bottom edge`);
    }
    if ([[375, 667], [390, 844], [1920, 1080]].some(([w, h]) => w === width && h === height))
      await page.screenshot({ path: `${output}/menu-${width}x${height}.png` });
    await page.mouse.click(layout.canvas.x + (layout.view.width - 79) * layout.canvas.width / layout.view.width,
      layout.canvas.y + 29 * layout.canvas.height / layout.view.height);
    assert.equal(await page.evaluate(() => window.__mysticGame.scene.getScene('puzzle').soundPanelOpen), false);
    await clickControl(page, 'settingsButton');
    assert.equal(await page.evaluate(() => window.__mysticGame.scene.getScene('puzzle').soundPanelOpen), true);
    if (width === 390) await page.screenshot({ path: `${output}/settings-390x844.png` });
    await clickControl(page, 'musicButton');
    assert.equal(await page.evaluate(() => window.__mysticGame.scene.getScene('puzzle').audio.settings.music), false);
    await clickControl(page, 'effectsButton');
    assert.equal(await page.evaluate(() => window.__mysticGame.scene.getScene('puzzle').audio.settings.effects), false);
    await page.reload();
    await page.waitForFunction(() => window.__mysticGame?.scene?.getScene('puzzle')?.menuArt?.active);
    assert.deepEqual(await page.evaluate(() => window.__mysticGame.scene.getScene('puzzle').audio.settings),
      { music: false, effects: false });
    await clickControl(page, 'levelsButton');
    assert.equal(await page.evaluate(() => window.__mysticGame.scene.getScene('puzzle').mode), 'levels');
    await clickControl(page, 'backButton');
    await clickControl(page, 'galleryButton');
    assert.equal(await page.evaluate(() => window.__mysticGame.scene.getScene('puzzle').mode), 'gallery');
    await clickControl(page, 'backButton');
    await clickControl(page, 'menuButton');
    await page.waitForFunction(() => window.__mysticGame.scene.getScene('puzzle').pieces.length === 4);
    await clickControl(page, 'backButton');
    assert.equal(await page.evaluate(() => window.__mysticGame.scene.getScene('puzzle').mode), 'levels');
    await clickControl(page, 'backButton');
    assert.equal(await page.evaluate(() => window.__mysticGame.scene.getScene('puzzle').mode), 'menu');
    assert.deepEqual(await page.evaluate(() => window.__mysticGame.scene.getScene('puzzle').audio.settings),
      { music: false, effects: false });
    assert.deepEqual(errors, [], `${width}x${height}: browser errors`);
    return { size: `${width}x${height}`, canvas: layout.canvas, settingsPersisted: true, navigation: true, errors };
  } finally { await context.close(); }
}

async function progressCases(browser) {
  for (const [completed, expectedLevel] of [
    [[], 1],
    [[1, 2, 3, 4, 5], 6],
    [LEVELS.map(level => level.id), 1],
  ]) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    if (completed.length) await context.addInitScript(({ saved, currentLevel }) => localStorage.setItem('mystic-puzzles-v1',
      JSON.stringify({ version: 1, completed: saved, currentLevel })),
    { saved: completed, currentLevel: Math.min(LEVELS.length, completed.length + 1) });
    const page = await context.newPage();
    try {
      await page.goto(base);
      await page.waitForFunction(() => window.__mysticGame?.scene?.getScene('puzzle')?.menuArt?.active);
      const label = await page.evaluate(() => window.__mysticGame.scene.getScene('puzzle').children.list
        .filter(child => child.getData('uiText')).map(child => child.text)
        .find(text => text === 'Играть'));
      assert.equal(label, 'Играть');
      await clickControl(page, 'menuButton');
      await page.waitForFunction(level => window.__mysticGame.scene.getScene('puzzle').level.id === level
        && window.__mysticGame.scene.getScene('puzzle').pieces.length > 0, expectedLevel);
      assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('mystic-puzzles-v1')).completed), completed);
    } finally { await context.close(); }
  }
}

async function safeAreaCase(browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  try {
    await page.goto(base);
    await page.waitForFunction(() => window.__mysticGame?.scene?.getScene('puzzle')?.menuArt?.active);
    const controls = await page.evaluate(() => {
      document.documentElement.style.setProperty('--safe-top', '44px');
      document.documentElement.style.setProperty('--safe-bottom', '34px');
      const scene = window.__mysticGame.scene.getScene('puzzle');
      scene.draw();
      return { gearTop: scene.settingsButton().top, galleryBottom: scene.galleryButton().bottom };
    });
    assert.ok(controls.gearTop >= 44);
    assert.ok(controls.galleryBottom <= 844 - 34);
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
    await progressCases(browser);
    await safeAreaCase(browser);
    writeFileSync(`${output}/verification.json`, JSON.stringify(report, null, 2));
    console.log(`Menu verified at ${report.map(item => item.size).join(', ')}`);
  } finally { await browser.close(); }
} finally { server.kill(); }
