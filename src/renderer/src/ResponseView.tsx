// The response: status, time and size, then the body (formatted JSON, text or an image), headers and cookies.
// Response HTML is shown as text, never rendered.
import { useEffect, useMemo, useState } from 'react';
import type { HttpResult } from '@shared/types';

const TABS = ['Body', 'Headers', 'Cookies'] as const;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function statusTone(status: number): string {
  return status < 300 ? 'ok' : status < 400 ? 'info' : status < 500 ? 'warn' : 'bad';
}

export default function ResponseView({ result, sending }: { result: HttpResult | null; sending: boolean }) {
  const [tab, setTab] = useState<(typeof TABS)[number]>('Body');
  const [raw, setRaw] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  useEffect(() => setSaved(null), [result]);

  const view = useMemo(() => {
    if (!result || !result.ok) return null;
    const type = result.headers.find(([name]) => name.toLowerCase() === 'content-type')?.[1] || '';
    const charset = /charset=([^;]+)/i.exec(type)?.[1]?.trim() || 'utf-8';
    let text = '';
    try {
      text = new TextDecoder(charset).decode(result.body);
    } catch {
      text = new TextDecoder().decode(result.body);
    }
    let pretty: string | null = null;
    if (/json/i.test(type) || /^\s*[[{]/.test(text)) {
      try {
        pretty = JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        pretty = null;
      }
    }
    const image = /^image\/(png|jpe?g|gif|webp|bmp|x-icon|avif)/i.test(type) ? URL.createObjectURL(new Blob([result.body as BlobPart], { type })) : null;
    const binary = !image && !pretty && /[\x00-\x08\x0e-\x1f]/.test(text.slice(0, 2000));
    const cookies = result.headers.filter(([name]) => name.toLowerCase() === 'set-cookie').map(([, value]) => value);
    return { type, text, pretty, image, binary, cookies };
  }, [result]);
  useEffect(() => () => {
    if (view?.image) URL.revokeObjectURL(view.image);
  }, [view]);

  if (sending) return <section className="response empty" aria-live="polite">Sending…</section>;
  if (!result) return <section className="response empty">Send a request to see the response here. Cmd/Ctrl + Enter sends.</section>;
  if (!result.ok) {
    return (
      <section className="response" aria-live="polite">
        <div className="status-line">
          <span className="status bad">{result.kind === 'cancelled' ? 'Cancelled' : 'No response'}</span>
          <span className="muted">{result.timings.totalMs} ms</span>
        </div>
        <p className="error big">{result.message}</p>
      </section>
    );
  }

  const name = (() => {
    try {
      return new URL(result.url).pathname.split('/').pop() || 'response';
    } catch {
      return 'response';
    }
  })();

  return (
    <section className="response" aria-live="polite">
      <div className="status-line">
        <span className={`status ${statusTone(result.status)}`}>
          {result.status} {result.statusText}
        </span>
        <span className="muted">{result.timings.totalMs} ms</span>
        <span className="muted">{formatBytes(result.body.length)}{result.truncated ? ' (first 50 MB)' : ''}</span>
        {result.redirects > 0 && <span className="muted">{result.redirects} redirect{result.redirects > 1 ? 's' : ''}</span>}
        <span className="spacer" />
        <button
          type="button"
          className="btn small"
          onClick={async () => {
            const path = await window.api.saveResponse({ name, bytes: result.body });
            if (path) setSaved(path);
          }}
        >
          Save body
        </button>
      </div>
      {saved && <p className="muted small">Saved to {saved}</p>}
      <div className="tabs" role="tablist" aria-label="Response parts">
        {TABS.map((item) => (
          <button key={item} type="button" role="tab" aria-selected={tab === item} className={tab === item ? 'active' : ''} onClick={() => setTab(item)}>
            {item}
            {item === 'Headers' && <span className="badge">{result.headers.length}</span>}
            {item === 'Cookies' && view && view.cookies.length > 0 && <span className="badge">{view.cookies.length}</span>}
          </button>
        ))}
        {tab === 'Body' && view?.pretty && (
          <label className="check right">
            <input type="checkbox" checked={raw} onChange={(event) => setRaw(event.target.checked)} />
            Raw
          </label>
        )}
      </div>
      <div className="tab-body response-body" role="tabpanel" aria-label={tab}>
        {tab === 'Body' && view && (
          view.image ? (
            <img className="preview" src={view.image} alt="Response image" />
          ) : view.binary ? (
            <p className="muted">Binary content ({view.type || 'unknown type'}). Use Save body to keep it.</p>
          ) : (
            <pre className="mono code">{raw || !view.pretty ? view.text : view.pretty}</pre>
          )
        )}
        {tab === 'Headers' && (
          <table className="headers">
            <tbody>
              {result.headers.map(([key, value], index) => (
                <tr key={`${key}-${index}`}>
                  <th className="mono">{key}</th>
                  <td className="mono">{value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {tab === 'Cookies' &&
          (view && view.cookies.length ? (
            <ul className="cookies mono">
              {view.cookies.map((cookie, index) => (
                <li key={index}>{cookie}</li>
              ))}
            </ul>
          ) : (
            <p className="muted">The response set no cookies.</p>
          ))}
      </div>
    </section>
  );
}
