import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const phase = process.env.COLLECTION_CAPTURE_PHASE || 'after';
const output = `docs/screenshots/gallery-completion-polish/${phase}`;
const port = 4193;
const base = `http://127.0.0.1:${port}/`;
mkdirSync(output, { recursive: true });
const server = spawn(process.execPath,
  ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { stdio: 'ignore' });
async function ready() {
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(base)).ok) return; } catch { /* Starting. */ }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw Error('Vite did not start');
}
async function point(page, x, y) {
  return page.evaluate(({ x, y }) => {
    const s = window.__mysticGame.scene.getScene('puzzle');
    const r = document.querySelector('#game canvas').getBoundingClientRect();
    return { x: r.left + x * r.width / s.viewWidth(), y: r.top + y * r.height / s.viewHeight() };
  }, { x, y });
}
async function tap(page, x, y, mobile) {
  const p = await point(page, x, y);
  if (mobile) await page.touchscreen.tap(p.x, p.y);
  else await page.mouse.click(p.x, p.y);
}
async function tapControl(page, name, mobile) {
  const p = await page.evaluate(name => {
    const r = window.__mysticGame.scene.getScene('puzzle')[name]();
    return { x: r.centerX ?? r.x, y: r.centerY ?? r.y };
  }, name);
  await tap(page, p.x, p.y, mobile);
}
async function pickup(page, id) {
  return page.evaluate(id => {
    const s = window.__mysticGame.scene.getScene('puzzle');
    const piece = s.pieces.find(p => p.id === id), sprite = piece.sprite;
    const higher = s.pieces.filter(p => p !== piece && !p.placed && p.sprite.depth > sprite.depth);
    let best = null, distance = Infinity;
    for (let y = sprite.y - sprite.displayHeight / 2 + 5; y < sprite.y + sprite.displayHeight / 2 - 5; y += 3)
      for (let x = sprite.x - sprite.displayWidth / 2 + 5; x < sprite.x + sprite.displayWidth / 2 - 5; x += 3) {
        if (!s.pieceContains(piece, x, y) || higher.some(p => s.pieceContains(p, x, y))) continue;
        const d = (x - sprite.x) ** 2 + (y - sprite.y) ** 2;
        if (d < distance) { best = { x, y }; distance = d; }
      }
    if (!best) throw Error(`No touch point for piece ${id}`);
    return { start: best, target: { x: best.x + piece.home.x - sprite.x,
      y: best.y + piece.home.y - sprite.y } };
  }, id);
}
async function drag(page, cdp, id) {
  const p = await pickup(page, id), start = await point(page, p.start.x, p.start.y);
  const target = await point(page, p.target.x, p.target.y);
  if (cdp) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...start, id: 1 }] });
    for (let i = 1; i <= 9; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{
        x: start.x + (target.x - start.x) * i / 9,
        y: start.y + (target.y - start.y) * i / 9, id: 1 }] });
      await page.waitForTimeout(12);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    await page.mouse.move(start.x, start.y); await page.mouse.down();
    await page.mouse.move(target.x, target.y, { steps: 9 }); await page.mouse.up();
  }
  await page.waitForFunction(id => window.__mysticGame.scene.getScene('puzzle').pieces.find(p => p.id === id)?.placed, id);
  await page.waitForTimeout(270);
}
async function complete(browser, width, height, level) {
  const mobile = width < 900;
  const context = await browser.newContext({ viewport: { width, height }, isMobile: mobile, hasTouch: mobile });
  await context.addInitScript(level => {
    if (level > 1 && !localStorage.getItem('mystic-puzzles-v1')) localStorage.setItem('mystic-puzzles-v1', JSON.stringify({
      version: 1, completed: Array.from({ length: level - 1 }, (_, i) => i + 1), currentLevel: level }));
  }, level);
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
  try {
    await page.goto(base);
    await page.waitForFunction(() => window.__mysticGame?.scene?.getScene('puzzle')?.menuArt?.active);
    await tapControl(page, 'menuButton', mobile);
    await page.waitForFunction(level => { const s = window.__mysticGame.scene.getScene('puzzle');
      return s.mode === 'game' && s.level.id === level && s.pieces.length === s.level.pieces; }, level);
    const ids = await page.evaluate(() => window.__mysticGame.scene.getScene('puzzle').pieces.map(p => p.id).sort((a, b) => b - a));
    const cdp = mobile ? await context.newCDPSession(page) : null;
    for (const id of ids) await drag(page, cdp, id);
    await page.waitForFunction(() => window.__mysticGame.scene.getScene('puzzle').mode === 'complete');
    await page.waitForTimeout(1100);
    const result = await page.evaluate(() => { const s = window.__mysticGame.scene.getScene('puzzle');
      return { id: s.level.id, stars: s.results[s.level.id]?.stars,
        progress: s.progress.completed, picture: s.completeImage?.getBounds(),
        button: s.nextButton(), labels: s.children.list.filter(c => c.getData('uiText')).map(c => c.text),
        scrollWidth: document.documentElement.scrollWidth };
    });
    assert.equal(result.id, level); assert.equal(result.progress.at(-1), level);
    assert.equal(result.scrollWidth, width); assert.ok(result.picture?.width > 180);
    assert.ok(result.stars >= 1 && result.stars <= 3);
    if (phase === 'after') assert.ok(result.labels.includes(level === 25
      ? 'Все 25 картин собраны!' : 'Пазл собран!'));
    if (level === 25) assert.ok(result.labels.includes('В галерею'));
    await page.screenshot({ path: `${output}/victory-${level}-${width}x${height}.png` });
    await tapControl(page, 'nextButton', mobile);
    await page.waitForFunction(level => { const s = window.__mysticGame.scene.getScene('puzzle');
      return level === 25 ? s.mode === 'gallery' : s.mode === 'game' && s.level.id === level + 1; }, level);
    if (level === 25 && phase === 'after') {
      const gallery = await page.evaluate(() => { const s = window.__mysticGame.scene.getScene('puzzle');
        return { labels: s.children.list.filter(c => c.getData('uiText')).map(c => c.text),
          art: s.galleryLayer.list.filter(item => item.texture).map(item => item.texture.key) }; });
      assert.ok(gallery.labels.includes('Открыто 25 из 25'));
      assert.ok(gallery.art.includes('art-25'));
    }
    await page.reload();
    await page.waitForFunction(() => window.__mysticGame?.scene?.getScene('puzzle')?.menuArt?.active);
    const saved = await page.evaluate(level => { const s = window.__mysticGame.scene.getScene('puzzle');
      return { completed: s.progress.completed.includes(level), result: s.results[level] }; }, level);
    assert.ok(saved.completed && saved.result?.bestMs > 0 && saved.result.stars === result.stars);
    assert.deepEqual(errors, []);
    return `${level} at ${width}x${height}, ${ids.length} pieces`;
  } finally { await context.close(); }
}
async function gallery(browser, width, height) {
  const mobile = width < 900;
  const context = await browser.newContext({ viewport: { width, height }, isMobile: mobile, hasTouch: mobile });
  await context.addInitScript(() => {
    if (!localStorage.getItem('mystic-puzzles-v1')) localStorage.setItem('mystic-puzzles-v1', JSON.stringify({
      version: 1, completed: [1, 2, 3, 4, 5], currentLevel: 6 }));
  });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
  try {
    await page.goto(base);
    await page.waitForFunction(() => window.__mysticGame?.scene?.getScene('puzzle')?.menuArt?.active);
    await tapControl(page, 'galleryButton', mobile);
    await page.waitForFunction(() => window.__mysticGame.scene.getScene('puzzle').mode === 'gallery');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
    if (phase === 'after') {
      const labels = await page.evaluate(() => window.__mysticGame.scene.getScene('puzzle').children.list
        .filter(c => c.getData('uiText')).map(c => c.text));
      assert.ok(labels.includes('Открыто 5 из 25'));
    }
    await page.screenshot({ path: `${output}/gallery-${width}x${height}.png` });
    if (phase === 'after' && width === 375) {
      const safe = await page.evaluate(() => {
        document.documentElement.style.setProperty('--safe-top', '44px');
        document.documentElement.style.setProperty('--safe-bottom', '34px');
        const s = window.__mysticGame.scene.getScene('puzzle'); s.draw();
        return { top: s.galleryGridLayout().top, bottom: s.galleryGridLayout().bottom,
          backY: s.backButton().y };
      });
      assert.ok(safe.top >= 152 && safe.bottom <= height - 34 && safe.backY >= 69);
      await page.evaluate(() => {
        document.documentElement.style.removeProperty('--safe-top');
        document.documentElement.style.removeProperty('--safe-bottom');
        window.__mysticGame.scene.getScene('puzzle').draw();
      });
    }
    const locked = await page.evaluate(() => { const r = window.__mysticGame.scene.getScene('puzzle').cardRects()[5];
      return { x: r.centerX, y: r.centerY }; });
    if (locked.y < height - 10) {
      await tap(page, locked.x, locked.y, mobile);
      assert.equal(await page.evaluate(() => window.__mysticGame.scene.getScene('puzzle').mode), 'gallery');
    }
    const first = await page.evaluate(() => { const r = window.__mysticGame.scene.getScene('puzzle').cardRects()[0];
      return { x: r.centerX, y: r.centerY }; });
    await tap(page, first.x, first.y, mobile);
    await page.waitForFunction(() => window.__mysticGame.scene.getScene('puzzle').mode === 'view');
    await page.waitForFunction(() => window.__mysticGame.scene.getScene('puzzle').textures.exists('full-art-1'));
    await page.waitForFunction(() => window.__mysticGame.scene.getScene('puzzle').uiImages
      .some(image => image.texture?.key === 'full-art-1'));
    if (phase === 'after') {
      const art = await page.evaluate(() => { const s = window.__mysticGame.scene.getScene('puzzle');
        const image = s.uiImages.find(image => image.texture?.key === 'full-art-1');
        const source = image.texture.getSourceImage();
        return { ratio: image.displayWidth / image.displayHeight, original: source.width / source.height,
          bounds: image.getBounds() }; });
      assert.ok(Math.abs(art.ratio - art.original) < .002);
      assert.ok(art.bounds.x >= -.5 && art.bounds.y >= -.5
        && art.bounds.x + art.bounds.width <= width + .5
        && art.bounds.y + art.bounds.height <= height + .5, JSON.stringify(art));
    }
    await page.screenshot({ path: `${output}/view-${width}x${height}.png` });
    await tapControl(page, 'backButton', mobile);
    assert.equal(await page.evaluate(() => window.__mysticGame.scene.getScene('puzzle').mode), 'gallery');
    if (mobile) {
      const cdp = await context.newCDPSession(page);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: width / 2, y: height * .78, id: 1 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: width / 2, y: height * .25, id: 1 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      assert.equal(await page.evaluate(() => window.__mysticGame.scene.getScene('puzzle').mode), 'gallery');
      await page.screenshot({ path: `${output}/gallery-scrolled-${width}x${height}.png` });
    } else {
      await page.mouse.wheel(0, 480);
      await page.screenshot({ path: `${output}/gallery-scrolled-${width}x${height}.png` });
    }
    const lockedAfterScroll = await page.evaluate(() => { const s = window.__mysticGame.scene.getScene('puzzle');
      const r = s.cardRects()[5], grid = s.galleryGridLayout();
      return { x: r.centerX, y: r.centerY, top: grid.top, bottom: grid.bottom,
        imageKeys: s.galleryLayer.list.filter(item => item.texture).map(item => item.texture.key) }; });
    assert.ok(!lockedAfterScroll.imageKeys.includes('art-6'));
    if (phase === 'after') assert.ok(await page.evaluate(() =>
      window.__mysticGame.scene.getScene('puzzle').galleryScrollRow > 0));
    if (lockedAfterScroll.y > lockedAfterScroll.top && lockedAfterScroll.y < lockedAfterScroll.bottom) {
      await tap(page, lockedAfterScroll.x, lockedAfterScroll.y, mobile);
      assert.equal(await page.evaluate(() => window.__mysticGame.scene.getScene('puzzle').mode), 'gallery');
    }
    if (phase === 'after' && width === 390) {
      const end = await page.evaluate(() => { const s = window.__mysticGame.scene.getScene('puzzle');
        const grid = s.galleryGridLayout(); s.scrollGallery(grid.maxScrollRow * grid.rowStep);
        const last = s.cardRects().at(-1), final = s.galleryGridLayout();
        return { bottom: last.bottom, limit: final.bottom, top: last.top, start: final.top };
      });
      assert.ok(end.bottom <= end.limit + 1 && end.top >= end.start - 1);
    }
    assert.deepEqual(errors, []);
    return `${width}x${height}`;
  } finally { await context.close(); }
}
await ready();
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ||
  (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined), headless: true,
args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader'] });
try {
  const report = [];
  for (const [width, height, level] of [[320, 568, 1], [375, 667, 1], [390, 844, 13],
    [430, 932, 25], [1366, 768, 1], [1920, 1080, 1]]
    .filter(([, , level]) => !process.env.COLLECTION_LEVELS || process.env.COLLECTION_LEVELS.split(',').includes(String(level))))
    report.push(await complete(browser, width, height, level));
  for (const [width, height] of [[320, 568], [375, 667], [390, 844], [430, 932], [1366, 768], [1920, 1080]]
    .filter(([width]) => !process.env.COLLECTION_GALLERY_WIDTHS || process.env.COLLECTION_GALLERY_WIDTHS.split(',').includes(String(width))))
    report.push(`gallery ${await gallery(browser, width, height)}`);
  console.log(`${phase}: ${report.join('; ')}`);
} finally { await browser.close(); server.kill(); }
