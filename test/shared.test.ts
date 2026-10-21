import { describe, expect, test } from 'vitest';
import { buildPayload } from '../src/shared/build';
import { payloadToCurl, payloadToFetch, requestFromCurl } from '../src/shared/curlRequest';
import { newRequest, newRow, type Environment } from '../src/shared/types';
import { paramsFromUrl, splitUrl, urlWithParams } from '../src/shared/url';
import { substitute, variableMap, variablesIn } from '../src/shared/variables';

const env = (vars: Record<string, string>): Environment => ({ id: 'env_1', name: 'Test', variables: Object.entries(vars).map(([name, value]) => newRow({ name, value })) });

describe('variables', () => {
  test('replaces known names, keeps and reports unknown ones', () => {
    const missing = new Set<string>();
    expect(substitute('{{base}}/users/{{ id }}?q={{nope}}', variableMap(env({ base: 'https://x.test', id: '7' }).variables), missing)).toBe('https://x.test/users/7?q={{nope}}');
    expect([...missing]).toEqual(['nope']);
    expect(variablesIn('{{a}} and {{b.c}}')).toEqual(['a', 'b.c']);
  });
  test('values are not expanded again', () => {
    expect(substitute('{{a}}', variableMap(env({ a: '{{b}}', b: 'x' }).variables))).toBe('{{b}}');
  });
  test('disabled rows are ignored', () => {
    const variables = [newRow({ name: 'a', value: '1', enabled: false })];
    expect(substitute('{{a}}', variableMap(variables))).toBe('{{a}}');
  });
});

describe('URL and params', () => {
  test('split and rebuild, keeping {{variables}} and the hash', () => {
    expect(splitUrl('https://x.test/a?b=1#top')).toEqual({ base: 'https://x.test/a', query: 'b=1', hash: '#top' });
    const params = paramsFromUrl('https://x.test/a?q=hello%20world&flag&id={{id}}');
    expect(params.map((row) => [row.name, row.value])).toEqual([
      ['q', 'hello world'],
      ['flag', ''],
      ['id', '{{id}}'],
    ]);
    expect(urlWithParams('https://x.test/a?old=1#top', params)).toBe('https://x.test/a?q=hello+world&flag&id={{id}}#top');
  });
  test('disabled params stay in the table but leave the URL', () => {
    const rows = [newRow({ name: 'a', value: '1' }), newRow({ name: 'b', value: '2', enabled: false })];
    const url = urlWithParams('https://x.test/', rows);
    expect(url).toBe('https://x.test/?a=1');
    expect(paramsFromUrl(url, rows).map((row) => `${row.name}:${row.enabled}`)).toEqual(['a:true', 'b:false']);
  });
});

describe('building the payload', () => {
  test('variables, auth and a JSON body', () => {
    const request = newRequest({
      method: 'post',
      url: '{{base}}/items',
      headers: [newRow({ name: 'X-Trace', value: '{{trace}}' })],
      auth: { type: 'bearer', token: '{{token}}' },
      body: { type: 'raw', contentType: 'application/json', text: '{"name":"{{name}}"}' },
    });
    const { payload, errors, missing } = buildPayload(request, env({ base: 'https://api.test', token: 'abc', name: 'Pen' }));
    expect(errors).toEqual([]);
    expect(missing).toEqual(['trace']);
    expect(payload?.method).toBe('POST');
    expect(payload?.url).toBe('https://api.test/items');
    expect(payload?.headers).toEqual([
      ['X-Trace', '{{trace}}'],
      ['Authorization', 'Bearer abc'],
      ['Content-Type', 'application/json'],
    ]);
    expect(payload?.body).toEqual({ type: 'text', text: '{"name":"Pen"}' });
  });
  test('basic auth, API key in the query, and no http:// typed', () => {
    const basic = buildPayload(newRequest({ url: 'x.test/a', auth: { type: 'basic', username: 'ana', password: 'pä' } }));
    expect(basic.payload?.url).toBe('http://x.test/a');
    expect(basic.payload?.headers).toEqual([['Authorization', `Basic ${Buffer.from('ana:pä').toString('base64')}`]]);
    const key = buildPayload(newRequest({ url: 'https://x.test/a?b=1', params: paramsFromUrl('https://x.test/a?b=1'), auth: { type: 'apikey', key: 'api_key', value: 'k1', addTo: 'query' } }));
    expect(key.payload?.url).toBe('https://x.test/a?b=1&api_key=k1');
  });
  test('form data with a file drops a fixed Content-Type; missing files are errors', () => {
    const fields = [newRow({ name: 'title', value: 'Hi' }), newRow({ name: 'photo', kind: 'file', filePath: '/tmp/p.png' })];
    const ok = buildPayload(newRequest({ method: 'POST', url: 'https://x.test', headers: [newRow({ name: 'Content-Type', value: 'multipart/form-data' })], body: { type: 'form', fields } }));
    expect(ok.payload?.headers).toEqual([]);
    expect(ok.payload?.body).toEqual({ type: 'form', fields: [{ name: 'title', value: 'Hi' }, { name: 'photo', filePath: '/tmp/p.png' }] });
    const bad = buildPayload(newRequest({ method: 'POST', url: 'https://x.test', body: { type: 'form', fields: [newRow({ name: 'doc', kind: 'file' })] } }));
    expect(bad.errors).toEqual(['Choose a file for the form field "doc".']);
  });
  test('URL-encoded fields and file bodies', () => {
    const form = buildPayload(newRequest({ method: 'POST', url: 'https://x.test', body: { type: 'urlencoded', fields: [newRow({ name: 'a b', value: 'c&d' })] } }));
    expect(form.payload?.body).toEqual({ type: 'text', text: 'a+b=c%26d' });
    expect(form.payload?.headers).toEqual([['Content-Type', 'application/x-www-form-urlencoded']]);
    const file = buildPayload(newRequest({ method: 'PUT', url: 'https://x.test', body: { type: 'file', filePath: '/tmp/a.bin', contentType: 'application/octet-stream' } }));
    expect(file.payload?.body).toEqual({ type: 'file', filePath: '/tmp/a.bin' });
  });
  test('problems are reported, not sent', () => {
    expect(buildPayload(newRequest({ url: '' })).errors).toContain('Enter a URL.');
    expect(buildPayload(newRequest({ url: 'ftp://x.test' })).errors).toContain('Use an http:// or https:// URL.');
    expect(buildPayload(newRequest({ url: 'https://x.test', headers: [newRow({ name: 'Bad Header', value: '1' })] })).errors[0]).toMatch(/not a valid header name/);
    expect(buildPayload(newRequest({ url: 'https://x.test', settings: { timeoutMs: 30000, followRedirects: true, verifyTls: true, proxy: 'socks5://p' } })).errors).toContain('The proxy must be an http:// or https:// address.');
  });
});

