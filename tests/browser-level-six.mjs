import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const port = 4178;
const base = `http://127.0.0.1:${port}/`;
const captures = process.env.TASK21_SCREENSHOT_DIR;
const allSizes = [[360, 640], [375, 667], [390, 844], [393, 852], [430, 932], [1920, 1080]];
const sizes = process.env.TASK21_SIZES
  ? allSizes.filter(([w, h]) => process.env.TASK21_SIZES.split(',').includes(`${w}x${h}`)) : allSizes;
assert.ok(sizes.length);

async function waitForServer() {
  for (let attempt = 0; attempt < 100; attempt++) {
    try { if ((await fetch(base)).ok) return; } catch { /* Vite is starting. */ }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error('Vite did not start');
}

async function click(page, mobile, x, y) {
  if (mobile) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
}

async function card(page, index) {
  return page.evaluate(i => {
    const r = window.__mysticGame.scene.getScene('puzzle').cardRects()[i];
    return { x: r.centerX, y: r.centerY, top: r.top, bottom: r.bottom };
  }, index);
}

async function openLevelSix(page, mobile, height, captureLevels = true) {
  const button = await page.evaluate(() => {
    const r = window.__mysticGame.scene.getScene('puzzle').levelsButton();
    return { x: r.centerX, y: r.centerY };
  });
  await click(page, mobile, button.x, button.y);
  await page.waitForFunction(() => window.__mysticGame.scene.getScene('puzzle').mode === 'levels');
  let sixth = await card(page, 5);
  if (sixth.top < 70 || sixth.bottom > height - 10) {
    await page.mouse.move(sixth.x, height / 2);
    await page.mouse.wheel(0, 800);
    await page.waitForFunction(() => window.__mysticGame.scene.getScene('puzzle').levelScrollRow > 0);
    sixth = await card(page, 5);
  }
  assert.ok(sixth.top >= 70 && sixth.bottom <= height - 9, 'sixth card is visible');
  if (captures && captureLevels) await page.screenshot({ path: `${captures}/levels-${page.viewportSize().width}x${height}.png`, timeout: 120000 });
  await click(page, mobile, sixth.x, sixth.y);
  await page.waitForFunction(() => window.__mysticGame.scene.getScene('puzzle').mode === 'game' &&
    window.__mysticGame.scene.getScene('puzzle').pieces.length === 12);
}

async function pickup(page, id) {
  return page.evaluate(pieceId => {
    const s = window.__mysticGame.scene.getScene('puzzle');
    const p = s.pieces.find(item => item.id === pieceId), sprite = p.sprite;
    const higher = s.pieces.filter(item => item !== p && item.sprite.depth > sprite.depth && item.sprite.visible);
    let best = null, distance = Infinity;
    for (let y = sprite.y - sprite.displayHeight / 2 + 5; y < sprite.y + sprite.displayHeight / 2 - 5; y += 3)
      for (let x = sprite.x - sprite.displayWidth / 2 + 5; x < sprite.x + sprite.displayWidth / 2 - 5; x += 3) {
        if (!s.pieceContains(p, x, y) || higher.some(other => s.pieceContains(other, x, y))) continue;
        const d = (x - sprite.x) ** 2 + (y - sprite.y) ** 2;
        if (d < distance) { distance = d; best = { x, y }; }
      }
    if (!best) throw new Error(`Piece ${pieceId} has no exposed pickup point`);
    return { start: best, target: { x: best.x + p.home.x - sprite.x, y: best.y + p.home.y - sprite.y },
      sprite: { x: sprite.x, y: sprite.y } };
  }, id);
}

async function assertLayersAndAccess(page) {
  const state = await page.evaluate(() => {
    const s = window.__mysticGame.scene.getScene('puzzle');
    return s.pieces.filter(p => !p.placed).map(p => {
      const sprite = p.sprite;
      const higher = s.pieces.filter(other => other !== p && other.sprite.visible && other.sprite.depth > sprite.depth);
      let exposed = 0;
      for (let y = sprite.y - sprite.displayHeight / 2 + 5; y < sprite.y + sprite.displayHeight / 2 - 5; y += 4) {
        for (let x = sprite.x - sprite.displayWidth / 2 + 5; x < sprite.x + sprite.displayWidth / 2 - 5; x += 4) {
          if (s.pieceContains(p, x, y) && !higher.some(other => s.pieceContains(other, x, y))) exposed++;
        }
      }
      return { id: p.id, exposed, depth: sprite.depth,
        abovePlaced: s.pieces.filter(other => other.placed).every(other => sprite.depth > other.sprite.depth) };
    });
  });
  for (const piece of state) {
    assert.ok(piece.abovePlaced, `free piece ${piece.id} is under a placed piece`);
    assert.ok(piece.exposed > 50, `free piece ${piece.id} is hidden or has no finger-sized exposed area`);
  }
  return state;
}

async function assertPlacedDoesNotCapture(page, cdp) {
  const point = await page.evaluate(() => {
    const s = window.__mysticGame.scene.getScene('puzzle');
    for (const p of s.pieces.filter(item => item.placed)) {
      for (let y = p.sprite.y - p.sprite.displayHeight / 2 + 6; y < p.sprite.y + p.sprite.displayHeight / 2 - 6; y += 5)
        for (let x = p.sprite.x - p.sprite.displayWidth / 2 + 6; x < p.sprite.x + p.sprite.displayWidth / 2 - 6; x += 5)
          if (s.pieceContains(p, x, y) && s.pieces.filter(item => !item.placed).every(item => !s.pieceContains(item, x, y)))
            return { x, y };
    }
    throw new Error('No exposed placed-piece point to test');
  });
  if (cdp) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...point, id: 1 }] });
    assert.equal(await page.evaluate(() => window.__mysticGame.scene.getScene('puzzle').dragging), null);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    await page.mouse.click(point.x, point.y);
    assert.equal(await page.evaluate(() => window.__mysticGame.scene.getScene('puzzle').dragging), null);
  }
}

