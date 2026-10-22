import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { strokeFrameRect } from '../src/chromeLayout.ts';

const port = 4177;
const base = `http://127.0.0.1:${port}/`;
const screenshots = process.env.VICTORY_SCREENSHOT_DIR;
const details = process.env.VICTORY_DETAIL_DIR;
const task19CaptureDir = process.env.TASK19_CAPTURE_DIR;
const task19VariantDir = process.env.TASK19_VARIANT_DIR;
const allSizes = [[360, 640], [375, 667], [390, 844], [393, 852], [430, 932], [1920, 1080]];
const sizes = process.env.VICTORY_SIZES
  ? allSizes.filter(([w, h]) => process.env.VICTORY_SIZES.split(',').includes(`${w}x${h}`)) : allSizes;
assert.ok(sizes.length, 'No matching VICTORY_SIZES');

function inside(inner, outer, padding = 0) {
  return inner.x >= outer.x + padding && inner.y >= outer.y + padding
    && inner.x + inner.width <= outer.x + outer.width - padding
    && inner.y + inner.height <= outer.y + outer.height - padding;
}

function overlaps(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x
    && a.y < b.y + b.height && a.y + a.height > b.y;
}

async function visibleGoldPixels(page, screenshot, areas) {
  return page.evaluate(async ({ encoded, areas }) => {
    const image = new Image();
    image.src = `data:image/png;base64,${encoded}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    const game = window.__mysticGame.scene.getScene('puzzle');
    const frame = document.querySelector('#game canvas').getBoundingClientRect();
    const counts = {};
    for (const [name, rect] of Object.entries(areas)) {
      const x = Math.max(0, Math.floor(frame.left + rect.x * frame.width / game.viewWidth()));
      const y = Math.max(0, Math.floor(frame.top + rect.y * frame.height / game.viewHeight()));
      const width = Math.min(image.width - x, Math.ceil(rect.width * frame.width / game.viewWidth()));
      const height = Math.min(image.height - y, Math.ceil(rect.height * frame.height / game.viewHeight()));
      const pixels = context.getImageData(x, y, width, height).data;
      let warm = 0;
      for (let index = 0; index < pixels.length; index += 4) {
        if (pixels[index] > 165 && pixels[index + 1] > 105 && pixels[index + 2] < 190
          && pixels[index] > pixels[index + 2] + 30) warm++;
      }
      counts[name] = warm;
    }
    return counts;
  }, { encoded: screenshot.toString('base64'), areas });
}

async function screenPoint(page, point) {
  return page.evaluate(({ x, y }) => {
    const game = window.__mysticGame.scene.getScene('puzzle');
    const frame = document.querySelector('#game canvas').getBoundingClientRect();
    return { x: frame.left + x * frame.width / game.viewWidth(),
      y: frame.top + y * frame.height / game.viewHeight() };
  }, point);
}

async function filledAwardPixels(page, screenshot, layout, starY) {
  return page.evaluate(async ({ encoded, layout, starY }) => {
    const image = new Image(); image.src = `data:image/png;base64,${encoded}`; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext('2d', { willReadFrequently: true }); context.drawImage(image, 0, 0);
    return [-1, 0, 1].map(index => {
      const x = Math.round(layout.contentX + index * layout.starRadius * 2.6);
      const pixels = context.getImageData(x - 4, Math.round(starY) - 4, 9, 9).data;
      let filled = 0;
      for (let at = 0; at < pixels.length; at += 4)
        if (pixels[at] > 225 && pixels[at + 1] > 170 && pixels[at + 2] > 75 && pixels[at] > pixels[at + 2] + 70) filled++;
      return filled;
    });
  }, { encoded: screenshot.toString('base64'), layout, starY });
}

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
  start = await screenPoint(page, start);
  target = await screenPoint(page, target);
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
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: details && width === 390 ? 2 : 1, isMobile: mobile, hasTouch: mobile });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
  try {
    await page.goto(base);
    await page.waitForFunction(() => window.__mysticGame?.scene?.getScene('puzzle')?.menuArt?.active);
    assert.equal(await page.locator('#build-version').count(), 0);
    const play = await page.evaluate(() => {
      const button = window.__mysticGame.scene.getScene('puzzle').menuButton();
      return { x: button.centerX, y: button.centerY };
    });
    const playScreen = await screenPoint(page, play);
    if (mobile) await page.touchscreen.tap(playScreen.x, playScreen.y);
    else await page.mouse.click(playScreen.x, playScreen.y);
    await page.waitForFunction(() => window.__mysticGame.scene.getScene('puzzle').pieces.length === 4);
    await page.waitForFunction(() => [...document.fonts]
      .some(face => face.family === 'MysticLevelSerif' && face.status === 'loaded'));
    const game = await page.evaluate(() => {
      const s = window.__mysticGame.scene.getScene('puzzle');
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      return { board: s.board, back: s.backButton(), hint: s.hintButton(),
        labels: s.children.list.filter(c => c.getData('uiText')).map(c => {
          context.font = `${c.style.fontStyle} ${c.style.fontSize} ${c.style.fontFamily}`;
          const metrics = context.measureText(c.text);
          return { text: c.text, bounds: c.getBounds(), fontFamily: c.style.fontFamily,
            inkHeight: metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent,
            baseline: c.y - c.getTextMetrics().descent };
        }) };
    });
    const level = game.labels.find(l => l.text === 'УРОВЕНЬ 1');
    const name = game.labels.find(l => l.text === 'Домик у озера');
    const timer = game.labels.find(l => /^\d\d:\d\d$/.test(l.text));
    for (const label of [level, name, timer]) assert.ok(label && inside(label.bounds, { x: 0, y: 0, width, height }));
    assert.match(level.fontFamily, /^MysticLevelSerif/);
    assert.ok(level.inkHeight > 0);
    assert.ok(!overlaps(level.bounds, timer.bounds));
    assert.ok(!overlaps(name.bounds, level.bounds));
    assert.ok(!overlaps(name.bounds, timer.bounds));
    const gameFrame = strokeFrameRect(game.board, width, 2, 1.5);
    assert.ok(gameFrame.x >= 1.5 && gameFrame.x + gameFrame.width <= width - 1.5);
    assert.ok(name.bounds.y + name.bounds.height < game.board.y);
    assert.ok(name.bounds.x > game.back.x + 19 && name.bounds.x + name.bounds.width < game.hint.x - 19);
    if (screenshots) {
      mkdirSync(screenshots, { recursive: true });
      await page.screenshot({ path: `${screenshots}/game-${width}x${height}.jpg`, type: 'jpeg', quality: 88, scale: 'css' });
    }
    if (task19CaptureDir) {
      mkdirSync(task19CaptureDir, { recursive: true });
      await page.screenshot({ path: `${task19CaptureDir}/game-${width}x${height}.png`, scale: 'css' });
    }
    if (details && width === 390) {
      mkdirSync(details, { recursive: true });
      await page.screenshot({ path: `${details}/game-header-390x844.png`, clip: { x: 0, y: 0, width, height: 75 }, scale: 'device' });
      await page.screenshot({ path: `${details}/game-frame-390x844.png`, clip: { x: 0, y: 48, width, height: 62 }, scale: 'device' });
    }
    if (width === 360) {
      await page.evaluate(() => { const s = window.__mysticGame.scene.getScene('puzzle');
        s.level = { ...s.level, title: 'Необычайно длинное название волшебной картины среди далёких гор' }; s.draw(); });
      const long = await page.evaluate(() => {
        const s = window.__mysticGame.scene.getScene('puzzle');
        const label = s.children.list.find(c => c.getData('uiText') && c.text.startsWith('Необычайно'));
        return { text: label?.text, bounds: label?.getBounds(), board: s.board };
      });
      assert.ok(long.text.endsWith('…'));
      assert.ok(inside(long.bounds, { x: game.back.x + 23, y: 0, width: game.hint.x - game.back.x - 46, height: game.board.y }));
      await page.evaluate(() => { const s = window.__mysticGame.scene.getScene('puzzle');
        s.level = { ...s.level, title: 'Домик у озера' }; s.draw(); });
    }
    const cdp = mobile ? await context.newCDPSession(page) : null;
    const ids = await page.evaluate(() => window.__mysticGame.scene.getScene('puzzle').pieces.map(p => p.id).sort((a, b) => b - a));
    for (const id of ids) {
      if (width === 430 && id === ids.at(-1)) await page.evaluate(() => window.__mysticGame.scene.getScene('puzzle').tweens.pauseAll());
      const { start, target } = await dragCoordinates(page, id);
      await drag(page, cdp, start, target);
      await page.waitForFunction(pieceId => window.__mysticGame.scene.getScene('puzzle').pieces.find(p => p.id === pieceId).placed, id);
      if (id !== ids.at(-1)) await page.waitForTimeout(310);
    }
    await page.waitForFunction(() => window.__mysticGame.scene.getScene('puzzle').mode === 'complete');
    if (task19CaptureDir) {
      for (const [phase, elapsed] of [['early', 80], ['during', 610], ['final', 1250]]) {
        await page.evaluate(offset => {
          const scene = window.__mysticGame.scene.getScene('puzzle');
          const frameTime = performance.now();
          // Hold one real rendered frame while the screenshot is encoded; slow
          // devices must not advance from the middle beat to the final beat.
          Object.defineProperty(performance, 'now', { configurable: true, value: () => frameTime });
          scene.revealStartedAt = frameTime - offset;
          if ('victoryAwardStartedAt' in scene) scene.victoryAwardStartedAt = frameTime - offset;
        }, elapsed);
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        await page.screenshot({ path: `${task19CaptureDir}/victory-${phase}-${width}x${height}.png`, scale: 'css' });
        await page.evaluate(() => { delete performance.now; });
      }
    }
    const result = await page.evaluate(() => {
      const s = window.__mysticGame.scene.getScene('puzzle');
      return { mode: s.mode, completedMs: s.completedMs, stars: s.results[1]?.stars,
        layout: s.victoryScreenLayout(), button: s.nextButton(),
        starY: s.victoryStarY, glowRadius: s.victoryGlowRadius,
        image: { visible: s.completeImage?.visible, bounds: s.completeImage?.getBounds() },
        labels: s.children.list.filter(c => c.getData('uiText')).map(c => ({ text: c.text, visible: c.visible,
          alpha: c.alpha, bounds: c.getBounds() })), progress: s.progress.completed,
        log: JSON.parse(localStorage.getItem('mystic-puzzles-victory-log-v1') || '[]'),
        scrollWidth: document.documentElement.scrollWidth,
        badge: document.getElementById('build-version')?.textContent };
    });
    assert.equal(result.mode, 'complete');
    assert.ok(result.completedMs > 0 && result.stars >= 1 && result.stars <= 3);
    assert.ok(result.progress.includes(1));
    assert.ok(result.log.some(e => e.event === 'result-saved') && result.log.some(e => e.event === 'ui-drawn'));
    assert.equal(result.badge, undefined);
    assert.equal(result.scrollWidth, width);
    assert.ok(result.image.visible);
    assert.ok(inside(result.image.bounds, { x: 0, y: 0, width, height }));
    const { picture } = result.layout;
    assert.ok(Math.abs(result.image.bounds.width - picture.width) < 1);
    assert.ok(Math.abs(result.image.bounds.height - picture.height) < 1);
    const title = result.labels.find(l => l.text === 'Картина собрана!');
    const pictureName = result.labels.find(l => l.text === 'Домик у озера');
    const time = result.labels.find(l => l.text === `Время ${String(Math.floor(result.completedMs / 60000)).padStart(2, '0')}:${String(Math.floor(result.completedMs / 1000) % 60).padStart(2, '0')}`);
    const nextLabel = result.labels.find(l => l.text === 'Далее');
    for (const label of [title, pictureName, time, nextLabel]) {
      assert.ok(label?.visible && label.alpha === 1);
      assert.ok(inside(label.bounds, { x: 0, y: 0, width, height }));
    }
    assert.ok(inside(nextLabel.bounds, result.button));
    assert.ok(!overlaps(result.button, result.image.bounds));
    assert.ok(!overlaps(title.bounds, result.image.bounds));
    assert.ok(!overlaps(time.bounds, result.image.bounds));
    const glowBounds = [-1, 0, 1].map(i => ({
      x: result.layout.contentX + i * result.layout.starRadius * 2.6 - result.glowRadius,
      y: result.starY - result.glowRadius,
      width: result.glowRadius * 2, height: result.glowRadius * 2,
    }));
    for (const glow of glowBounds) {
      for (const label of [title, pictureName, time, nextLabel])
        assert.ok(!overlaps(glow, label.bounds), `${width}: star glow overlaps ${label.text}`);
      assert.ok(!overlaps(glow, result.image.bounds), `${width}: star glow overlaps picture`);
    }
    const victoryFrame = strokeFrameRect(picture, width, 7, 2.5);
    assert.ok(victoryFrame.x >= 2.5 && victoryFrame.x + victoryFrame.width <= width - 2.5);
    if (width === 360) {
      await page.evaluate(() => { const s = window.__mysticGame.scene.getScene('puzzle');
        s.level = { ...s.level, title: 'Необычайно длинное название волшебной картины среди далёких гор' }; s.draw(); });
      const long = await page.evaluate(() => { const s = window.__mysticGame.scene.getScene('puzzle');
        const l = s.children.list.find(c => c.getData('uiText') && c.text.startsWith('Необычайно'));
        return { text: l?.text, bounds: l?.getBounds(), layout: s.victoryScreenLayout() }; });
      assert.ok(long.text.endsWith('…'));
      assert.ok(inside(long.bounds, { x: 0, y: 0, width, height }));
      assert.ok(!overlaps(long.bounds, long.layout.picture));
      await page.evaluate(() => { const s = window.__mysticGame.scene.getScene('puzzle');
        s.level = { ...s.level, title: 'Домик у озера' }; s.draw(); });
    }
    await page.waitForTimeout(750);
    const screenshot = await page.screenshot({ type: 'png', scale: 'css' });
    const starR = result.layout.starRadius;
    const starX = result.layout.contentX;
    const starY = result.starY;
    const areas = { title: title.bounds, time: time.bounds, button: result.button };
    for (let i = -1; i <= 1; i++) areas[`star${i + 2}`] = {
      x: starX + i * starR * 2.6 - starR / 2, y: starY - starR / 2, width: starR, height: starR,
    };
    const pixels = await visibleGoldPixels(page, screenshot, areas);
    assert.ok(pixels.title > 10 && pixels.time > 10 && pixels.button > 100, JSON.stringify(pixels));
    for (let i = 1; i <= 3; i++) assert.ok(pixels[`star${i}`] > 3, JSON.stringify(pixels));
    if (screenshots) await page.screenshot({ path: `${screenshots}/victory-${width}x${height}.jpg`, type: 'jpeg', quality: 88, scale: 'css' });
    if (details && width === 390) {
      await page.screenshot({ path: `${details}/victory-stars-390x844.png`, clip: { x: 70, y: 75, width: 250, height: 78 }, scale: 'device' });
      await page.screenshot({ path: `${details}/victory-frame-390x844.png`, clip: { x: 0, y: 124, width, height: 60 }, scale: 'device' });
    }
    if (width === 390 && task19VariantDir) {
      mkdirSync(task19VariantDir, { recursive: true });
      for (const [earned, elapsedMs] of [[1, 200000], [2, 120000], [3, result.completedMs]]) {
        await page.evaluate(ms => { const scene = window.__mysticGame.scene.getScene('puzzle');
          scene.completedMs = ms; scene.victoryAwardStartedAt = performance.now() - 1500; scene.draw(); }, elapsedMs);
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const frame = await page.screenshot({ path: `${task19VariantDir}/stars-${earned}.png`, scale: 'css' });
        const counts = await filledAwardPixels(page, frame, result.layout, result.starY);
        for (let index = 0; index < 3; index++)
          assert.ok(index < earned ? counts[index] > 10 : counts[index] < 6,
            `${earned} earned stars: visible fill ${counts}`);
      }
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const redraw = await page.evaluate(ms => { const scene = window.__mysticGame.scene.getScene('puzzle');
        scene.completedMs = ms; scene.victoryAwardStartedAt = performance.now(); scene.draw();
        const count = scene.children.list.length; scene.draw();
        return { before: count, after: scene.children.list.length, startedAt: scene.victoryAwardStartedAt,
          reduced: matchMedia('(prefers-reduced-motion: reduce)').matches }; }, result.completedMs);
      assert.equal(redraw.before, redraw.after);
      assert.ok(redraw.startedAt > 0 && redraw.reduced);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const reducedFrame = await page.screenshot({ path: `${task19VariantDir}/stars-reduced-motion.png`, scale: 'css' });
      const reducedCounts = await filledAwardPixels(page, reducedFrame, result.layout, result.starY);
      assert.ok(reducedCounts.every(count => count > 10), `reduced motion: visible fill ${reducedCounts}`);
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await page.evaluate(ms => { const scene = window.__mysticGame.scene.getScene('puzzle');
        scene.completedMs = ms; scene.victoryAwardStartedAt = performance.now() - 1500; scene.draw(); }, result.completedMs);
    }
    if (width === 390) {
      await page.evaluate(() => { document.documentElement.style.setProperty('--safe-top', '47px');
        document.documentElement.style.setProperty('--safe-bottom', '34px'); });
      await page.setViewportSize({ width: 360, height: 640 });
      await page.waitForFunction(() => window.__mysticGame.scene.getScene('puzzle').viewWidth() === 360);
      const resized = await page.evaluate(() => { const s = window.__mysticGame.scene.getScene('puzzle');
        return { layout: s.victoryScreenLayout(), image: s.completeImage?.getBounds(),
          texts: s.children.list.filter(c => c.getData('uiText')).map(c => c.text) }; });
      assert.ok(resized.layout.picture.y >= 47);
      assert.ok(resized.layout.button.y + resized.layout.button.height <= 606);
      assert.ok(resized.texts.includes('Картина собрана!') && resized.texts.includes('Далее'));
      await page.evaluate(() => { document.documentElement.style.removeProperty('--safe-top');
        document.documentElement.style.removeProperty('--safe-bottom'); });
      await page.setViewportSize({ width, height });
      await page.waitForFunction(() => window.__mysticGame.scene.getScene('puzzle').viewWidth() === 390);
      await page.setViewportSize({ width: 844, height: 390 });
      await page.waitForFunction(() => window.__mysticGame.scene.getScene('puzzle').viewWidth() <= 390 * 9 / 16 + 1);
      const landscape = await page.evaluate(() => { const scene = window.__mysticGame.scene.getScene('puzzle');
        return { picture: scene.completeImage?.getBounds(), button: scene.nextButton(),
          viewWidth: scene.viewWidth(), scrollWidth: document.documentElement.scrollWidth }; });
      assert.ok(inside(landscape.picture, { x: 0, y: 0, width: landscape.viewWidth, height: 390 }));
      assert.ok(inside(landscape.button, { x: 0, y: 0, width: landscape.viewWidth, height: 390 }));
      assert.ok(!overlaps(landscape.picture, landscape.button));
      assert.equal(landscape.scrollWidth, 844);
      await page.setViewportSize({ width, height });
      await page.waitForFunction(() => window.__mysticGame.scene.getScene('puzzle').viewWidth() === 390);
      const other = await context.newPage(); await other.bringToFront(); await page.waitForTimeout(100);
      await page.bringToFront(); await other.close();
      assert.equal(await page.evaluate(() => window.__mysticGame.scene.getScene('puzzle').mode), 'complete');
    }
    const next = await page.evaluate(() => window.__mysticGame.scene.getScene('puzzle').nextButton());
    const nextScreen = await screenPoint(page, { x: next.x + next.width / 2, y: next.y + next.height / 2 });
    if (mobile) await page.touchscreen.tap(nextScreen.x, nextScreen.y);
    else await page.mouse.click(nextScreen.x, nextScreen.y);
    await page.waitForFunction(() => { const s = window.__mysticGame.scene.getScene('puzzle');
      return s.mode === 'game' && s.level.id === 2; });
    await page.reload();
    await page.waitForFunction(() => window.__mysticGame?.scene?.getScene('puzzle')?.menuArt?.active);
    const saved = await page.evaluate(() => { const s = window.__mysticGame.scene.getScene('puzzle');
      return { progress: s.progress.completed, result: s.results[1] }; });
    assert.ok(saved.progress.includes(1) && saved.result.bestMs > 0 && saved.result.stars >= 1);
    if (width === 390) {
      const galleryButton = await page.evaluate(() => { const b = window.__mysticGame.scene.getScene('puzzle').galleryButton();
        return { x: b.centerX, y: b.centerY }; });
      await page.touchscreen.tap(galleryButton.x, galleryButton.y);
      await page.waitForFunction(() => window.__mysticGame.scene.getScene('puzzle').mode === 'gallery');
      assert.equal(await page.locator('#build-version').count(), 0);
      const back = await page.evaluate(() => { const b = window.__mysticGame.scene.getScene('puzzle').backButton();
        return { x: b.x, y: b.y }; });
      await page.touchscreen.tap(back.x, back.y);
      const levelButton = await page.evaluate(() => { const b = window.__mysticGame.scene.getScene('puzzle').levelsButton();
        return { x: b.centerX, y: b.centerY }; });
      await page.touchscreen.tap(levelButton.x, levelButton.y);
      const firstCard = await page.evaluate(() => { const b = window.__mysticGame.scene.getScene('puzzle').cardRects()[0];
        return { x: b.centerX, y: b.centerY }; });
      await page.touchscreen.tap(firstCard.x, firstCard.y);
      await page.waitForFunction(() => window.__mysticGame.scene.getScene('puzzle').pieces.length === 4);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      for (const id of ids) {
        const { start, target } = await dragCoordinates(page, id);
        await drag(page, cdp, start, target);
        await page.waitForFunction(pieceId => window.__mysticGame.scene.getScene('puzzle').pieces.find(p => p.id === pieceId).placed, id);
        if (id !== ids.at(-1)) await page.waitForTimeout(310);
      }
      await page.waitForFunction(() => window.__mysticGame.scene.getScene('puzzle').mode === 'complete');
      const staticVictory = await page.evaluate(() => { const scene = window.__mysticGame.scene.getScene('puzzle');
        return { reveal: scene.revealImage, button: scene.nextButton(),
          labels: scene.children.list.filter(c => c.getData('uiText')).map(c => c.text) }; });
      assert.equal(staticVictory.reveal, null);
      assert.ok(staticVictory.labels.includes('Картина собрана!') && staticVictory.labels.includes('Далее'));
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      if (task19VariantDir) {
        const staticFrame = await page.screenshot({ path: `${task19VariantDir}/real-completion-reduced-motion.png`, scale: 'css' });
        const staticCounts = await filledAwardPixels(page, staticFrame, result.layout,
          await page.evaluate(() => window.__mysticGame.scene.getScene('puzzle').victoryStarY));
        assert.ok(staticCounts.every(count => count > 10), `real reduced-motion completion: ${staticCounts}`);
      }
      const replay = await page.evaluate(() => window.__mysticGame.scene.getScene('puzzle').results[1]);
      assert.ok(replay.bestMs <= saved.result.bestMs && replay.stars >= saved.result.stars);
      const victoryGallery = await page.evaluate(() => { const b = window.__mysticGame.scene.getScene('puzzle').hintButton();
        return { x: b.x, y: b.y }; });
      await page.touchscreen.tap(victoryGallery.x, victoryGallery.y);
      await page.waitForFunction(() => window.__mysticGame.scene.getScene('puzzle').mode === 'gallery');
      await page.emulateMedia({ reducedMotion: 'no-preference' });
    }
    assert.deepEqual(errors, []);
    return { size: `${width}x${height}`, elapsedMs: Math.round(result.completedMs), stars: result.stars,
      picture, button: result.button, pixels, saved, errors };
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
