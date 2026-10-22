import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const port = 4179, base = `http://127.0.0.1:${port}/`;
const sizes = [[360, 640], [375, 667], [390, 844], [393, 852], [430, 932], [1920, 1080]];
const selectedSizes = process.env.TASK23_SIZES ? sizes.filter(([w, h]) => process.env.TASK23_SIZES.split(',').includes(`${w}x${h}`)) : sizes;
const variants = process.env.TASK23_VARIANTS ? process.env.TASK23_VARIANTS.split(',').map(Number) : [16, 20];
const captures = process.env.TASK23_SCREENSHOT_DIR;
assert.ok(selectedSizes.length && variants.every(count => [14, 16, 20].includes(count)));
if (captures) mkdirSync(captures, { recursive: true });

async function screenPoint(page, point) {
  return page.evaluate(({ x, y }) => {
    const scene = window.__mysticGame.scene.getScene('puzzle');
    const frame = document.querySelector('#game canvas').getBoundingClientRect();
    return { x: frame.left + x * frame.width / scene.viewWidth(),
      y: frame.top + y * frame.height / scene.viewHeight() };
  }, point);
}

async function waitForServer() {
  for (let attempt = 0; attempt < 100; attempt++) {
    try { if ((await fetch(base)).ok) return; } catch { /* Starting. */ }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error('Vite did not start');
}

async function pickup(page, id) {
  return page.evaluate(pieceId => {
    const scene = window.__mysticGame.scene.getScene('puzzle');
    const piece = scene.pieces.find(item => item.id === pieceId), sprite = piece.sprite;
    const higher = scene.pieces.filter(item => item !== piece && !item.placed && item.sprite.depth > sprite.depth);
    let best = null, distance = Infinity, exposed = 0;
    const step = innerWidth >= 900 ? 10 : 6;
    for (let y = sprite.y - sprite.displayHeight / 2 + step; y < sprite.y + sprite.displayHeight / 2 - step; y += step)
      for (let x = sprite.x - sprite.displayWidth / 2 + step; x < sprite.x + sprite.displayWidth / 2 - step; x += step) {
        if (!scene.pieceContains(piece, x, y) || higher.some(other => scene.pieceContains(other, x, y))) continue;
        exposed++;
        const d = (x - sprite.x) ** 2 + (y - sprite.y) ** 2;
        if (d < distance) { distance = d; best = { x, y }; }
      }
    if (!best || exposed < 35) throw new Error(`Piece ${pieceId}: no exposed finger pickup`);
    return { start: best, target: { x: best.x + piece.home.x - sprite.x, y: best.y + piece.home.y - sprite.y },
      origin: { x: sprite.x, y: sprite.y } };
  }, id);
}

async function assertAvailable(page, checkPickups = false) {
  const layers = await page.evaluate(() => {
    const s = window.__mysticGame.scene.getScene('puzzle');
    return s.pieces.filter(p => !p.placed).map(p => ({ id: p.id,
      abovePlaced: s.pieces.filter(other => other.placed).every(other => p.sprite.depth > other.sprite.depth) }));
  });
  for (const layer of layers) {
    assert.ok(layer.abovePlaced, `free piece ${layer.id} under placed artwork`);
    if (checkPickups) await pickup(page, layer.id);
  }
}

async function drag(page, cdp, id) {
  const picked = await pickup(page, id);
  const { origin } = picked;
  const start = await screenPoint(page, picked.start);
  const target = await screenPoint(page, picked.target);
  if (cdp) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...start, id: 1 }] });
    assert.equal(await page.evaluate(() => window.__mysticGame.scene.getScene('puzzle').dragging?.id), id);
    assert.ok(await page.evaluate(() => { const s = window.__mysticGame.scene.getScene('puzzle');
      return s.dragging.sprite.depth > Math.max(...s.pieces.filter(p => p !== s.dragging).map(p => p.sprite.depth)); }));
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: start.x + 3, y: start.y + 3, id: 1 }] });
    const moved = await page.evaluate(pieceId => { const s = window.__mysticGame.scene.getScene('puzzle').pieces.find(p => p.id === pieceId).sprite;
      return { x: s.x, y: s.y }; }, id);
    assert.ok(Math.hypot(moved.x - origin.x, moved.y - origin.y) < 9, `piece ${id} jumped on pickup`);
    for (let step = 1; step <= 5; step++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{
        x: start.x + (target.x - start.x) * step / 5,
        y: start.y + (target.y - start.y) * step / 5, id: 1 }] });
      await page.waitForTimeout(20);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    assert.equal(await page.evaluate(() => window.__mysticGame.scene.getScene('puzzle').dragging?.id), id);
    await page.mouse.move(target.x, target.y, { steps: 8 });
    await page.mouse.up();
  }
  await page.waitForFunction(pieceId => window.__mysticGame.scene.getScene('puzzle').pieces.find(p => p.id === pieceId)?.placed, id);
  await page.waitForTimeout(270);
}

