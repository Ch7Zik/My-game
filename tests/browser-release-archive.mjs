import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const root = resolve('dist');
const prefix = process.env.RELEASE_TEST_PREFIX || '/nested/game/';
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.webp': 'image/webp', '.ttf': 'font/ttf', '.svg': 'image/svg+xml', '.ogg': 'audio/ogg' };
const server = createServer(async (request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://local').pathname);
  if (!pathname.startsWith(prefix)) { response.writeHead(404).end(); return; }
  const relative = pathname.slice(prefix.length) || 'index.html';
  const file = resolve(root, relative);
  if (!file.startsWith(`${root}/`) && file !== root) { response.writeHead(403).end(); return; }
  try {
    const body = await readFile(file);
    const extension = file.slice(file.lastIndexOf('.'));
    response.writeHead(200, { 'content-type': types[extension] || 'application/octet-stream' }).end(body);
  } catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
const browser = await chromium.launch({ executablePath, headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });
  page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
  await page.goto(`http://127.0.0.1:${address.port}${prefix}`);
  await page.locator('#game canvas').waitFor({ timeout: 90000 });
  await page.waitForFunction(() => performance.getEntriesByType('resource')
    .some(entry => entry.name.endsWith('/assets/menu-alchemist.webp')), null, { timeout: 90000 });
  const rect = await page.locator('#game canvas').boundingBox();
  assert.ok(rect.width > 300 && rect.height > 800);
  const artResponse = page.waitForResponse(response => response.url().endsWith('/assets/level-01.webp') && response.ok(),
    { timeout: 90000 });
  await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height * .86);
  await artResponse;
  assert.deepEqual(errors, []);
  console.log(`Release build loads from ${prefix}: menu and level 1, no JS or HTTP errors`);
} finally { await browser.close(); server.close(); }
