// The data model, shared by the main process, the preload script and the renderer. Collections and
// environments are saved as these objects in JSON files, so keep changes backward compatible.

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS' | (string & {});

/** A row in a params, headers, form or variables table. */
export interface KeyValue {
  id: string;
  name: string;
  value: string;
  enabled: boolean;
  /** Form data rows can hold a file, chosen in a native file dialog. */
  kind?: 'text' | 'file';
  filePath?: string;
  /** Environment variables only: the value is stored encrypted, outside the workspace folder. */
  secret?: boolean;
}

export type Auth =
  | { type: 'none' }
  | { type: 'bearer'; token: string }
  | { type: 'basic'; username: string; password: string }
  | { type: 'apikey'; key: string; value: string; addTo: 'header' | 'query' };

export type Body =
  | { type: 'none' }
  | { type: 'raw'; contentType: string; text: string }
  | { type: 'form'; fields: KeyValue[] }
  | { type: 'urlencoded'; fields: KeyValue[] }
  | { type: 'file'; filePath: string; contentType: string };

export interface RequestSettings {
  timeoutMs: number;
  followRedirects: boolean;
  /** Off only for local servers with self-signed certificates. */
  verifyTls: boolean;
  /** For example http://127.0.0.1:8888; empty for a direct connection. */
  proxy: string;
}

export interface RequestDoc {
  id: string;
  name: string;
  method: Method;
  url: string;
  params: KeyValue[];
  headers: KeyValue[];
  auth: Auth;
  body: Body;
  settings: RequestSettings;
}

export interface Collection {
  id: string;
  name: string;
  requests: RequestDoc[];
}

export interface Environment {
  id: string;
  name: string;
  variables: KeyValue[];
}

/** What the main process sends: everything resolved, variables replaced and auth applied. */
export interface SendPayload {
  id: string;
  method: string;
  url: string;
  headers: [string, string][];
  body:
    | { type: 'none' }
    | { type: 'text'; text: string }
    | { type: 'form'; fields: { name: string; value?: string; filePath?: string }[] }
    | { type: 'file'; filePath: string };
  timeoutMs: number;
  followRedirects: boolean;
  verifyTls: boolean;
  proxy: string;
}

export interface HttpResponse {
  ok: true;
  status: number;
  statusText: string;
  /** In arrival order, repeated names kept (for example several Set-Cookie headers). */
  headers: [string, string][];
  body: Uint8Array;
  /** True when the body was cut at the size limit. */
  truncated: boolean;
  timings: { headersMs: number; totalMs: number };
  url: string;
  redirects: number;
}

export interface HttpFailure {
  ok: false;
  kind: 'cancelled' | 'timeout' | 'dns' | 'refused' | 'tls' | 'invalid' | 'network';
  message: string;
  timings: { totalMs: number };
}

export type HttpResult = HttpResponse | HttpFailure;

export interface HistoryEntry {
  id: string;
  at: string;
  method: string;
  url: string;
  status: number | null;
  request: RequestDoc;
}

export interface Workspace {
  path: string;
  collections: Collection[];
  environments: Environment[];
  history: HistoryEntry[];
}

export const DEFAULT_SETTINGS: RequestSettings = { timeoutMs: 30000, followRedirects: true, verifyTls: true, proxy: '' };

let counter = 0;
/** A short unique id, good enough for local documents. */
export function newId(prefix = 'id'): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export const newRow = (fields: Partial<KeyValue> = {}): KeyValue => ({ id: newId('kv'), name: '', value: '', enabled: true, ...fields });

export function newRequest(fields: Partial<RequestDoc> = {}): RequestDoc {
  return {
    id: newId('req'),
    name: 'New request',
    method: 'GET',
    url: '',
    params: [],
    headers: [],
    auth: { type: 'none' },
    body: { type: 'none' },
    settings: { ...DEFAULT_SETTINGS },
    ...fields,
  };
}
