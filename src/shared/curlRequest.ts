// curl ⇄ RequestDoc. Parsing is curl.js (shared with the web tester); this maps the result onto the app's
// request model, drops the notes that apply only to browsers, and turns a resolved payload back into curl.
import { parseCurl, toCurl, toFetchCode, type CurlRequest, type FormEntry } from './curl.js';
import { paramsFromUrl } from './url';
import { DEFAULT_SETTINGS, newRequest, newRow, type RequestDoc, type SendPayload } from './types';

// The desktop app sends these itself, so the web tester's warnings about them do not apply.
const BROWSER_ONLY = [/^Browsers /, /^Cookies are never sent/, /^The Content-Type header was removed/];

export interface CurlImport {
  request: RequestDoc;
  notes: string[];
}

export function requestFromCurl(command: string): CurlImport {
  const parsed = parseCurl(command);
  const headers = parsed.headers.map(([name, value]) => newRow({ name, value }));
  let body: RequestDoc['body'] = { type: 'none' };
  if (parsed.form) {
    body = {
      type: 'form',
      fields: parsed.form.map((entry: FormEntry) => (entry.length === 3 ? newRow({ name: entry[0], kind: 'file', value: entry[2].fileName }) : newRow({ name: entry[0], value: entry[1] }))),
    };
  } else if (parsed.bodyFile) {
    const type = parsed.headers.find(([name]) => name.toLowerCase() === 'content-type')?.[1] || '';
    body = { type: 'file', filePath: '', contentType: type };
  } else if (parsed.body !== null) {
    const type = parsed.headers.find(([name]) => name.toLowerCase() === 'content-type')?.[1] || 'text/plain';
    body = { type: 'raw', contentType: type, text: parsed.body };
  }
  const notes = parsed.notes.filter((note) => !BROWSER_ONLY.some((pattern) => pattern.test(note)));
  if (parsed.form?.some((entry) => entry.length === 3)) notes.push('Choose the files for the form fields marked File.');
  if (parsed.bodyFile) notes.push(`Choose ${parsed.bodyFile.fileName} as the body file.`);
  return {
    request: newRequest({
      name: `${parsed.method} ${new URL(parsed.url).pathname}`,
      method: parsed.method,
      url: parsed.url,
      params: paramsFromUrl(parsed.url),
      headers,
      body,
      settings: {
        ...DEFAULT_SETTINGS,
        timeoutMs: parsed.timeoutSeconds ? Math.min(600000, Math.max(1000, Math.round(parsed.timeoutSeconds * 1000))) : DEFAULT_SETTINGS.timeoutMs,
        verifyTls: !parsed.insecure,
        proxy: parsed.proxy || '',
      },
    }),
    notes,
  };
}

const fileName = (path: string) => path.split(/[\\/]/).pop() || 'file';

function curlShape(payload: SendPayload): CurlRequest {
  const base = { method: payload.method, url: payload.url, headers: payload.headers };
  if (payload.body.type === 'text') return { ...base, body: payload.body.text };
  if (payload.body.type === 'file') return { ...base, bodyFile: { fileName: payload.body.filePath } };
  if (payload.body.type === 'form') {
    return {
      ...base,
      form: payload.body.fields.map((field) => (field.filePath ? [field.name, '', { fileName: field.filePath, contentType: null, asText: false }] : [field.name, field.value ?? ''])),
    };
  }
  return base;
}

/** A curl command for the payload. File paths are kept, so the command runs as it is in a terminal. */
export function payloadToCurl(payload: SendPayload): string {
  let command = toCurl(curlShape(payload));
  if (!payload.verifyTls) command += ' \\\n  -k';
  if (payload.proxy) command += ` \\\n  -x '${payload.proxy.replace(/'/g, "'\\''")}'`;
  return command;
}

/** JavaScript fetch() code for the payload (file contents come from <input type="file"> there). */
export function payloadToFetch(payload: SendPayload): string {
  const shape = curlShape(payload);
  if (shape.bodyFile) shape.bodyFile = { fileName: fileName(shape.bodyFile.fileName) };
  if (shape.form) shape.form = shape.form.map((entry) => (entry.length === 3 ? [entry[0], '', { ...entry[2], fileName: fileName(entry[2].fileName) }] : entry));
  return toFetchCode(shape);
}
