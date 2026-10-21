// Collections (saved requests), history, and the workspace folder.
import { useState } from 'react';
import type { Collection, HistoryEntry, RequestDoc, Workspace } from '@shared/types';

interface Props {
  workspace: Workspace;
  activeId: string;
  onOpen: (request: RequestDoc, collectionId: string | null) => void;
  onNew: () => void;
  onImport: () => void;
  onNewCollection: () => void;
  onRenameCollection: (collection: Collection) => void;
  onDeleteCollection: (collection: Collection) => void;
  onDeleteRequest: (collection: Collection, request: RequestDoc) => void;
  onChooseWorkspace: () => void;
  onClearHistory: () => void;
}

const methodClass = (method: string) => `m m-${method.toLowerCase()}`;

function shortUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname}`;
  } catch {
    return url;
  }
}

export default function Sidebar(props: Props) {
  const { workspace, activeId } = props;
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setClosed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const history: HistoryEntry[] = workspace.history.slice(0, 30);

  return (
    <aside className="sidebar" aria-label="Collections and history">
      <div className="brand">
        <span className="logo" aria-hidden="true">
          ⚡
        </span>
        <span>Actecal API Tester</span>
      </div>
      <div className="row">
        <button type="button" className="btn small primary" onClick={props.onNew}>
          New request
        </button>
        <button type="button" className="btn small" onClick={props.onImport}>
          Import curl
        </button>
      </div>

      <div className="side-section">
        <div className="side-head">
          <h2>Collections</h2>
          <button type="button" className="icon-btn" onClick={props.onNewCollection} aria-label="New collection" title="New collection">
            +
          </button>
        </div>
        {workspace.collections.length === 0 && <p className="muted small">Save a request to start a collection.</p>}
        {workspace.collections.map((collection) => (
          <div key={collection.id} className="collection">
            <div className="collection-head">
              <button type="button" className="collection-name" aria-expanded={!closed.has(collection.id)} onClick={() => toggle(collection.id)}>
                <span aria-hidden="true">{closed.has(collection.id) ? '▸' : '▾'}</span> {collection.name}
              </button>
              <button type="button" className="icon-btn" onClick={() => props.onRenameCollection(collection)} aria-label={`Rename ${collection.name}`} title="Rename">
                ✎
              </button>
              <button type="button" className="icon-btn" onClick={() => props.onDeleteCollection(collection)} aria-label={`Delete ${collection.name}`} title="Delete">
                ×
              </button>
            </div>
            {!closed.has(collection.id) && (
              <ul>
                {collection.requests.map((request) => (
                  <li key={request.id} className={request.id === activeId ? 'active' : ''}>
                    <button type="button" className="request-link" onClick={() => props.onOpen(request, collection.id)}>
                      <span className={methodClass(request.method)}>{request.method}</span>
                      <span className="request-name">{request.name}</span>
                    </button>
                    <button type="button" className="icon-btn" onClick={() => props.onDeleteRequest(collection, request)} aria-label={`Delete ${request.name}`} title="Delete">
                      ×
                    </button>
                  </li>
                ))}
                {collection.requests.length === 0 && <li className="muted small">No requests yet.</li>}
              </ul>
            )}
          </div>
        ))}
      </div>

      <div className="side-section grow">
        <div className="side-head">
          <h2>History</h2>
          {history.length > 0 && (
            <button type="button" className="btn small ghost" onClick={props.onClearHistory}>
              Clear
            </button>
          )}
        </div>
        <ul>
          {history.map((entry) => (
            <li key={entry.id}>
              <button type="button" className="request-link" onClick={() => props.onOpen(entry.request, null)} title={entry.url}>
                <span className={methodClass(entry.method)}>{entry.method}</span>
                <span className="request-name">{shortUrl(entry.url)}</span>
                <span className={`code-chip ${entry.status === null ? 'bad' : entry.status < 400 ? 'ok' : 'warn'}`}>{entry.status ?? '—'}</span>
              </button>
            </li>
          ))}
          {history.length === 0 && <li className="muted small">Sent requests appear here.</li>}
        </ul>
      </div>

      <div className="workspace">
        <span className="muted small" title={workspace.path}>
          Workspace: {workspace.path.split(/[\\/]/).pop()}
        </span>
        <button type="button" className="btn small ghost" onClick={props.onChooseWorkspace}>
          Change folder
        </button>
      </div>
    </aside>
  );
}
