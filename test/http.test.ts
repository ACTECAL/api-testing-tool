// The main process's request runner against a local server: no browser in between, so cookies, any
// header, files, redirects and timeouts all behave like curl.
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { sendRequest } from '../src/main/http';
import type { SendPayload } from '../src/shared/types';

let server: Server;
let base = '';
const dir = mkdtempSync(join(tmpdir(), 'api-tester-'));
const photo = join(dir, 'photo.png');
writeFileSync(photo, Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]));

const readBody = (req: IncomingMessage) =>
  new Promise<Buffer>((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });

beforeAll(async () => {
  server = createServer(async (req, res) => {
    const body = await readBody(req);
    const url = new URL(req.url || '/', 'http://local');
    if (url.pathname === '/redirect') {
      res.writeHead(302, { Location: '/echo?from=redirect' });
      res.end();
      return;
    }
    if (url.pathname === '/slow') {
      setTimeout(() => res.end('late'), 3000);
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': ['a=1; Path=/', 'b=2; Path=/'] });
    res.end(JSON.stringify({ method: req.method, path: url.pathname + url.search, headers: req.headers, length: body.length, text: body.toString('latin1').slice(0, 2000) }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
});
afterAll(() => server.close());

const payload = (fields: Partial<SendPayload>): SendPayload => ({ id: `t${Math.random()}`, method: 'GET', url: `${base}/echo`, headers: [], body: { type: 'none' }, timeoutMs: 5000, followRedirects: true, verifyTls: true, proxy: '', ...fields });
const json = (result: Awaited<ReturnType<typeof sendRequest>>) => {
  if (!result.ok) throw new Error(result.message);
  return JSON.parse(Buffer.from(result.body).toString('utf8'));
};

describe('sendRequest', () => {
  test('sends headers a browser cannot, and keeps repeated response headers', async () => {
    const result = await sendRequest(payload({ headers: [['Cookie', 'session=abc'], ['Origin', 'https://evil.test'], ['X-Many', '1']] }));
    const echo = json(result);
    expect(echo.headers.cookie).toBe('session=abc');
    expect(echo.headers.origin).toBe('https://evil.test');
    expect(echo.headers['user-agent']).toMatch(/Actecal-API-Tester/);
    expect(result.ok && result.headers.filter(([name]) => name === 'set-cookie')).toHaveLength(2);
  });
  test('multipart form data with a file', async () => {
    const echo = json(await sendRequest(payload({ method: 'POST', body: { type: 'form', fields: [{ name: 'title', value: 'Hi' }, { name: 'photo', filePath: photo }] } })));
    expect(echo.headers['content-type']).toMatch(/^multipart\/form-data; boundary=/);
    expect(echo.text).toMatch(/name="title"\r\n\r\nHi/);
    expect(echo.text).toMatch(/name="photo"; filename="photo.png"\r\nContent-Type: image\/png/);
  });
  test('a file as the whole body, with its length', async () => {
    const echo = json(await sendRequest(payload({ method: 'PUT', body: { type: 'file', filePath: photo } })));
    expect(echo.length).toBe(8);
    expect(echo.headers['content-length']).toBe('8');
  });
  test('follows redirects and counts them; or stops when asked', async () => {
    const followed = await sendRequest(payload({ url: `${base}/redirect` }));
    expect(followed.ok && followed.redirects).toBe(1);
    expect(json(followed).path).toBe('/echo?from=redirect');
    const stopped = await sendRequest(payload({ url: `${base}/redirect`, followRedirects: false }));
    expect(stopped.ok && stopped.status).toBe(302);
  });
  test('time limit, refused connections and bad host names', async () => {
    const slow = await sendRequest(payload({ url: `${base}/slow`, timeoutMs: 1000 }));
    expect(!slow.ok && slow.kind).toBe('timeout');
    const refused = await sendRequest(payload({ url: 'http://127.0.0.1:9/' }));
    expect(!refused.ok && refused.kind).toBe('refused');
    const dns = await sendRequest(payload({ url: 'http://no-such-host.invalid/' }));
    expect(!dns.ok && ['dns', 'network'].includes(dns.kind)).toBe(true);
  }, 15000);
});
