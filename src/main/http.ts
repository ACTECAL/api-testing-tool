// Sends requests from the main process with undici, so none of a browser's limits apply: no CORS, any
// header (Cookie, Host, Origin), proxies, and TLS checks that can be turned off for local servers.
// Redirects are followed here, one hop at a time, so the count and final URL are known and Authorization
// is dropped when a redirect leaves the original origin (as curl does without --location-trusted).
import { STATUS_CODES } from 'node:http';
import { openAsBlob } from 'node:fs';
import { basename, extname } from 'node:path';
import { Agent, FormData, ProxyAgent, request, type Dispatcher } from 'undici';
import type { HttpFailure, HttpResult, SendPayload } from '../shared/types';

type RequestBody = NonNullable<Parameters<typeof request>[1]>['body'];

export const MAX_BODY_BYTES = 50 * 1024 * 1024;
const MAX_REDIRECTS = 10;
const running = new Map<string, AbortController>();

const MIME: Record<string, string> = {
  '.json': 'application/json', '.txt': 'text/plain', '.csv': 'text/csv', '.xml': 'application/xml', '.html': 'text/html',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf', '.zip': 'application/zip', '.gz': 'application/gzip', '.mp4': 'video/mp4', '.mp3': 'audio/mpeg',
  '.dcm': 'application/dicom', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};
const mimeOf = (path: string) => MIME[extname(path).toLowerCase()] || 'application/octet-stream';

export function cancelRequest(id: string): void {
  running.get(id)?.abort(new Error('cancelled'));
}

function dispatcherFor(payload: SendPayload): Dispatcher {
  const tls = { rejectUnauthorized: payload.verifyTls };
  return payload.proxy ? new ProxyAgent({ uri: payload.proxy, requestTls: tls, proxyTls: tls }) : new Agent({ connect: tls });
}

// A fresh body for each attempt: a 307 or 308 redirect sends it again.
async function bodyFor(payload: SendPayload): Promise<string | Blob | FormData | undefined> {
  const body = payload.body;
  if (body.type === 'text') return body.text;
  if (body.type === 'file') return openAsBlob(body.filePath, { type: mimeOf(body.filePath) });
  if (body.type === 'form') {
    const form = new FormData();
    for (const field of body.fields) {
      if (field.filePath) form.append(field.name, await openAsBlob(field.filePath, { type: mimeOf(field.filePath) }), basename(field.filePath));
      else form.append(field.name, field.value ?? '');
    }
    return form;
  }
  return undefined;
}

function headerPairs(headers: Record<string, string | string[] | undefined>): [string, string][] {
  const pairs: [string, string][] = [];
  for (const [name, value] of Object.entries(headers)) {
    if (Array.isArray(value)) value.forEach((item) => pairs.push([name, item]));
    else if (value !== undefined) pairs.push([name, value]);
  }
  return pairs;
}

function failure(error: unknown, startedAt: number, reason: { timedOut: boolean; cancelled: boolean }): HttpFailure {
  const totalMs = Math.round(performance.now() - startedAt);
  const err = error as { code?: string; cause?: { code?: string; message?: string }; message?: string; name?: string };
  const code = err?.code || err?.cause?.code || '';
  const message = err?.cause?.message || err?.message || String(error);
  if (reason.cancelled) return { ok: false, kind: 'cancelled', message: 'The request was cancelled.', timings: { totalMs } };
  if (reason.timedOut || /TIMEOUT/i.test(code)) return { ok: false, kind: 'timeout', message: 'No response within the time limit.', timings: { totalMs } };
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return { ok: false, kind: 'dns', message: `The address could not be found (${code}). Check the host name.`, timings: { totalMs } };
  if (code === 'ECONNREFUSED') return { ok: false, kind: 'refused', message: 'The connection was refused: nothing is listening on that host and port.', timings: { totalMs } };
  if (/CERT|SELF_SIGNED|TLS|SSL|UNABLE_TO_VERIFY|ERR_TLS/i.test(code) || /certificate/i.test(message)) {
    return { ok: false, kind: 'tls', message: `The TLS certificate was not accepted (${code || message}). For a local server with a self-signed certificate, turn off "Verify TLS certificates" in Settings.`, timings: { totalMs } };
  }
  if (code === 'ENOENT' || code === 'EACCES') return { ok: false, kind: 'invalid', message: `A file for the body could not be read (${code}).`, timings: { totalMs } };
  return { ok: false, kind: 'network', message: code ? `${message} (${code})` : message, timings: { totalMs } };
}

export async function sendRequest(payload: SendPayload, userAgent = 'Actecal-API-Tester'): Promise<HttpResult> {
  const controller = new AbortController();
  running.set(payload.id, controller);
  const reason = { timedOut: false, cancelled: false };
  controller.signal.addEventListener('abort', () => {
    if (!reason.timedOut) reason.cancelled = true;
  });
  const timer = setTimeout(() => {
    reason.timedOut = true;
    controller.abort(new Error('timeout'));
  }, payload.timeoutMs);
  const dispatcher = dispatcherFor(payload);
  const startedAt = performance.now();
  try {
    let url = payload.url;
    let method = payload.method;
    let headers = [...payload.headers];
    if (!headers.some(([name]) => name.toLowerCase() === 'user-agent')) headers.push(['User-Agent', userAgent]);
    let withBody = payload.body.type !== 'none';
    for (let redirects = 0; ; redirects += 1) {
      const response = await request(url, {
        method,
        headers: headers.flat(),
        // undici sends a Blob with its length (test/http.test.ts), though its types do not list Blob yet.
        body: (withBody ? await bodyFor(payload) : undefined) as RequestBody,
        dispatcher,
        signal: controller.signal,
      });
      const headersMs = Math.round(performance.now() - startedAt);
      const location = response.headers.location;
      if (payload.followRedirects && [301, 302, 303, 307, 308].includes(response.statusCode) && typeof location === 'string' && redirects < MAX_REDIRECTS) {
        await response.body.dump();
        const next = new URL(location, url);
        if (next.origin !== new URL(url).origin) headers = headers.filter(([name]) => !['authorization', 'cookie'].includes(name.toLowerCase()));
        // 303, and 301/302 after a POST, continue as GET without a body (what browsers and curl do).
        if (response.statusCode === 303 || ([301, 302].includes(response.statusCode) && method === 'POST')) {
          method = 'GET';
          withBody = false;
          headers = headers.filter(([name]) => !['content-type', 'content-length'].includes(name.toLowerCase()));
        }
        url = next.href;
        continue;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      let truncated = false;
      for await (const chunk of response.body) {
        const buffer = chunk as Buffer;
        if (size + buffer.length > MAX_BODY_BYTES) {
          chunks.push(buffer.subarray(0, MAX_BODY_BYTES - size));
          size = MAX_BODY_BYTES;
          truncated = true;
          response.body.destroy();
          break;
        }
        chunks.push(buffer);
        size += buffer.length;
      }
      return {
        ok: true,
        status: response.statusCode,
        statusText: STATUS_CODES[response.statusCode] || '',
        headers: headerPairs(response.headers),
        body: new Uint8Array(Buffer.concat(chunks)),
        truncated,
        timings: { headersMs, totalMs: Math.round(performance.now() - startedAt) },
        url,
        redirects,
      };
    }
  } catch (error) {
    return failure(error, startedAt, reason);
  } finally {
    clearTimeout(timer);
    running.delete(payload.id);
    dispatcher.close().catch(() => {});
  }
}
