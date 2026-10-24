import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const port = 4191;
const base = process.env.PUZZLE_URL || `http://127.0.0.1:${port}/`;
const phase = process.env.PUZZLE_CAPTURE_PHASE || 'after';
const output = `docs/screenshots/puzzle-screen-polish/${phase}`;
mkdirSync(output, { recursive: true });
const server = process.env.PUZZLE_URL ? null : spawn(process.execPath,
  ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { stdio: 'ignore' });
async function ready() {
  for (let attempt = 0; attempt < 100; attempt++) {
    try { if ((await fetch(base)).ok) return; } catch { /* Vite is starting. */ }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw Error('Puzzle screen server did not start');
}

async function screenPoint(page, x, y) {
  return page.evaluate(({ x, y }) => {
    const scene = window.__mysticGame.scene.getScene('puzzle');
    const frame = document.querySelector('#game canvas').getBoundingClientRect();
    return { x: frame.left + x * frame.width / scene.viewWidth(),
      y: frame.top + y * frame.height / scene.viewHeight() };
  }, { x, y });
}
async function control(page, name) {
  const center = await page.evaluate(name => {
    const shape = window.__mysticGame.scene.getScene('puzzle')[name]();
    return { x: shape.centerX ?? shape.x, y: shape.centerY ?? shape.y };
  }, name);
  const p = await screenPoint(page, center.x, center.y);
  if (page.viewportSize().width < 900) await page.touchscreen.tap(p.x, p.y);
  else await page.mouse.click(p.x, p.y);
}
async function pickup(page, id) {
  return page.evaluate(pieceId => {
    const scene = window.__mysticGame.scene.getScene('puzzle');
    const piece = scene.pieces.find(item => item.id === pieceId), sprite = piece.sprite;
    const above = scene.pieces.filter(item => item !== piece && item.sprite.depth > sprite.depth && item.sprite.visible);
    let best = null, distance = Infinity;
    for (let y = sprite.y - sprite.displayHeight / 2 + 5; y < sprite.y + sprite.displayHeight / 2 - 5; y += 3)
      for (let x = sprite.x - sprite.displayWidth / 2 + 5; x < sprite.x + sprite.displayWidth / 2 - 5; x += 3) {
        if (!scene.pieceContains(piece, x, y) || above.some(item => scene.pieceContains(item, x, y))) continue;
        const d = (x - sprite.x) ** 2 + (y - sprite.y) ** 2;
        if (d < distance) { best = { x, y }; distance = d; }
      }
    if (!best) throw Error(`No touch point for piece ${pieceId}`);
    return { start: best, target: { x: best.x + piece.home.x - sprite.x,
      y: best.y + piece.home.y - sprite.y } };
  }, id);
}
async function drag(page, cdp, id, fast = false, captureHeld = false) {
  const p = await pickup(page, id);
  const start = await screenPoint(page, p.start.x, p.start.y);
  const target = await screenPoint(page, p.target.x, p.target.y);
  if (cdp) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...start, id: 1 }] });
    const count = fast ? 2 : 10;
    for (let i = 1; i <= count; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{
        x: start.x + (target.x - start.x) * i / count,
        y: start.y + (target.y - start.y) * i / count, id: 1 }] });
      if (captureHeld && i === 1) await page.screenshot({ path: `${output}/held-23-430x932.png` });
      if (!fast) await page.waitForTimeout(12);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(target.x, target.y, { steps: fast ? 2 : 10 });
    await page.mouse.up();
  }
  await page.waitForFunction(id => window.__mysticGame.scene.getScene('puzzle').pieces.find(p => p.id === id)?.placed, id);
  await page.waitForTimeout(270);
}
async function run(browser, width, height, level, partial) {
  const mobile = width < 900;
  const context = await browser.newContext({ viewport: { width, height }, isMobile: mobile, hasTouch: mobile });
  await context.addInitScript(level => {
    if (level > 1 && !localStorage.getItem('mystic-puzzles-v1')) localStorage.setItem('mystic-puzzles-v1', JSON.stringify({ version: 1,
      completed: Array.from({ length: level - 1 }, (_, i) => i + 1), currentLevel: level }));
  }, level);
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
  try {
    await page.goto(base);
    await page.waitForFunction(() => window.__mysticGame?.scene?.getScene('puzzle')?.menuArt?.active);
    await control(page, 'menuButton');
    const expected = level === 1 ? 10 : 22;
    await page.waitForFunction(expected => { const s = window.__mysticGame.scene.getScene('puzzle');
      return s.mode === 'game' && s.pieces.length === expected && s.menuArt?.visible === false; }, expected);
    await page.waitForTimeout(1100);
    const metrics = await page.evaluate(() => {
      const s = window.__mysticGame.scene.getScene('puzzle');
      return { level: s.level.id, count: s.pieces.length, board: s.board,
        back: s.backButton(), hint: s.hintButton(), width: document.documentElement.scrollWidth,
        labels: s.children.list.filter(c => c.getData('uiText')).map(c => c.text) };
    });
    assert.equal(metrics.level, level); assert.equal(metrics.count, expected);
    if (level === 23) assert.equal(await page.evaluate(() => window.__mysticGame.scene.getScene('puzzle').progress.completed.length), 22);
    assert.equal(metrics.width, width);
    assert.ok(metrics.board.x >= 0 && metrics.board.x + metrics.board.width <= (mobile ? width : height * 9 / 16) + 1);
    if (phase === 'after') assert.ok(metrics.labels.includes(`Собрано 0 / ${expected}`));
    await page.screenshot({ path: `${output}/start-${level}-${width}x${height}.png` });
    if (partial) {
      const cdp = mobile ? await context.newCDPSession(page) : null;
      for (const id of [9, 8, 7]) await drag(page, cdp, id, id === 8);
      await page.screenshot({ path: `${output}/partial-${level}-${width}x${height}.png` });
    }
    if (phase === 'after') {
      if (width === 375) {
        const safe = await page.evaluate(() => {
          document.documentElement.style.setProperty('--safe-top', '44px');
          document.documentElement.style.setProperty('--safe-bottom', '34px');
          const scene = window.__mysticGame.scene.getScene('puzzle');
          scene.layout(); scene.reflowPieces(); scene.draw();
          const back = scene.backButton(), hint = scene.hintButton();
          return { board: scene.board, backTop: back.y - back.radius, hintTop: hint.y - hint.radius,
            footer: scene.board.y + scene.board.height, height: scene.viewHeight() };
        });
        assert.ok(safe.backTop >= 44 && safe.hintTop >= 44 && safe.board.y >= 102, JSON.stringify(safe));
        assert.ok(safe.footer < safe.height - 34);
        await page.evaluate(() => {
          document.documentElement.style.setProperty('--safe-top', '0px');
          document.documentElement.style.setProperty('--safe-bottom', '0px');
          const scene = window.__mysticGame.scene.getScene('puzzle');
          scene.layout(); scene.reflowPieces(); scene.draw();
        });
      }
      await control(page, 'hintButton');
      assert.ok(await page.evaluate(() => window.__mysticGame.scene.getScene('puzzle').hintPiece?.id >= 0));
      if (level === 23) {
        const cdp = await context.newCDPSession(page);
        const p = await pickup(page, 21), start = await screenPoint(page, p.start.x, p.start.y);
        const shift = p.start.x < width / 2 ? 20 : -20;
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...start, id: 1 }] });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove',
          touchPoints: [{ x: start.x + shift, y: start.y, id: 1 }] });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        assert.equal(await page.evaluate(() => window.__mysticGame.scene.getScene('puzzle').pieces[21].placed), false);
        for (let id = 21; id >= 0; id--) {
          await drag(page, cdp, id, id % 4 === 0, id === 20);
          if (id === 11) await page.screenshot({ path: `${output}/partial-23-430x932.png` });
        }
        await page.waitForFunction(() => window.__mysticGame.scene.getScene('puzzle').mode === 'complete');
        await page.waitForTimeout(800);
        await page.screenshot({ path: `${output}/complete-23-430x932.png` });
        const saved = await page.evaluate(() => { const s = window.__mysticGame.scene.getScene('puzzle');
          return { level: s.level.id, progress: s.progress, storage: localStorage.getItem('mystic-puzzles-v1') }; });
        assert.ok(saved.progress.completed.includes(23), JSON.stringify(saved));
        await control(page, 'nextButton');
        await page.waitForFunction(() => { const s = window.__mysticGame.scene.getScene('puzzle');
          return s.mode === 'game' && s.level.id === 24 && s.pieces.length === 22; });
        await control(page, 'backButton');
        assert.equal(await page.evaluate(() => window.__mysticGame.scene.getScene('puzzle').mode), 'levels');
        await page.reload();
        await page.waitForFunction(() => window.__mysticGame?.scene?.getScene('puzzle')?.menuArt?.active);
        assert.ok(await page.evaluate(() => window.__mysticGame.scene.getScene('puzzle').progress.completed.includes(23)));
      } else {
        await control(page, 'backButton');
        assert.equal(await page.evaluate(() => window.__mysticGame.scene.getScene('puzzle').mode), 'levels');
      }
      assert.deepEqual(errors, []);
    }
    return `${width}x${height}: level ${level}, ${metrics.count} pieces`;
  } finally { await context.close(); }
}
await ready();
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined),
  headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader'] });
try {
  const report = [];
  for (const [width, height, level, partial] of [[320, 568, 1, false], [375, 667, 1, false],
    [390, 844, 1, true], [430, 932, 23, false], [1366, 768, 1, false], [1920, 1080, 1, false]]
    .filter(([width]) => !process.env.PUZZLE_CASE || String(width) === process.env.PUZZLE_CASE))
    report.push(await run(browser, width, height, level, partial));
  console.log(`${phase} puzzle screen: ${report.join('; ')}`);
} finally { await browser.close(); server?.kill(); }
