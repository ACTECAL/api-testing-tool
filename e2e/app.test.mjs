// End-to-end: launches the built app (npm run build first) with its data in a temporary folder, and uses
// it against a local echo server: send, curl import, save to a collection, environments and history.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron } from 'playwright-core';
import electronPath from 'electron';

const data = mkdtempSync(join(tmpdir(), 'api-tester-e2e-'));
const workspace = join(data, 'workspace');
let server;
let base;
let app;
let page;

before(async () => {
  server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': 'seen=1' });
      res.end(JSON.stringify({ method: req.method, url: req.url, cookie: req.headers.cookie || null, origin: req.headers.origin || null, body: Buffer.concat(chunks).toString() }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  app = await electron.launch({ executablePath: electronPath, args: ['.'], env: { ...process.env, API_TESTER_USER_DATA: join(data, 'user'), API_TESTER_WORKSPACE: workspace } });
  page = await app.firstWindow();
  await page.waitForSelector('input[aria-label="URL"]');
});

after(async () => {
  await app?.close();
  server?.close();
});

const responseText = () => page.locator('.response').innerText();

test('sends a GET and shows the formatted JSON, params and cookies', async () => {
  await page.fill('input[aria-label="URL"]', `${base}/items?limit=5`);
  await page.click('button:has-text("Send")');
  await page.waitForSelector('.status.ok');
  const text = await responseText();
  assert.match(text, /200 OK/);
  assert.match(text, /"method": "GET"/);
  assert.match(text, /"url": "\/items\?limit=5"/);
  await page.click('.editor button[role="tab"]:has-text("Params")');
  assert.equal(await page.inputValue('input[aria-label="Params row 1: name"]'), 'limit');
  await page.click('.response button[role="tab"]:has-text("Cookies")');
  assert.match(await responseText(), /seen=1/);
});

test('imports curl and sends what a browser cannot (Cookie, Origin)', async () => {
  await page.click('button:has-text("Import curl")');
  await page.fill('textarea[aria-label="curl command"]', `curl '${base}/orders' -H 'Cookie: session=abc' -H 'Origin: https://other.test' -H 'Content-Type: application/json' --data-raw '{"qty":2}'`);
  page.once('dialog', (dialog) => dialog.accept());
  await page.click('dialog button:has-text("Import")');
  await page.click('button:has-text("Send")');
  await page.waitForSelector('.status.ok');
  await page.click('.response button[role="tab"]:has-text("Body")');
  const text = await responseText();
  assert.match(text, /"method": "POST"/);
  assert.match(text, /"cookie": "session=abc"/);
  assert.match(text, /"origin": "https:\/\/other.test"/);
  assert.match(text, /\\"qty\\":2/);
});

test('saves the request to a collection file in the workspace', async () => {
  await page.click('.topbar button:has-text("Save")');
  await page.fill('dialog input >> nth=0', 'Create order');
  await page.click('dialog button:has-text("Save")');
  await page.waitForSelector('.sidebar .request-name:has-text("Create order")');
  const files = readdirSync(join(workspace, 'collections'));
  assert.equal(files.length, 1);
  const saved = JSON.parse(readFileSync(join(workspace, 'collections', files[0]), 'utf8'));
  assert.equal(saved.requests[0].name, 'Create order');
  assert.equal(saved.requests[0].method, 'POST');
});

test('environments: {{variables}} in the URL, secrets kept out of the workspace', async () => {
  await page.click('.topbar button:has-text("Manage")');
  await page.click('dialog button:has-text("New environment")');
  await page.click('dialog button:has-text("+ Add")');
  await page.fill('dialog input[aria-label="Variables row 1: name"]', 'base');
  await page.fill('dialog input[aria-label="Variables row 1: value"]', base);
  await page.click('dialog button:has-text("+ Add")');
  await page.fill('dialog input[aria-label="Variables row 2: name"]', 'token');
  await page.fill('dialog input[aria-label="Variables row 2: value"]', 'top-secret');
  await page.check('dialog .kv-row >> nth=1 >> input[type="checkbox"] >> nth=1');
  await page.click('dialog button:has-text("Save")');
  await page.click('dialog button[aria-label="Close"]');
  await page.selectOption('.topbar select', { label: 'Environment 1' });
  page.once('dialog', (dialog) => dialog.accept());
  await page.click('button:has-text("New request")');
  await page.fill('input[aria-label="URL"]', '{{base}}/env-check');
  await page.click('button:has-text("Send")');
  await page.waitForSelector('.status.ok');
  assert.match(await responseText(), /"url": "\/env-check"/);
  const envFile = readdirSync(join(workspace, 'environments'))[0];
  const stored = readFileSync(join(workspace, 'environments', envFile), 'utf8');
  assert.ok(!stored.includes('top-secret'), 'the secret value is not in the workspace file');
});

test('history lists the sent requests', async () => {
  const items = await page.locator('.sidebar .side-section.grow li').count();
  assert.ok(items >= 3, `${items} history entries`);
  await page.screenshot({ path: join(data, 'app.png') });
  console.log(`screenshot: ${join(data, 'app.png')}`);
});
