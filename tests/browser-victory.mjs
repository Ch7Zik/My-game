import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const port = 4177;
const base = `http://127.0.0.1:${port}/`;
const screenshots = process.env.VICTORY_SCREENSHOT_DIR;
const allSizes = [[360, 640], [390, 844], [430, 932], [1920, 1080]];
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
    const counts = {};
    for (const [name, rect] of Object.entries(areas)) {
      const x = Math.max(0, Math.floor(rect.x)), y = Math.max(0, Math.floor(rect.y));
      const width = Math.min(image.width - x, Math.ceil(rect.width));
      const height = Math.min(image.height - y, Math.ceil(rect.height));
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
    if (width === 360) {
      const originalTitle = await page.evaluate(() => {
        const scene = window.__mysticGame.scene.getScene('puzzle');
        const original = scene.level.title;
        scene.level = { ...scene.level, title: 'Необычайно длинное название волшебной картины среди далёких гор' };
        scene.draw();
        return original;
      });
      const longTitle = await page.evaluate(() => {
        const scene = window.__mysticGame.scene.getScene('puzzle');
        const label = scene.children.list.find(child => child.getData('uiText') && child.text.includes('Необычайно'));
        return { bounds: label?.getBounds(), text: label?.text, back: scene.backButton(), hint: scene.hintButton(), picture: scene.board };
      });
      assert.ok(longTitle.text.endsWith('…'));
      assert.ok(longTitle.bounds.x > longTitle.back.x + 20);
      assert.ok(longTitle.bounds.x + longTitle.bounds.width < longTitle.hint.x - 20);
      assert.ok(longTitle.bounds.y + longTitle.bounds.height < longTitle.picture.y);
      await page.evaluate(title => {
        const scene = window.__mysticGame.scene.getScene('puzzle');
        scene.level = { ...scene.level, title }; scene.draw();
      }, originalTitle);
    }
    const cdp = mobile ? await context.newCDPSession(page) : null;
    const ids = await page.evaluate(() => window.__mysticGame.scene.getScene('puzzle').pieces.map(piece => piece.id).sort((a, b) => b - a));
    for (const id of ids) {
      const { start, target } = await dragCoordinates(page, id);
      await drag(page, cdp, start, target);
      await page.waitForFunction(pieceId => window.__mysticGame.scene.getScene('puzzle').pieces.find(piece => piece.id === pieceId).placed, id);
      if (id !== ids.at(-1)) await page.waitForTimeout(310);
    }
    await page.waitForFunction(() => window.__mysticGame.scene.getScene('puzzle').mode === 'complete');
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const result = await page.evaluate(isMobile => {
      const scene = window.__mysticGame.scene.getScene('puzzle');
      const labels = scene.children.list.filter(child => child.getData('uiText')).map(child => ({
        text: child.text, x: child.x, y: child.y, width: child.width, height: child.height,
        visible: child.visible, active: child.active, alpha: child.alpha, depth: child.depth,
        bounds: child.getBounds(),
      }));
      const log = JSON.parse(localStorage.getItem('mystic-puzzles-victory-log-v1') || '[]');
      return { mode: scene.mode, completedMs: scene.completedMs, stars: scene.results[1]?.stars,
        button: scene.nextButton(), picture: scene.victoryPictureRect(),
        layout: isMobile ? scene.victoryMobileLayout() : null,
        card: isMobile ? null : scene.victoryCard(),
        completeImage: { visible: scene.completeImage?.visible, alpha: scene.completeImage?.alpha,
          bounds: scene.completeImage?.getBounds(), depth: scene.completeImage?.depth },
        chrome: { visible: scene.chrome.visible, alpha: scene.chrome.alpha, depth: scene.chrome.depth },
        labels, log,
        progress: scene.progress.completed, scrollWidth: document.documentElement.scrollWidth,
        badge: document.getElementById('build-version')?.textContent };
    }, mobile);
    assert.equal(result.mode, 'complete');
    assert.ok(result.completedMs > 0);
    assert.ok(result.stars >= 1 && result.stars <= 3);
    assert.ok(result.progress.includes(1));
    const title = result.labels.find(label => label.text === 'Картина собрана!');
    const time = result.labels.find(label => label.text === `Время ${String(Math.floor(result.completedMs / 60000)).padStart(2, '0')}:${String(Math.floor(result.completedMs / 1000) % 60).padStart(2, '0')}`);
    const nextLabel = result.labels.find(label => label.text === 'Далее');
    for (const label of [title, time, nextLabel]) {
      assert.ok(label?.visible && label.active && label.alpha === 1 && label.depth > result.completeImage.depth);
      assert.ok(inside(label.bounds, { x: 0, y: 0, width, height }));
    }
    assert.ok(result.completeImage.visible && result.completeImage.alpha === 1);
    assert.ok(result.chrome.visible && result.chrome.alpha === 1 && result.chrome.depth > result.completeImage.depth);
    assert.ok(inside(result.completeImage.bounds, { x: 0, y: 0, width, height }));
    assert.ok(Math.abs(result.completeImage.bounds.width - result.picture.width) < 1);
    assert.ok(Math.abs(result.completeImage.bounds.height - result.picture.height) < 1);
    assert.ok(result.log.some(entry => entry.event === 'result-saved'));
    assert.ok(result.log.some(entry => entry.event === 'ui-drawn'));
    assert.ok(result.badge?.includes('Победа-2'));
    if (mobile) {
      assert.ok(result.button.y >= result.picture.y + result.picture.height + 8);
      assert.ok(inside(title.bounds, result.layout.results));
      assert.ok(inside(time.bounds, result.layout.results));
      assert.ok(inside(nextLabel.bounds, result.button));
      assert.ok(!overlaps(title.bounds, time.bounds));
      assert.ok(!overlaps(time.bounds, result.button));
      assert.ok(!overlaps(result.layout.results, result.picture));
    } else {
      assert.ok(inside(title.bounds, result.card));
      assert.ok(inside(time.bounds, result.card));
      assert.ok(inside(nextLabel.bounds, result.button));
      assert.ok(!overlaps(result.card, result.picture));
    }
    assert.ok(result.button.y + result.button.height <= height);
    assert.equal(result.scrollWidth, width);
    assert.deepEqual(errors, []);
    const starsX = mobile ? width / 2 + 78 : result.card.x + result.card.width / 2;
    const starsY = mobile ? result.layout.detailsY : result.card.y + 88;
    const starRadius = mobile ? result.layout.compact ? 7 : 8 : 12;
    const areas = { title: title.bounds, time: time.bounds, button: result.button };
    for (let star = -1; star <= 1; star++) areas[`star${star + 2}`] = {
      x: starsX + star * starRadius * 2.6 - starRadius / 2,
      y: starsY - starRadius / 2, width: starRadius, height: starRadius,
    };
    const screenshot = await page.screenshot({ type: 'png' });
    const pixels = await visibleGoldPixels(page, screenshot, areas);
    assert.ok(pixels.title > 10 && pixels.time > 10 && pixels.button > 100, JSON.stringify(pixels));
    for (let star = 1; star <= 3; star++) assert.ok(pixels[`star${star}`] > 3, JSON.stringify(pixels));
    if (screenshots) {
      mkdirSync(screenshots, { recursive: true });
      await page.screenshot({ path: `${screenshots}/victory-${width}x${height}.jpg`, type: 'jpeg', quality: 88 });
    }
    if (width === 390) {
      await page.evaluate(() => {
        document.documentElement.style.setProperty('--safe-top', '47px');
        document.documentElement.style.setProperty('--safe-bottom', '34px');
      });
      await page.setViewportSize({ width: 360, height: 640 });
      await page.waitForFunction(() => window.__mysticGame.scene.getScene('puzzle').viewWidth() === 360);
      const resized = await page.evaluate(() => {
        const scene = window.__mysticGame.scene.getScene('puzzle');
        return { mode: scene.mode, layout: scene.victoryMobileLayout(),
          texts: scene.children.list.filter(child => child.getData('uiText')).map(child => child.text),
          complete: scene.completeImage?.visible };
      });
      assert.equal(resized.mode, 'complete');
      assert.ok(resized.complete && resized.texts.includes('Картина собрана!') && resized.texts.includes('Далее'));
      assert.ok(resized.layout.picture.y >= 107);
      assert.ok(resized.layout.button.y + resized.layout.button.height <= 640 - 34);
      await page.evaluate(() => {
        document.documentElement.style.removeProperty('--safe-top');
        document.documentElement.style.removeProperty('--safe-bottom');
      });
      await page.setViewportSize({ width, height });
      await page.waitForFunction(() => window.__mysticGame.scene.getScene('puzzle').viewWidth() === 390);
      await page.waitForFunction(() => {
        const rect = document.querySelector('canvas')?.getBoundingClientRect();
        return rect && Math.abs(rect.width - innerWidth) < 2 && Math.abs(rect.height - innerHeight) < 2;
      });
      const otherPage = await context.newPage();
      await otherPage.bringToFront();
      await page.waitForTimeout(150);
      await page.bringToFront();
      await otherPage.close();
      assert.equal(await page.evaluate(() => window.__mysticGame.scene.getScene('puzzle').mode), 'complete');
    }
    const next = width === 390 ? await page.evaluate(() => window.__mysticGame.scene.getScene('puzzle').nextButton()) : result.button;
    if (mobile) await page.touchscreen.tap(next.x + next.width / 2, next.y + next.height / 2);
    else await page.mouse.click(next.x + next.width / 2, next.y + next.height / 2);
    await page.waitForTimeout(350);
    const afterTap = await page.evaluate(() => {
      const scene = window.__mysticGame.scene.getScene('puzzle');
      return { mode: scene.mode, level: scene.level.id, button: scene.nextButton(),
        canvas: document.querySelector('canvas')?.getBoundingClientRect(),
        viewport: { width: innerWidth, height: innerHeight },
        log: JSON.parse(localStorage.getItem('mystic-puzzles-victory-log-v1') || '[]').slice(-3) };
    });
    assert.ok(afterTap.mode === 'game' && afterTap.level === 2, JSON.stringify(afterTap));
    await page.reload();
    await page.waitForFunction(() => window.__mysticGame?.scene?.getScene('puzzle')?.menuArt?.active);
    const saved = await page.evaluate(() => ({
      progress: window.__mysticGame.scene.getScene('puzzle').progress.completed,
      result: window.__mysticGame.scene.getScene('puzzle').results[1],
    }));
    assert.ok(saved.progress.includes(1));
    assert.ok(saved.result.bestMs > 0);
    assert.ok(saved.result.stars >= 1 && saved.result.stars <= 3);
    if (width === 390) {
      const levelButton = await page.evaluate(() => {
        const rect = window.__mysticGame.scene.getScene('puzzle').levelsButton();
        return { x: rect.centerX, y: rect.centerY };
      });
      await page.touchscreen.tap(levelButton.x, levelButton.y);
      const firstCard = await page.evaluate(() => {
        const rect = window.__mysticGame.scene.getScene('puzzle').cardRects()[0];
        return { x: rect.centerX, y: rect.centerY };
      });
      await page.touchscreen.tap(firstCard.x, firstCard.y);
      await page.waitForFunction(() => window.__mysticGame.scene.getScene('puzzle').pieces.length === 4);
      for (const id of ids) {
        const { start, target } = await dragCoordinates(page, id);
        await drag(page, cdp, start, target);
        await page.waitForFunction(pieceId => window.__mysticGame.scene.getScene('puzzle').pieces.find(piece => piece.id === pieceId).placed, id);
        if (id !== ids.at(-1)) await page.waitForTimeout(310);
      }
      await page.waitForFunction(() => window.__mysticGame.scene.getScene('puzzle').mode === 'complete');
      const replay = await page.evaluate(() => window.__mysticGame.scene.getScene('puzzle').results[1]);
      assert.ok(replay.bestMs <= saved.result.bestMs);
      assert.ok(replay.stars >= saved.result.stars);
    }
    assert.deepEqual(errors, []);
    return { size: `${width}x${height}`, elapsedMs: Math.round(result.completedMs), stars: result.stars,
      button: result.button, picture: result.picture, layout: result.layout, pixels,
      badge: result.badge, saved, errors };
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
