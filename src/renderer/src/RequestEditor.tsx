// The request: method and URL, then tabs for params, headers, auth, body, settings and code.
import { useState } from 'react';
import type { Auth, Body, RequestDoc, SendPayload } from '@shared/types';
import { paramsFromUrl, urlWithParams } from '@shared/url';
import { payloadToCurl, payloadToFetch } from '@shared/curlRequest';
import KeyValueTable from './KeyValueTable';

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
const TABS = ['Params', 'Headers', 'Auth', 'Body', 'Settings', 'Code'] as const;
type Tab = (typeof TABS)[number];
const RAW_TYPES = ['application/json', 'text/plain', 'application/xml', 'text/html', 'application/javascript'];

interface Props {
  request: RequestDoc;
  onChange: (request: RequestDoc) => void;
  onSend: () => void;
  onCancel: () => void;
  sending: boolean;
  errors: string[];
  missing: string[];
  payload: SendPayload | null;
}

function Copy({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn small"
      disabled={!text}
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
    >
      {done ? 'Copied' : label}
    </button>
  );
}

export default function RequestEditor({ request, onChange, onSend, onCancel, sending, errors, missing, payload }: Props) {
  const [tab, setTab] = useState<Tab>('Params');
  const set = (patch: Partial<RequestDoc>) => onChange({ ...request, ...patch });
  const setAuth = (auth: Auth) => set({ auth });
  const setBody = (body: Body) => set({ body });
  const count = (rows: { enabled: boolean; name: string }[]) => rows.filter((row) => row.enabled && row.name).length;
  const methods = METHODS.includes(request.method) ? METHODS : [...METHODS, request.method];
  const auth = request.auth;
  const body = request.body;

  return (
    <section className="editor" aria-label="Request">
      <form
        className="urlbar"
        onSubmit={(event) => {
          event.preventDefault();
          if (sending) onCancel();
          else onSend();
        }}
      >
        <select className={`method m-${request.method.toLowerCase()}`} value={request.method} onChange={(event) => set({ method: event.target.value })} aria-label="Method">
          {methods.map((method) => (
            <option key={method}>{method}</option>
          ))}
        </select>
        <input
          className="url mono"
          value={request.url}
          placeholder="https://api.example.com/v1/items   ({{variables}} work here)"
          spellCheck={false}
          autoFocus
          aria-label="URL"
          onChange={(event) => set({ url: event.target.value, params: paramsFromUrl(event.target.value, request.params) })}
        />
        <button type="submit" className={`btn ${sending ? 'danger' : 'primary'}`}>
          {sending ? 'Cancel' : 'Send'}
        </button>
      </form>
      {(errors.length > 0 || missing.length > 0) && (
        <div className="notes" role="status">
          {errors.map((error) => (
            <p key={error} className="error">
              {error}
            </p>
          ))}
          {missing.length > 0 && <p className="warn">Not defined in the environment: {missing.map((name) => `{{${name}}}`).join(', ')}</p>}
        </div>
      )}

      <div className="tabs" role="tablist" aria-label="Request parts">
        {TABS.map((name) => {
          const badge =
            name === 'Params' ? count(request.params) : name === 'Headers' ? count(request.headers) : name === 'Auth' ? (auth.type === 'none' ? 0 : 1) : name === 'Body' ? (body.type === 'none' ? 0 : 1) : 0;
          return (
            <button key={name} type="button" role="tab" aria-selected={tab === name} className={tab === name ? 'active' : ''} onClick={() => setTab(name)}>
              {name}
              {badge > 0 && <span className="badge">{badge}</span>}
            </button>
          );
        })}
      </div>

      <div className="tab-body" role="tabpanel" aria-label={tab}>
        {tab === 'Params' && (
          <KeyValueTable
            label="Params"
            rows={request.params}
            namePlaceholder="parameter"
            onChange={(params) => set({ params, url: urlWithParams(request.url, params) })}
          />
        )}
        {tab === 'Headers' && (
          <>
            <KeyValueTable label="Headers" rows={request.headers} namePlaceholder="Header-Name" onChange={(headers) => set({ headers })} />
            <p className="muted small">Any header can be sent here, including Cookie, Host and Origin. Auth and Body add Authorization and Content-Type unless you set them yourself.</p>
          </>
        )}
        {tab === 'Auth' && (
          <div className="form-grid">
            <label>
              Type
              <select value={auth.type} onChange={(event) => {
                const type = event.target.value;
                setAuth(type === 'bearer' ? { type, token: '' } : type === 'basic' ? { type, username: '', password: '' } : type === 'apikey' ? { type, key: 'X-API-Key', value: '', addTo: 'header' } : { type: 'none' });
              }}>
                <option value="none">No auth</option>
                <option value="bearer">Bearer token</option>
                <option value="basic">Basic (user name and password)</option>
                <option value="apikey">API key</option>
              </select>
            </label>
            {auth.type === 'bearer' && (
              <label>
                Token
                <input className="mono" value={auth.token} onChange={(event) => setAuth({ ...auth, token: event.target.value })} spellCheck={false} placeholder="{{token}}" />
              </label>
            )}
            {auth.type === 'basic' && (
              <>
                <label>
                  User name
                  <input value={auth.username} onChange={(event) => setAuth({ ...auth, username: event.target.value })} spellCheck={false} />
                </label>
                <label>
                  Password
                  <input type="password" value={auth.password} onChange={(event) => setAuth({ ...auth, password: event.target.value })} />
                </label>
              </>
            )}
            {auth.type === 'apikey' && (
              <>
                <label>
                  Key
                  <input className="mono" value={auth.key} onChange={(event) => setAuth({ ...auth, key: event.target.value })} spellCheck={false} />
                </label>
                <label>
                  Value
                  <input className="mono" value={auth.value} onChange={(event) => setAuth({ ...auth, value: event.target.value })} spellCheck={false} placeholder="{{api_key}}" />
                </label>
                <label>
                  Add to
                  <select value={auth.addTo} onChange={(event) => setAuth({ ...auth, addTo: event.target.value as 'header' | 'query' })}>
                    <option value="header">Header</option>
                    <option value="query">Query parameter</option>
                  </select>
                </label>
              </>
            )}
          </div>
        )}
        {tab === 'Body' && (
          <div className="stack">
            <div className="segmented" role="radiogroup" aria-label="Body type">
              {(
                [
                  ['none', 'None'],
                  ['raw', 'Raw (JSON, text, XML)'],
                  ['form', 'Form data (files)'],
                  ['urlencoded', 'URL-encoded'],
                  ['file', 'Binary file'],
                ] as const
              ).map(([type, label]) => (
                <button
                  key={type}
                  type="button"
                  role="radio"
                  aria-checked={body.type === type}
                  className={body.type === type ? 'active' : ''}
                  onClick={() =>
                    setBody(
                      type === 'raw'
                        ? { type, contentType: 'application/json', text: body.type === 'raw' ? body.text : '' }
                        : type === 'form' || type === 'urlencoded'
                          ? { type, fields: body.type === 'form' || body.type === 'urlencoded' ? body.fields : [] }
                          : type === 'file'
                            ? { type, filePath: '', contentType: '' }
                            : { type: 'none' },
                    )
                  }
                >
                  {label}
                </button>
              ))}
            </div>
            {body.type === 'raw' && (
              <>
                <label className="inline">
                  Content-Type
                  <select value={RAW_TYPES.includes(body.contentType) ? body.contentType : ''} onChange={(event) => setBody({ ...body, contentType: event.target.value })}>
                    {RAW_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                    {!RAW_TYPES.includes(body.contentType) && <option value="">{body.contentType || '(none)'}</option>}
                  </select>
                  {body.contentType === 'application/json' && (
                    <button
                      type="button"
                      className="btn small ghost"
                      onClick={() => {
                        try {
                          setBody({ ...body, text: JSON.stringify(JSON.parse(body.text), null, 2) });
                        } catch {
                          // Not valid JSON (it may contain {{variables}}); leave it as it is.
                        }
                      }}
                    >
                      Format JSON
                    </button>
                  )}
                </label>
                <textarea className="mono code" value={body.text} rows={12} spellCheck={false} onChange={(event) => setBody({ ...body, text: event.target.value })} aria-label="Raw body" placeholder={'{\n  "name": "value"\n}'} />
              </>
            )}
            {body.type === 'form' && <KeyValueTable label="Form fields" rows={body.fields} allowFiles onChange={(fields) => setBody({ ...body, fields })} />}
            {body.type === 'urlencoded' && <KeyValueTable label="Fields" rows={body.fields} onChange={(fields) => setBody({ ...body, fields })} />}
            {body.type === 'file' && (
              <div className="form-grid">
                <div className="kv-file">
                  <button
                    type="button"
                    className="btn small"
                    onClick={async () => {
                      const [path] = await window.api.chooseFiles();
                      if (path) setBody({ ...body, filePath: path });
                    }}
                  >
                    {body.filePath ? 'Change file' : 'Choose file'}
                  </button>
                  <span className="muted mono">{body.filePath || 'No file chosen'}</span>
                </div>
                <label>
                  Content-Type (optional)
                  <input className="mono" value={body.contentType} placeholder="image/png" onChange={(event) => setBody({ ...body, contentType: event.target.value })} />
                </label>
                <p className="muted small">The file is the whole body, sent as it is, with its length: for example, a PUT to a signed storage URL.</p>
              </div>
            )}
          </div>
        )}
        {tab === 'Settings' && (
          <div className="form-grid">
            <label>
              Time limit (seconds)
              <input
                type="number"
                min={1}
                max={600}
                value={Math.round(request.settings.timeoutMs / 1000)}
                onChange={(event) => set({ settings: { ...request.settings, timeoutMs: Number(event.target.value) * 1000 } })}
              />
            </label>
            <label className="check">
              <input type="checkbox" checked={request.settings.followRedirects} onChange={(event) => set({ settings: { ...request.settings, followRedirects: event.target.checked } })} />
              Follow redirects (up to 10)
            </label>
            <label className="check">
              <input type="checkbox" checked={request.settings.verifyTls} onChange={(event) => set({ settings: { ...request.settings, verifyTls: event.target.checked } })} />
              Verify TLS certificates (turn off only for local servers with self-signed certificates)
            </label>
            <label>
              Proxy (optional)
              <input className="mono" value={request.settings.proxy} placeholder="http://127.0.0.1:8888" onChange={(event) => set({ settings: { ...request.settings, proxy: event.target.value } })} spellCheck={false} />
            </label>
          </div>
        )}
        {tab === 'Code' && (
          <div className="stack">
            {payload ? (
              <>
                <div className="row">
                  <Copy text={payloadToCurl(payload)} label="Copy as curl" />
                  <Copy text={payloadToFetch(payload)} label="Copy as fetch" />
                </div>
                <pre className="mono code">{payloadToCurl(payload)}</pre>
              </>
            ) : (
              <p className="muted">Fix the request first; the code appears here.</p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