async function drag(page, cdp, id) {
  const { start, target, sprite } = await pickup(page, id);
  if (cdp) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...start, id: 1 }] });
    assert.equal(await page.evaluate(() => window.__mysticGame.scene.getScene('puzzle').dragging?.id), id);
    assert.ok(await page.evaluate(() => { const s = window.__mysticGame.scene.getScene('puzzle');
      return s.dragging.sprite.depth > Math.max(...s.pieces.filter(p => p !== s.dragging).map(p => p.sprite.depth)); }));
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: start.x + 3, y: start.y + 3, id: 1 }] });
    const moved = await page.evaluate(pieceId => {
      const p = window.__mysticGame.scene.getScene('puzzle').pieces.find(item => item.id === pieceId);
      return { x: p.sprite.x, y: p.sprite.y };
    }, id);
    assert.ok(Math.hypot(moved.x - sprite.x, moved.y - sprite.y) < 9, `piece ${id} jumped on touch`);
    for (let step = 1; step <= 10; step++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{
        x: start.x + (target.x - start.x) * step / 10,
        y: start.y + (target.y - start.y) * step / 10, id: 1,
      }] });
      await page.waitForTimeout(18);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    assert.equal(await page.evaluate(() => window.__mysticGame.scene.getScene('puzzle').dragging?.id), id);
    assert.ok(await page.evaluate(() => { const s = window.__mysticGame.scene.getScene('puzzle');
      return s.dragging.sprite.depth > Math.max(...s.pieces.filter(p => p !== s.dragging).map(p => p.sprite.depth)); }));
    await page.mouse.move(target.x, target.y, { steps: 12 });
    await page.mouse.up();
  }
  await page.waitForFunction(pieceId => window.__mysticGame.scene.getScene('puzzle').pieces.find(p => p.id === pieceId)?.placed, id);
  await page.waitForTimeout(300);
  assert.ok(await page.evaluate(pieceId => { const s = window.__mysticGame.scene.getScene('puzzle');
    const p = s.pieces.find(item => item.id === pieceId);
    return s.pieces.filter(other => !other.placed).every(other => p.sprite.depth < other.sprite.depth);
  }, id));
}