function orderFor(count, reverse = false) {
  const ids = Array.from({ length: count }, (_, id) => id);
  const mixed = ids.filter(id => id % 2).reverse().concat(ids.filter(id => id % 2 === 0));
  return reverse ? mixed.reverse() : mixed;
}

async function runSize(browser, count, width, height) {
  const mobile = width < 900;
  const context = await browser.newContext({ viewport: { width, height }, isMobile: mobile, hasTouch: mobile });
  await context.addInitScript(() => localStorage.setItem('mystic-puzzles-v1',
    JSON.stringify({ version: 1, completed: [1, 2, 3, 4, 5], currentLevel: 6 })));
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
  const capture = captures && [360, 390, 1920].includes(width);
  const prefix = `${count}-${width}x${height}`;
  try {
    await page.goto(count === 14 ? base : `${base}?devPieces=${count}`);
    if (count === 14) {
      await page.waitForFunction(() => window.__mysticGame?.scene?.getScene('puzzle')?.menuArt?.active);
      await page.evaluate(() => window.__mysticGame.scene.getScene('puzzle').startGame(6));
    }
    await page.waitForFunction(expected => window.__mysticGame?.scene?.getScene('puzzle')?.pieces.length === expected, count);
    const initial = await page.evaluate(() => {
      const s = window.__mysticGame.scene.getScene('puzzle');
      const snap = Math.max(28, s.board.width * .14);
      return { count: s.pieces.length, level: s.level.id, allFree: s.pieces.every(p => !p.placed),
        minDistance: Math.min(...s.pieces.map(p => Math.hypot(p.sprite.x - p.home.x, p.sprite.y - p.home.y))),
        snap, board: s.board, scrollWidth: document.documentElement.scrollWidth };
    });
    assert.equal(initial.count, count); assert.equal(initial.level, 6); assert.ok(initial.allFree);
    assert.ok(initial.minDistance > initial.snap * 2, `${prefix}: near snap at start`);
    assert.equal(initial.scrollWidth, width);
    await assertAvailable(page, true);
    if (capture) await page.screenshot({ path: `${captures}/start-${prefix}.png`, timeout: 120000 });
    const hint = await page.evaluate(() => { const b = window.__mysticGame.scene.getScene('puzzle').hintButton(); return { x: b.x, y: b.y }; });
    const hintScreen = await screenPoint(page, hint);
    if (mobile) await page.touchscreen.tap(hintScreen.x, hintScreen.y); else await page.mouse.click(hintScreen.x, hintScreen.y);
    assert.ok(await page.evaluate(() => window.__mysticGame.scene.getScene('puzzle').hintPiece?.id >= 0));
    const cdp = mobile ? await context.newCDPSession(page) : null;
    const ids = orderFor(count);
    for (let step = 0; step < ids.length; step++) {
      await drag(page, cdp, ids[step]);
      if (step === Math.floor(count / 2) - 1 && capture)
        await page.screenshot({ path: `${captures}/partial-${prefix}.png`, timeout: 120000 });
      if (step < ids.length - 1) await assertAvailable(page, step === Math.floor(count / 2) - 1);
      if (width === 390 && step === Math.floor(count / 2) - 1) {
        await page.setViewportSize({ width: 393, height: 852 });
        await page.waitForFunction(() => window.__mysticGame.scene.getScene('puzzle').viewWidth() === 393);
        await assertAvailable(page, true);
        await page.setViewportSize({ width, height });
        await page.waitForFunction(() => window.__mysticGame.scene.getScene('puzzle').viewWidth() === 390);
        await assertAvailable(page, true);
      }
    }
    await page.waitForFunction(() => window.__mysticGame.scene.getScene('puzzle').mode === 'complete');
    await page.waitForTimeout(1100);
    const won = await page.evaluate(() => { const s = window.__mysticGame.scene.getScene('puzzle');
      return { elapsed: s.completedMs, result: s.results[6], completed: s.progress.completed.includes(6),
        picture: s.victoryScreenLayout().picture, next: s.nextButton(), image: s.completeImage?.getBounds() }; });
    assert.ok(won.elapsed > 0 && won.result.stars >= 1 && won.result.stars <= 3 && won.completed);
    assert.ok(Math.abs(won.image.width - won.picture.width) < 1 && Math.abs(won.image.height - won.picture.height) < 1);
    if (capture) {
      await page.screenshot({ path: `${captures}/victory-${prefix}.png`, timeout: 120000 });
      await page.screenshot({ path: `${captures}/assembled-${prefix}.png`, clip: won.picture, timeout: 120000 });
    }
    const next = { x: won.next.x + won.next.width / 2, y: won.next.y + won.next.height / 2 };
    const nextScreen = await screenPoint(page, next);
    if (mobile) await page.touchscreen.tap(nextScreen.x, nextScreen.y); else await page.mouse.click(nextScreen.x, nextScreen.y);
    await page.waitForFunction(() => window.__mysticGame.scene.getScene('puzzle').mode === 'gallery');
    assert.ok(await page.evaluate(() => window.__mysticGame.scene.getScene('puzzle').progress.completed.includes(6)));
    if (width === 390) {
      await page.evaluate(() => window.__mysticGame.scene.getScene('puzzle').startGame(6));
      await page.waitForFunction(expected => window.__mysticGame.scene.getScene('puzzle').pieces.length === expected, count);
      const replayCdp = await context.newCDPSession(page);
      for (const id of orderFor(count, true)) { await drag(page, replayCdp, id); await assertAvailable(page); }
      await page.waitForFunction(() => window.__mysticGame.scene.getScene('puzzle').mode === 'complete');
      const replay = await page.evaluate(() => { const s = window.__mysticGame.scene.getScene('puzzle');
        return { elapsed: s.completedMs, result: s.results[6] }; });
      assert.equal(replay.result.bestMs, Math.min(won.result.bestMs, Math.round(replay.elapsed)));
      assert.ok(replay.result.stars >= won.result.stars);
    }
    assert.deepEqual(errors, []);
    return { size: `${width}x${height}`, pieces: count, minStartDistance: Math.round(initial.minDistance),
      elapsedMs: Math.round(won.elapsed), stars: won.result.stars, errors };
  } finally { await context.close(); }
}

const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { stdio: 'ignore' });
try {
  await waitForServer();
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
  const browser = await chromium.launch({ executablePath, headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader'] });
  try {
    const report = [];
    for (const count of variants) for (const [width, height] of selectedSizes) {
      const result = await runSize(browser, count, width, height);
      report.push(result);
      console.log(`Passed ${count} pieces at ${result.size}: ${result.minStartDistance}px from home, ${result.stars} stars`);
    }
    console.log(JSON.stringify(report, null, 2));
  } finally { await browser.close(); }
} finally { server.kill(); }
