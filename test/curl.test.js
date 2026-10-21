import { test } from 'vitest';
import assert from 'node:assert/strict';
import { isForbiddenHeader, parseCurl, parseHeaderLines, preflightReasons, toCurl, toFetchCode, tokenize } from '../src/shared/curl.js';

const header = (request, name) => request.headers.find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1];

test('GET with headers', () => {
  const r = parseCurl(`curl 'https://api.example.com/v1/items?limit=5' -H 'accept: application/json' -H 'authorization: Bearer abc'`);
  assert.equal(r.method, 'GET');
  assert.equal(r.url, 'https://api.example.com/v1/items?limit=5');
  assert.equal(header(r, 'Authorization'), 'Bearer abc');
});

test("Chrome's Copy as cURL (bash), with line continuations", () => {
  const r = parseCurl("curl 'https://example.com/api' \\\n  -H 'content-type: application/json' \\\n  --data-raw '{\"a\":1}'");
  assert.equal(r.method, 'POST');
  assert.equal(r.body, '{"a":1}');
  assert.equal(header(r, 'content-type'), 'application/json');
});

test("Chrome's Copy as cURL (cmd)", () => {
  const r = parseCurl('curl ^"https://x.test/a?b=1^" ^\n  -H ^"accept: */*^"');
  assert.equal(r.url, 'https://x.test/a?b=1');
  assert.equal(header(r, 'accept'), '*/*');
});

test('-X, repeated -d and the default form content type', () => {
  const r = parseCurl("curl -X PUT https://x.test/a -d 'a=1' -d 'b=2'");
  assert.equal(r.method, 'PUT');
  assert.equal(r.body, 'a=1&b=2');
  assert.equal(header(r, 'content-type'), 'application/x-www-form-urlencoded');
});

test('--json, -u and combined short options', () => {
  const json = parseCurl(`curl --json '{"q":1}' https://x.test`);
  assert.equal(json.method, 'POST');
  assert.equal(header(json, 'content-type'), 'application/json');
  assert.equal(header(json, 'accept'), 'application/json');
  assert.equal(header(parseCurl('curl -u user:pass https://x.test'), 'authorization'), 'Basic dXNlcjpwYXNz');
  const combined = parseCurl("curl -sSL -XPOST https://x.test -H'X-A: 1'");
  assert.equal(combined.method, 'POST');
  assert.equal(header(combined, 'x-a'), '1');
});

test('-G moves data into the query string', () => {
  const r = parseCurl("curl -G https://x.test/search -d q=hello --data-urlencode 'name=a b'");
  assert.equal(r.method, 'GET');
  assert.equal(r.url, 'https://x.test/search?q=hello&name=a%20b');
  assert.equal(r.body, null);
});

test('-F form fields: text, and files for the visitor to choose', () => {
  const r = parseCurl("curl -F 'file=@/home/me/photo.png' -F 'name=x' https://x.test/upload");
  assert.equal(r.method, 'POST');
  assert.deepEqual(r.form, [['file', '', { fileName: 'photo.png', contentType: null, asText: false }], ['name', 'x']]);
  assert.ok(r.notes.some((n) => n.includes('Choose the file photo.png for the form field "file"')));
  const typed = parseCurl(`curl -F 'doc=@C:\\scans\\a.pdf;type=application/pdf;filename=report.pdf' -F 'note=<msg.txt' --form-string 'raw=@kept' https://x.test`);
  assert.deepEqual(typed.form, [
    ['doc', '', { fileName: 'report.pdf', contentType: 'application/pdf', asText: false }],
    ['note', '', { fileName: 'msg.txt', contentType: null, asText: true }],
    ['raw', '@kept'],
  ]);
});

test('a body from a file: -d @file and --data-binary @file', () => {
  const r = parseCurl("curl -X PUT --data-binary '@./upload/photo.jpg' -H 'Content-Type: image/jpeg' https://bucket.test/key");
  assert.equal(r.method, 'PUT');
  assert.equal(r.body, null);
  assert.deepEqual(r.bodyFile, { fileName: 'photo.jpg' });
  assert.equal(header(r, 'content-type'), 'image/jpeg');
  const d = parseCurl('curl -d @data.json https://x.test');
  assert.equal(d.method, 'POST');
  assert.deepEqual(d.bodyFile, { fileName: 'data.json' });
  assert.equal(header(d, 'content-type'), 'application/x-www-form-urlencoded');
  assert.ok(d.notes.some((n) => n.includes('removes line breaks')));
  assert.ok(parseCurl('curl -d @- https://x.test').notes.some((n) => n.includes('standard input')));
});