async function runSize(browser, width, height) {
  const mobile = width < 900;
  const context = await browser.newContext({ viewport: { width, height }, isMobile: mobile, hasTouch: mobile });
  await context.addInitScript(() => {
    if (!localStorage.getItem('mystic-puzzles-v1')) localStorage.setItem('mystic-puzzles-v1',
      JSON.stringify({ version: 1, completed: [1, 2, 3, 4, 5], currentLevel: 6 }));
  });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
  try {
    await page.goto(base);
    await page.waitForFunction(() => window.__mysticGame?.scene?.getScene('puzzle')?.menuArt?.active);
    await openLevelSix(page, mobile, height);
    const initial = await page.evaluate(() => {
      const s = window.__mysticGame.scene.getScene('puzzle');
      return { ids: s.pieces.map(p => p.id), title: s.level.title, board: s.board,
        textures: s.pieces.every(p => p.sprite.texture.key === `piece-loose-${p.id}`) };
    });
    assert.deepEqual([...initial.ids].sort((a, b) => a - b), Array.from({ length: 12 }, (_, i) => i));
    assert.equal(initial.title, 'Заколдованная библиотека');
    assert.ok(initial.textures);
    await assertLayersAndAccess(page);
    if (captures) await page.screenshot({ path: `${captures}/start-${width}x${height}.png`, timeout: 120000 });
    const hint = await page.evaluate(() => { const b = window.__mysticGame.scene.getScene('puzzle').hintButton(); return { x: b.x, y: b.y }; });
    await click(page, mobile, hint.x, hint.y);
    assert.ok(await page.evaluate(() => window.__mysticGame.scene.getScene('puzzle').hintPiece?.id >= 0));
    const cdp = mobile ? await context.newCDPSession(page) : null;
    const released = await pickup(page, 11);
    if (cdp) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...released.start, id: 1 }] });
      assert.equal(await page.evaluate(() => window.__mysticGame.scene.getScene('puzzle').dragging?.id), 11);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      await page.mouse.move(released.start.x, released.start.y);
      await page.mouse.down();
      assert.equal(await page.evaluate(() => window.__mysticGame.scene.getScene('puzzle').dragging?.id), 11);
      await page.mouse.up();
    }
    assert.ok(await page.evaluate(() => { const s = window.__mysticGame.scene.getScene('puzzle');
      const p = s.pieces.find(item => item.id === 11);
      return !p.placed && p.sprite.depth > s.guideImage.depth && p.sprite.depth < 50;
    }));
    await assertLayersAndAccess(page);
    for (let index = 11; index >= 0; index--) {
      await drag(page, cdp, index);
      if (index === 6 && captures) await page.screenshot({ path: `${captures}/partial-${width}x${height}.png`, timeout: 120000 });
      if (index > 0) await assertLayersAndAccess(page);
      if (index === 6) await assertPlacedDoesNotCapture(page, cdp);
      if (width === 390 && index === 6) {
        await page.setViewportSize({ width: 393, height: 852 });
        await page.waitForFunction(() => window.__mysticGame.scene.getScene('puzzle').viewWidth() === 393);
        await assertLayersAndAccess(page);
        await page.setViewportSize({ width, height });
        await page.waitForFunction(() => window.__mysticGame.scene.getScene('puzzle').viewWidth() === 390);
        await assertLayersAndAccess(page);
      }
    }
    await page.waitForFunction(() => window.__mysticGame.scene.getScene('puzzle').mode === 'complete');
    await page.waitForTimeout(1100);
    const won = await page.evaluate(() => {
      const s = window.__mysticGame.scene.getScene('puzzle');
      return { elapsedMs: s.completedMs, result: s.results[6], completed: s.progress.completed,
        image: s.completeImage?.getBounds(), picture: s.victoryScreenLayout().picture,
        button: { x: s.nextButton().centerX, y: s.nextButton().centerY },
        labels: s.children.list.filter(c => c.getData('uiText')).map(c => c.text),
        scrollWidth: document.documentElement.scrollWidth };
    });
    assert.ok(won.elapsedMs > 0 && won.result.stars >= 1 && won.result.stars <= 3);
    assert.ok(won.completed.includes(6));
    assert.equal(won.scrollWidth, width);
    assert.ok(won.labels.includes('Картина собрана!') && won.labels.includes('В галерею'));
    assert.ok(Math.abs(won.image.width - won.picture.width) < 1 &&
      Math.abs(won.image.height - won.picture.height) < 1);
    if (captures) {
      await page.screenshot({ path: `${captures}/victory-${width}x${height}.png`, timeout: 120000 });
      await page.screenshot({ path: `${captures}/assembled-art-${width}x${height}.png`, clip: won.picture, timeout: 120000 });
    }
    await click(page, mobile, won.button.x, won.button.y);
    await page.waitForFunction(() => window.__mysticGame.scene.getScene('puzzle').mode === 'gallery');
    assert.ok(await page.evaluate(() => window.__mysticGame.scene.getScene('puzzle').progress.completed.includes(6)));
    if (width === 390 || width === 1920) {
      await page.mouse.move(width / 2, height / 2);
      await page.mouse.wheel(0, 800);
      await page.waitForFunction(() => window.__mysticGame.scene.getScene('puzzle').galleryScrollRow > 0);
      if (captures) await page.screenshot({ path: `${captures}/gallery-${width}x${height}.png`, timeout: 120000 });
      const sixth = await card(page, 5);
      await click(page, mobile, sixth.x, sixth.y);
      await page.waitForFunction(() => window.__mysticGame.scene.getScene('puzzle').mode === 'view');
      assert.equal(await page.evaluate(() => window.__mysticGame.scene.getScene('puzzle').viewedLevel), 6);
      const close = await page.evaluate(() => { const r = window.__mysticGame.scene.getScene('puzzle').galleryCloseButton();
        return { x: r.centerX, y: r.centerY }; });
      await click(page, mobile, close.x, close.y);
      await page.waitForFunction(() => window.__mysticGame.scene.getScene('puzzle').mode === 'gallery');
    }
    await page.reload();
    await page.waitForFunction(() => window.__mysticGame?.scene?.getScene('puzzle')?.menuArt?.active);
    const restored = await page.evaluate(() => {
      const s = window.__mysticGame.scene.getScene('puzzle');
      return { progress: s.progress.completed, result: s.results[6] };
    });
    assert.ok(restored.progress.includes(6));
    assert.deepEqual(restored.result, won.result);
    if (width === 390) {
      await openLevelSix(page, mobile, height, false);
      const replayCdp = await context.newCDPSession(page);
      for (let id = 0; id < 12; id++) {
        await drag(page, replayCdp, id);
        if (id < 11) await assertLayersAndAccess(page);
      }
      await page.waitForFunction(() => window.__mysticGame.scene.getScene('puzzle').mode === 'complete');
      const replay = await page.evaluate(() => { const s = window.__mysticGame.scene.getScene('puzzle');
        return { elapsedMs: s.completedMs, result: s.results[6] }; });
      assert.equal(replay.result.bestMs, Math.min(won.result.bestMs, Math.round(replay.elapsedMs)));
      assert.ok(replay.result.stars >= won.result.stars);
      if (captures) await page.screenshot({ path: `${captures}/replay-victory-${width}x${height}.png`, timeout: 120000 });
      // The same depth policy must survive every older level, including replay.
      for (let level = 1; level <= 5; level++) {
        await page.evaluate(id => window.__mysticGame.scene.getScene('puzzle').startGame(id), level);
        const count = [4, 4, 6, 6, 8][level - 1];
        await page.waitForFunction(expected => window.__mysticGame.scene.getScene('puzzle').pieces.length === expected, count);
        await assertLayersAndAccess(page);
        for (let id = 0; id < count; id++) {
          await drag(page, replayCdp, id);
          if (id < count - 1) await assertLayersAndAccess(page);
        }
        await page.waitForFunction(() => window.__mysticGame.scene.getScene('puzzle').mode === 'complete');
        assert.ok(await page.evaluate(id => window.__mysticGame.scene.getScene('puzzle').results[id]?.stars >= 1, level));
      }
    }
    assert.deepEqual(errors, []);
    return { size: `${width}x${height}`, pieces: initial.ids.length, elapsedMs: Math.round(won.elapsedMs),
      stars: won.result.stars, saved: restored, errors };
  } finally { await context.close(); }
}

if (captures) mkdirSync(captures, { recursive: true });
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { stdio: 'ignore' });
try {
  await waitForServer();
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
  const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader'] });
  try {
    const report = [];
    for (const [width, height] of sizes) report.push(await runSize(browser, width, height));
    console.log(JSON.stringify(report, null, 2));
  } finally { await browser.close(); }
} finally { server.kill(); }
