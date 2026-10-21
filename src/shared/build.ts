// RequestDoc + environment → the SendPayload the main process sends, or the problems to fix first.
import { DEFAULT_SETTINGS, type Environment, type RequestDoc, type SendPayload } from './types';
import { substitute, variableMap } from './variables';
import { urlWithParams } from './url';

const TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

function base64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export interface BuildResult {
  payload: SendPayload | null;
  errors: string[];
  /** {{variables}} that the environment does not define. */
  missing: string[];
}

export function buildPayload(request: RequestDoc, environment?: Environment | null): BuildResult {
  const errors: string[] = [];
  const missingSet = new Set<string>();
  const vars = variableMap(environment?.variables);
  const sub = (text: string) => substitute(text, vars, missingSet);

  const method = request.method.trim().toUpperCase();
  if (!TOKEN.test(method)) errors.push('Enter a valid method, such as GET or POST.');

  // The URL bar already holds the enabled params; rebuild it so the two always agree.
  let url = sub(urlWithParams(request.url.trim(), request.params)).trim();
  if (!url) errors.push('Enter a URL.');
  else if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) url = `http://${url}`;
  if (url) {
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) errors.push('Use an http:// or https:// URL.');
    } catch {
      errors.push(`"${url}" is not a valid URL.`);
    }
  }

  const headers: [string, string][] = [];
  for (const row of request.headers) {
    if (!row.enabled || !row.name.trim()) continue;
    const name = sub(row.name.trim());
    if (!TOKEN.test(name)) errors.push(`"${name}" is not a valid header name.`);
    else headers.push([name, sub(row.value)]);
  }
  const hasHeader = (name: string) => headers.some(([key]) => key.toLowerCase() === name);

  const auth = request.auth;
  if (auth.type === 'bearer' && auth.token.trim() && !hasHeader('authorization')) headers.push(['Authorization', `Bearer ${sub(auth.token.trim())}`]);
  if (auth.type === 'basic' && (auth.username || auth.password) && !hasHeader('authorization')) headers.push(['Authorization', `Basic ${base64(`${sub(auth.username)}:${sub(auth.password)}`)}`]);
  if (auth.type === 'apikey' && auth.key.trim()) {
    if (auth.addTo === 'header') headers.push([sub(auth.key.trim()), sub(auth.value)]);
    else if (url) {
      try {
        const parsed = new URL(url);
        parsed.searchParams.append(sub(auth.key.trim()), sub(auth.value));
        url = parsed.href;
      } catch {
        // The URL error is reported above.
      }
    }
  }

  let body: SendPayload['body'] = { type: 'none' };
  const b = request.body;
  if (b.type === 'raw' && b.text !== '') {
    body = { type: 'text', text: sub(b.text) };
    if (b.contentType && !hasHeader('content-type')) headers.push(['Content-Type', b.contentType]);
  } else if (b.type === 'urlencoded') {
    const rows = b.fields.filter((row) => row.enabled && (row.name || row.value));
    if (rows.length) {
      body = { type: 'text', text: new URLSearchParams(rows.map((row) => [sub(row.name), sub(row.value)])).toString() };
      if (!hasHeader('content-type')) headers.push(['Content-Type', 'application/x-www-form-urlencoded']);
    }
  } else if (b.type === 'form') {
    const rows = b.fields.filter((row) => row.enabled && (row.name || row.value || row.filePath));
    const fields: { name: string; value?: string; filePath?: string }[] = [];
    for (const row of rows) {
      if (!row.name.trim()) errors.push('Give every form field a name.');
      else if (row.kind === 'file') {
        if (!row.filePath) errors.push(`Choose a file for the form field "${row.name}".`);
        else fields.push({ name: sub(row.name), filePath: row.filePath });
      } else fields.push({ name: sub(row.name), value: sub(row.value) });
    }
    if (fields.length) body = { type: 'form', fields };
    // The multipart boundary is set when the body is built; a fixed Content-Type would break it.
    const index = headers.findIndex(([key]) => key.toLowerCase() === 'content-type');
    if (index >= 0 && fields.length) headers.splice(index, 1);
  } else if (b.type === 'file') {
    if (!b.filePath) errors.push('Choose the file to send as the body.');
    else {
      body = { type: 'file', filePath: b.filePath };
      if (b.contentType && !hasHeader('content-type')) headers.push(['Content-Type', b.contentType]);
    }
  }

  const settings = { ...DEFAULT_SETTINGS, ...request.settings };
  if (!Number.isFinite(settings.timeoutMs) || settings.timeoutMs < 1000 || settings.timeoutMs > 600000) errors.push('Use a time limit of 1 to 600 seconds.');
  const proxy = sub(settings.proxy || '').trim();
  if (proxy && !/^https?:\/\/[^\s]+$/i.test(proxy)) errors.push('The proxy must be an http:// or https:// address.');

  const missing = [...missingSet];
  if (errors.length) return { payload: null, errors, missing };
  return {
    payload: { id: request.id, method, url, headers, body, timeoutMs: settings.timeoutMs, followRedirects: settings.followRedirects, verifyTls: settings.verifyTls, proxy },
    errors,
    missing,
  };
}
