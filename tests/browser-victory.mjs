import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const port = 4177;
const base = `http://127.0.0.1:${port}/`;
const screenshots = process.env.VICTORY_SCREENSHOT_DIR;
const sizes = [[360, 640], [390, 844], [430, 932], [1920, 1080]];

async function waitForServer() {
  for (let attempt = 0; attempt < 100; attempt++) {
    try { if ((await fetch(base)).ok) return; } catch { /* Vite is starting. */ }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error(`Vite did not start at ${base}`);
}

async function dragCoordinates(page, id) {
  return page.evaluate(pieceId => {
    const scene = window.__mysticGame.scene.getScene('puzzle');
    const piece = scene.pieces.find(item => item.id === pieceId);
    const sprite = piece.sprite;
    const higher = scene.pieces.filter(item => item !== piece && !item.placed && item.sprite.depth > sprite.depth);
    let start = null;
    let closest = Infinity;
    for (let y = sprite.y - sprite.displayHeight / 2 + 5; y < sprite.y + sprite.displayHeight / 2 - 5; y += 4) {
      for (let x = sprite.x - sprite.displayWidth / 2 + 5; x < sprite.x + sprite.displayWidth / 2 - 5; x += 4) {
        if (!scene.pieceContains(piece, x, y) || higher.some(item => scene.pieceContains(item, x, y))) continue;
        const distance = (x - sprite.x) ** 2 + (y - sprite.y) ** 2;
        if (distance < closest) { closest = distance; start = { x, y }; }
      }
    }
    if (!start) throw new Error(`No visible contact point for piece ${pieceId}`);
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

async function runSize(browser, width, height) {
  const mobile = width < 900;
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
  try {
    await page.goto(base);
    await page.waitForFunction(() => window.__mysticGame?.scene?.getScene('puzzle')?.menuArt?.active);
    const play = await page.evaluate(() => {
      const button = window.__mysticGame.scene.getScene('puzzle').menuButton();
      return { x: button.centerX, y: button.centerY };
    });
    if (mobile) await page.touchscreen.tap(play.x, play.y);
    else await page.mouse.click(play.x, play.y);
    await page.waitForFunction(() => window.__mysticGame.scene.getScene('puzzle').pieces.length === 4);
    const cdp = mobile ? await context.newCDPSession(page) : null;
    const ids = await page.evaluate(() => window.__mysticGame.scene.getScene('puzzle').pieces.map(piece => piece.id).sort((a, b) => b - a));
    for (const id of ids) {
      const { start, target } = await dragCoordinates(page, id);
      await drag(page, cdp, start, target);
      await page.waitForFunction(pieceId => window.__mysticGame.scene.getScene('puzzle').pieces.find(piece => piece.id === pieceId).placed, id);
      if (id !== ids.at(-1)) await page.waitForTimeout(310);
    }
    await page.waitForFunction(() => window.__mysticGame.scene.getScene('puzzle').mode === 'complete');
    const result = await page.evaluate(() => {
      const scene = window.__mysticGame.scene.getScene('puzzle');
      const labels = scene.children.list.filter(child => child.getData('uiText')).map(child => ({
        text: child.text, x: child.x, y: child.y, width: child.width, height: child.height,
      }));
      const log = JSON.parse(localStorage.getItem('mystic-puzzles-victory-log-v1') || '[]');
      return { mode: scene.mode, completedMs: scene.completedMs, stars: scene.results[1]?.stars,
        button: scene.nextButton(), picture: scene.victoryPictureRect(), labels, log,
        progress: scene.progress.completed, scrollWidth: document.documentElement.scrollWidth,
        badge: document.getElementById('build-version')?.textContent };
    });
    assert.equal(result.mode, 'complete');
    assert.ok(result.completedMs > 0);
    assert.ok(result.stars >= 1 && result.stars <= 3);
    assert.ok(result.progress.includes(1));
    assert.ok(result.labels.some(label => label.text === 'Картина собрана!'));
    assert.ok(result.labels.some(label => label.text === `Время ${String(Math.floor(result.completedMs / 60000)).padStart(2, '0')}:${String(Math.floor(result.completedMs / 1000) % 60).padStart(2, '0')}`));
    assert.ok(result.labels.some(label => label.text === 'Далее'));
    assert.ok(result.log.some(entry => entry.event === 'result-saved'));
    assert.ok(result.log.some(entry => entry.event === 'ui-drawn'));
    assert.ok(result.badge?.includes('Победа-2'));
    if (mobile) assert.ok(result.button.y >= result.picture.y + result.picture.height + 14 - 0.01);
    assert.ok(result.button.y + result.button.height <= height);
    assert.equal(result.scrollWidth, width);
    const title = result.labels.find(label => label.text === 'Картина собрана!');
    assert.ok(title.y + title.height / 2 < result.picture.y);
    assert.deepEqual(errors, []);
    if (screenshots) {
      mkdirSync(screenshots, { recursive: true });
      await page.screenshot({ path: `${screenshots}/victory-${width}x${height}.jpg`, type: 'jpeg', quality: 88 });
    }
    const next = result.button;
    if (mobile) await page.touchscreen.tap(next.x + next.width / 2, next.y + next.height / 2);
    else await page.mouse.click(next.x + next.width / 2, next.y + next.height / 2);
    await page.waitForFunction(() => {
      const scene = window.__mysticGame.scene.getScene('puzzle');
      return scene.mode === 'game' && scene.level.id === 2;
    });
    await page.reload();
    await page.waitForFunction(() => window.__mysticGame?.scene?.getScene('puzzle')?.menuArt?.active);
    const saved = await page.evaluate(() => ({
      progress: window.__mysticGame.scene.getScene('puzzle').progress.completed,
      result: window.__mysticGame.scene.getScene('puzzle').results[1],
    }));
    assert.ok(saved.progress.includes(1));
    assert.ok(saved.result.bestMs > 0);
    assert.ok(saved.result.stars >= 1 && saved.result.stars <= 3);
    assert.deepEqual(errors, []);
    return { size: `${width}x${height}`, elapsedMs: Math.round(result.completedMs), stars: result.stars,
      button: result.button, picture: result.picture, badge: result.badge, saved, errors };
  } finally { await context.close(); }
}

const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { stdio: 'ignore' });
try {
  await waitForServer();
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
  const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader'] });
  try {
    const report = [];
    for (const [width, height] of sizes) report.push(await runSize(browser, width, height));
    if (screenshots) writeFileSync(`${screenshots}/browser-results.json`, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally { await browser.close(); }
} finally { server.kill(); }
