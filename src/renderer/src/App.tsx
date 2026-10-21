import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildPayload } from '@shared/build';
import { newId, newRequest, type Collection, type Environment, type HttpResult, type RequestDoc, type Workspace } from '@shared/types';
import type { CurlImport } from '@shared/curlRequest';
import RequestEditor from './RequestEditor';
import ResponseView from './ResponseView';
import Sidebar from './Sidebar';
import { CurlDialog, EnvironmentsDialog, PromptDialog, SaveDialog } from './Dialogs';

type DialogState =
  | null
  | { type: 'curl' }
  | { type: 'save' }
  | { type: 'environments' }
  | { type: 'prompt'; title: string; label: string; value: string; onSubmit: (value: string) => void };

const ENV_KEY = 'active-environment';

export default function App() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [info, setInfo] = useState({ version: '', platform: '', secretsAvailable: true });
  const [request, setRequest] = useState<RequestDoc>(() => newRequest());
  const [savedIn, setSavedIn] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [environmentId, setEnvironmentId] = useState(() => localStorage.getItem(ENV_KEY) || '');
  const [result, setResult] = useState<HttpResult | null>(null);
  const [sending, setSending] = useState(false);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [notice, setNotice] = useState<{ tone: 'info' | 'error'; text: string } | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [update, setUpdate] = useState<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const say = useCallback((text: string, tone: 'info' | 'error' = 'info') => {
    setNotice({ tone, text });
    clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 5000);
  }, []);

  useEffect(() => {
    window.api.loadWorkspace().then(setWorkspace, (error) => say(`The workspace could not be opened: ${error.message}`, 'error'));
    window.api.info().then(setInfo);
  }, [say]);

  const environment: Environment | null = workspace?.environments.find((item) => item.id === environmentId) ?? null;
  const built = useMemo(() => buildPayload(request, environment), [request, environment]);
  const [shownErrors, setShownErrors] = useState<string[]>([]);
  useEffect(() => setShownErrors([]), [request]);

  function change(next: RequestDoc) {
    setRequest(next);
    setDirty(true);
  }

  function open(doc: RequestDoc, collectionId: string | null) {
    if (dirty && !window.confirm('Discard the changes to the open request?')) return;
    // History entries open as unsaved copies.
    setRequest(collectionId ? structuredClone(doc) : { ...structuredClone(doc), id: newId('req') });
    setSavedIn(collectionId);
    setDirty(false);
    setResult(null);
    setNotes([]);
  }

  async function send() {
    if (!built.payload) {
      setShownErrors(built.errors);
      return;
    }
    setSending(true);
    setResult(null);
    const payload = built.payload;
    try {
      const response = await window.api.send(payload);
      setResult(response);
      const history = await window.api.addHistory({ id: newId('h'), at: new Date().toISOString(), method: payload.method, url: payload.url, status: response.ok ? response.status : null, request });
      setWorkspace((current) => (current ? { ...current, history } : current));
    } catch (error) {
      setResult({ ok: false, kind: 'invalid', message: (error as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), timings: { totalMs: 0 } });
    } finally {
      setSending(false);
    }
  }

  async function writeCollection(collection: Collection) {
    await window.api.saveCollection(collection);
    setWorkspace((current) => {
      if (!current) return current;
      const others = current.collections.filter((item) => item.id !== collection.id);
      return { ...current, collections: [...others, collection].sort((a, b) => a.name.localeCompare(b.name)) };
    });
  }

  async function save(target?: { collectionId: string | null; newCollection: string; name: string }) {
    if (!workspace) return;
    if (!target && !savedIn) {
      setDialog({ type: 'save' });
      return;
    }
    try {
      const doc = target ? { ...request, name: target.name } : request;
      let collection = workspace.collections.find((item) => item.id === (target ? target.collectionId : savedIn));
      if (!collection) collection = { id: newId('col'), name: target?.newCollection || 'My collection', requests: [] };
      const requests = collection.requests.some((item) => item.id === doc.id) ? collection.requests.map((item) => (item.id === doc.id ? doc : item)) : [...collection.requests, doc];
      await writeCollection({ ...collection, requests });
      setRequest(doc);
      setSavedIn(collection.id);
      setDirty(false);
      setDialog(null);
      say(`Saved in ${collection.name}.`);
    } catch (error) {
      say(`Not saved: ${(error as Error).message}`, 'error');
    }
  }

  // Cmd/Ctrl + Enter sends, Cmd/Ctrl + S saves.
  const keys = useRef({ send, save });
  keys.current = { send, save };
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || dialog) return;
      if (event.key === 'Enter') {
        event.preventDefault();
        keys.current.send();
      } else if (event.key.toLowerCase() === 's') {
        event.preventDefault();
        keys.current.save();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dialog]);

  function importCurl({ request: doc, notes: importNotes }: CurlImport) {
    if (dirty && !window.confirm('Discard the changes to the open request?')) return;
    setRequest(doc);
    setSavedIn(null);
    setDirty(true);
    setResult(null);
    setNotes(importNotes);
    setDialog(null);
  }

  if (!workspace) return <div className="loading">{notice ? notice.text : 'Opening the workspace…'}</div>;

  return (
    <div className="app">
      <Sidebar
        workspace={workspace}
        activeId={request.id}
        onOpen={open}
        onNew={() => open(newRequest(), null)}
        onImport={() => setDialog({ type: 'curl' })}
        onNewCollection={() =>
          setDialog({
            type: 'prompt',
            title: 'New collection',
            label: 'Name',
            value: 'My collection',
            onSubmit: async (name) => {
              await writeCollection({ id: newId('col'), name, requests: [] });
              setDialog(null);
            },
          })
        }
        onRenameCollection={(collection) =>
          setDialog({
            type: 'prompt',
            title: 'Rename collection',
            label: 'Name',
            value: collection.name,
            onSubmit: async (name) => {
              await writeCollection({ ...collection, name });
              setDialog(null);
            },
          })
        }
        onDeleteCollection={async (collection) => {
          if (!window.confirm(`Delete the collection "${collection.name}" and its ${collection.requests.length} requests?`)) return;
          await window.api.deleteCollection(collection.id);
          setWorkspace({ ...workspace, collections: workspace.collections.filter((item) => item.id !== collection.id) });
          if (savedIn === collection.id) setSavedIn(null);
        }}
        onDeleteRequest={async (collection, doc) => {
          if (!window.confirm(`Delete "${doc.name}"?`)) return;
          await writeCollection({ ...collection, requests: collection.requests.filter((item) => item.id !== doc.id) });
          if (doc.id === request.id) setSavedIn(null);
        }}
        onChooseWorkspace={async () => {
          const next = await window.api.chooseWorkspace();
          if (next) {
            setWorkspace(next);
            setSavedIn(null);
            say(`Workspace: ${next.path}`);
          }
        }}
        onClearHistory={async () => {
          await window.api.clearHistory();
          setWorkspace({ ...workspace, history: [] });
        }}
      />

      <main className="main">
        <header className="topbar">
          <input className="title" value={request.name} onChange={(event) => change({ ...request, name: event.target.value })} aria-label="Request name" />
          {dirty && <span className="muted small">Unsaved</span>}
          <button type="button" className="btn small" onClick={() => save()}>
            Save
          </button>
          <span className="spacer" />
          <label className="inline">
            Environment
            <select
              value={environmentId}
              onChange={(event) => {
                setEnvironmentId(event.target.value);
                localStorage.setItem(ENV_KEY, event.target.value);
              }}
            >
              <option value="">No environment</option>
              {workspace.environments.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="btn small" onClick={() => setDialog({ type: 'environments' })}>
            Manage
          </button>
          <button
            type="button"
            className="btn small ghost"
            title={`Version ${info.version}`}
            onClick={async () => {
              const check = await window.api.checkUpdates().catch(() => null);
              if (!check) say('Could not reach GitHub to check for updates.', 'error');
              else if (check.newer) setUpdate(check.url);
              else say(`You have the latest version (${info.version}).`);
            }}
          >
            Check for updates
          </button>
        </header>
        {update && (
          <div className="banner">
            A new version is available.{' '}
            <button type="button" className="link" onClick={() => window.api.openExternal(update)}>
              Download it from GitHub
            </button>
          </div>
        )}
        {notes.length > 0 && (
          <div className="banner info">
            <strong>Imported from curl.</strong> {notes.join(' ')}
            <button type="button" className="icon-btn" onClick={() => setNotes([])} aria-label="Dismiss">
              ×
            </button>
          </div>
        )}
        <div className="split">
          <RequestEditor
            request={request}
            onChange={change}
            onSend={send}
            onCancel={() => window.api.cancel(request.id)}
            sending={sending}
            errors={shownErrors}
            missing={built.missing}
            payload={built.payload}
          />
          <ResponseView result={result} sending={sending} />
        </div>
      </main>

      {notice && (
        <div className={`toast ${notice.tone}`} role="status">
          {notice.text}
        </div>
      )}

      {dialog?.type === 'curl' && <CurlDialog onImport={importCurl} onClose={() => setDialog(null)} />}
      {dialog?.type === 'save' && <SaveDialog collections={workspace.collections} name={request.name} onSave={save} onClose={() => setDialog(null)} />}
      {dialog?.type === 'prompt' && <PromptDialog title={dialog.title} label={dialog.label} value={dialog.value} onSubmit={dialog.onSubmit} onClose={() => setDialog(null)} />}
      {dialog?.type === 'environments' && (
        <EnvironmentsDialog
          environments={workspace.environments}
          secretsAvailable={info.secretsAvailable}
          onSave={async (item) => {
            await window.api.saveEnvironment(item);
            setWorkspace((current) => (current ? { ...current, environments: [...current.environments.filter((env) => env.id !== item.id), item].sort((a, b) => a.name.localeCompare(b.name)) } : current));
          }}
          onDelete={async (id) => {
            await window.api.deleteEnvironment(id);
            setWorkspace((current) => (current ? { ...current, environments: current.environments.filter((env) => env.id !== id) } : current));
            if (environmentId === id) setEnvironmentId('');
          }}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}