describe('curl import and export', () => {
  test('a curl command becomes a request, with the desktop-only options kept', () => {
    const { request, notes } = requestFromCurl(`curl -sSk -x http://127.0.0.1:8888 'https://x.test/v1/items?limit=5' -H 'Cookie: a=1' -H 'Authorization: Bearer t' --data-raw '{"a":1}' -m 12`);
    expect(request.method).toBe('POST');
    expect(request.params.map((row) => [row.name, row.value])).toEqual([['limit', '5']]);
    expect(request.headers.map((row) => row.name)).toEqual(['Cookie', 'Authorization', 'Content-Type']);
    expect(request.body).toEqual({ type: 'raw', contentType: 'application/x-www-form-urlencoded', text: '{"a":1}' });
    expect(request.settings).toEqual({ timeoutMs: 12000, followRedirects: true, verifyTls: false, proxy: 'http://127.0.0.1:8888' });
    // The browser-only warnings (cookies cannot be sent, and so on) do not apply here.
    expect(notes.some((note) => /Browsers|Cookies are never/.test(note))).toBe(false);
  });
  test('-F files and --data-binary @file ask for the file', () => {
    const form = requestFromCurl("curl -F 'photo=@/home/me/p.png' -F 'title=Hi' https://x.test/upload");
    expect(form.request.body.type).toBe('form');
    expect(form.notes.join(' ')).toMatch(/Choose the files/);
    const put = requestFromCurl("curl -X PUT --data-binary '@big.bin' -H 'Content-Type: application/octet-stream' https://x.test/key");
    expect(put.request.body).toEqual({ type: 'file', filePath: '', contentType: 'application/octet-stream' });
  });
  test('payload → curl and fetch, with files, -k and the proxy', () => {
    const payload = {
      id: 'r1',
      method: 'POST',
      url: 'https://x.test/upload',
      headers: [['X-A', '1']] as [string, string][],
      body: { type: 'form' as const, fields: [{ name: 'title', value: 'Hi' }, { name: 'photo', filePath: '/home/me/p.png' }] },
      timeoutMs: 30000,
      followRedirects: true,
      verifyTls: false,
      proxy: 'http://127.0.0.1:8888',
    };
    const curl = payloadToCurl(payload);
    expect(curl).toMatch(/--form-string 'title=Hi'/);
    expect(curl).toMatch(/-F 'photo=@\/home\/me\/p\.png'/);
    expect(curl).toMatch(/-k/);
    expect(curl).toMatch(/-x 'http:\/\/127\.0\.0\.1:8888'/);
    const fetchCode = payloadToFetch(payload);
    expect(fetchCode).toMatch(/form\.append\("photo", fileInput1\.files\[0\], "p\.png"\)/);
    // And the curl command imports back to the same request.
    const back = requestFromCurl(curl);
    expect(back.request.settings.verifyTls).toBe(false);
    expect(back.request.settings.proxy).toBe('http://127.0.0.1:8888');
  });
});