test('files round-trip through curl and appear in fetch code', () => {
  const request = {
    method: 'POST',
    url: 'https://x.test/upload',
    headers: [],
    body: null,
    form: [['title', 'Hi'], ['photo', '', { fileName: 'photo.png', contentType: 'image/png', asText: false }]],
    bodyFile: null,
  };
  const command = toCurl(request);
  assert.match(command, /-F 'photo=@photo\.png;type=image\/png'/);
  assert.match(command, /--form-string 'title=Hi'/);
  assert.deepEqual(parseCurl(command).form, request.form);
  const code = toFetchCode(request);
  assert.match(code, /form\.append\("photo", fileInput1\.files\[0\], "photo\.png"\);/);
  const put = { method: 'PUT', url: 'https://bucket.test/key', headers: [['Content-Type', 'image/jpeg']], body: null, form: null, bodyFile: { fileName: 'photo.jpg' } };
  assert.match(toCurl(put), /--data-binary '@photo\.jpg'/);
  assert.deepEqual(parseCurl(toCurl(put)).bodyFile, { fileName: 'photo.jpg' });
  assert.match(toFetchCode(put), /body: fileInput1\.files\[0\],/);
});

test("$'…' strings, forbidden headers and missing schemes", () => {
  assert.equal(parseCurl("curl https://x.test -d $'line1\\nline2'").body, 'line1\nline2');
  assert.ok(parseCurl("curl https://x.test -H 'Cookie: a=1'").notes.some((n) => n.includes('Cookie')));
  assert.equal(parseCurl('curl example.com/path').url, 'http://example.com/path');
  assert.deepEqual(tokenize(`echo "a \\"b\\"" 'c d'`), ['echo', 'a "b"', 'c d']);
});

test('errors', () => {
  assert.throws(() => parseCurl('curl -H "a: b"'), /no URL/);
  assert.throws(() => parseCurl("curl 'https://x.test"), /not closed/);
  assert.throws(() => parseCurl('curl ftp://x.test/file'), /http and https/);
});

test('fetch code', () => {
  const code = toFetchCode(parseCurl(`curl -X POST https://x.test -H 'Content-Type: application/json' -H 'Cookie: a=1' -d '{"a":1}'`));
  assert.match(code, /method: "POST"/);
  assert.match(code, /"Content-Type": "application\/json"/);
  assert.doesNotMatch(code, /Cookie/);
  assert.match(code, /body: "\{\\"a\\":1\}"/);
});

test("Chrome's sec-* headers and cookies are grouped into one note", () => {
  const r = parseCurl("curl 'https://x.test' -H 'sec-ch-ua: \"Chromium\"' -H 'sec-fetch-mode: cors' -b 'session=1' -H 'accept: */*'");
  assert.ok(isForbiddenHeader('Sec-Fetch-Mode') && isForbiddenHeader('Proxy-Authorization') && !isForbiddenHeader('Authorization'));
  assert.ok(r.notes.some((n) => n.includes('sec-ch-ua, sec-fetch-mode, Cookie')));
  assert.ok(r.notes.some((n) => n.includes('Authorization header')));
  assert.doesNotMatch(toFetchCode(r), /sec-|Cookie/);
});

test('-F drops a fixed multipart Content-Type', () => {
  const r = parseCurl("curl -F 'a=1' -H 'Content-Type: multipart/form-data' https://x.test");
  assert.equal(header(r, 'content-type'), undefined);
  assert.ok(r.notes.some((n) => n.includes('boundary')));
});

test('CORS preflight reasons', () => {
  assert.deepEqual(preflightReasons({ method: 'GET', headers: [['Accept', 'application/json']] }), []);
  assert.deepEqual(preflightReasons({ method: 'POST', headers: [['Content-Type', 'application/x-www-form-urlencoded; charset=UTF-8']] }), []);
  assert.deepEqual(preflightReasons({ method: 'POST', headers: [['Content-Type', 'application/json']] }), ['Content-Type application/json']);
  assert.deepEqual(preflightReasons({ method: 'DELETE', headers: [['Authorization', 'Bearer x'], ['Cookie', 'a=1']] }), ['the DELETE method', 'the Authorization header']);
});

test('header lines', () => {
  const { headers, errors, notes } = parseHeaderLines('Accept: application/json\n\n# comment\nX-Empty:\nbad line\nBad Name: 1\n:authority: x.test\nX-Hindi: नमस्ते');
  assert.deepEqual(headers, [['Accept', 'application/json'], ['X-Empty', '']]);
  assert.equal(errors.length, 3);
  assert.equal(notes.length, 1);
});

test('curl from a request round-trips', () => {
  const request = { method: 'POST', url: 'https://x.test/a?b=1', headers: [['Content-Type', 'application/json'], ['X-Quote', "it's"]], body: '{"a":"it\'s"}', form: null };
  const command = toCurl(request);
  assert.doesNotMatch(command, /-X POST/);
  const back = parseCurl(command);
  assert.equal(back.method, 'POST');
  assert.equal(back.url, request.url);
  assert.equal(back.body, request.body);
  assert.equal(header(back, 'x-quote'), "it's");
  assert.match(toCurl({ method: 'HEAD', url: 'https://x.test/', headers: [], body: null, form: null }), /-I/);
  assert.match(toCurl({ method: 'DELETE', url: 'https://x.test/', headers: [], body: null, form: null }), /-X DELETE/);
  const form = parseCurl(toCurl({ method: 'POST', url: 'https://x.test/', headers: [], body: null, form: [['name', 'a b']] }));
  assert.deepEqual(form.form, [['name', 'a b']]);
  assert.ok(parseCurl('curl -X TRACE https://x.test').notes.some((n) => n.includes('cannot send TRACE')));
});
