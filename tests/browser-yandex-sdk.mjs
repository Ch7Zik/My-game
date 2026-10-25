import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const root = resolve('dist'), prefix = '/nested/game/';
const output = 'docs/screenshots/yandex-games-release';
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp',
  '.ttf': 'font/ttf', '.svg': 'image/svg+xml', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg' };
const server = createServer(async (request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://local').pathname);
  if (!pathname.startsWith(prefix)) { response.writeHead(404).end(); return; }
  const file = resolve(root, pathname.slice(prefix.length) || 'index.html');
  if (!file.startsWith(`${root}/`)) { response.writeHead(403).end(); return; }
  try {
    const body = await readFile(file);
    response.writeHead(200, { 'content-type': types[file.slice(file.lastIndexOf('.'))] || 'application/octet-stream' }).end(body);
  } catch { response.writeHead(404).end(); }
});

const mockSdk = `(() => {
  const events = [], listeners = {};
  window.__sdkTest = { events, emit: name => listeners[name]?.() };
  window.YaGames = { init: async () => {
    events.push('init');
    return {
      features: {
        LoadingAPI: { ready: () => {
          if (!document.querySelector('#game canvas') ||
              !performance.getEntriesByType('resource').some(item => item.name.endsWith('/assets/menu-alchemist.webp')))
            throw Error('ready before the menu was loaded');
          events.push('ready');
        } },
        GameplayAPI: { start: () => events.push('start'), stop: () => events.push('stop') },
      },
      on: (name, handler) => { listeners[name] = handler },
      off: (name, handler) => { if (listeners[name] === handler) delete listeners[name] },
    };
  } };
})();`;

function browserErrors(page) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });
  page.on('response', response => {
    if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
  });
  return errors;
}

await mkdir(output, { recursive: true });
await new Promise(done => server.listen(0, '127.0.0.1', done));
const url = `http://127.0.0.1:${server.address().port}${prefix}`;
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
const browser = await chromium.launch({ executablePath, headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader'] });
try {
  const context = await browser.newContext({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true });
  await context.route('**/sdk.js', route => route.fulfill({ status: 200, contentType: 'text/javascript', body: mockSdk }));
  const page = await context.newPage(), errors = browserErrors(page);
  await page.goto(url);
  await page.waitForFunction(() => window.__sdkTest?.events.includes('ready'));
  assert.deepEqual(await page.evaluate(() => window.__sdkTest.events), ['init', 'ready']);
  await page.screenshot({ path: `${output}/menu-375x667.jpg`, type: 'jpeg', quality: 86 });
  const canvas = await page.locator('#game canvas').boundingBox();
  const art = page.waitForResponse(response => response.url().endsWith('/assets/level-01.webp') && response.ok());
  await page.touchscreen.tap(canvas.x + canvas.width / 2, canvas.y + canvas.height * .86);
  await art;
  await page.waitForFunction(() => window.__sdkTest.events.includes('start'));
  assert.deepEqual(await page.evaluate(() => window.__sdkTest.events), ['init', 'ready', 'start']);
  await page.screenshot({ path: `${output}/puzzle-375x667.jpg`, type: 'jpeg', quality: 86 });
  await page.evaluate(() => window.__sdkTest.emit('game_api_pause'));
  await page.touchscreen.tap(canvas.x + 31, canvas.y + 31);
  assert.deepEqual(await page.evaluate(() => window.__sdkTest.events), ['init', 'ready', 'start']);
  await page.evaluate(() => window.__sdkTest.emit('game_api_resume'));
  await page.touchscreen.tap(canvas.x + 31, canvas.y + 31);
  await page.waitForFunction(() => window.__sdkTest.events.includes('stop'));
  assert.deepEqual(await page.evaluate(() => window.__sdkTest.events), ['init', 'ready', 'start', 'stop']);
  await page.touchscreen.tap(canvas.x + 31, canvas.y + 31); // Levels → menu.
  await page.touchscreen.tap(canvas.x + canvas.width * .68, canvas.y + canvas.height * .93);
  await page.screenshot({ path: `${output}/gallery-375x667.jpg`, type: 'jpeg', quality: 86 });
  assert.deepEqual(await page.evaluate(() => window.__sdkTest.events), ['init', 'ready', 'start', 'stop']);
  assert.deepEqual(errors, []);
  await context.close();

  // A missing SDK must not prevent the specially built release from starting.
  const unavailable = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await unavailable.route('**/sdk.js', route => route.abort());
  const fallback = await unavailable.newPage(), pageErrors = [];
  fallback.on('pageerror', error => pageErrors.push(error.message));
  await fallback.goto(url);
  await fallback.locator('#game canvas').waitFor();
  const fallbackCanvas = await fallback.locator('#game canvas').boundingBox();
  const fallbackArt = fallback.waitForResponse(response => response.url().endsWith('/assets/level-01.webp') && response.ok());
  await fallback.touchscreen.tap(fallbackCanvas.x + fallbackCanvas.width / 2, fallbackCanvas.y + fallbackCanvas.height * .86);
  await fallbackArt;
  assert.deepEqual(pageErrors, []);
  await unavailable.close();
  console.log('Yandex release: ready after menu, start/stop once, SDK pause blocks input, missing SDK preserves play');
} finally { await browser.close(); server.close(); }
