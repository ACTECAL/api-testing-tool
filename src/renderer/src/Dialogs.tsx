// Modal dialogs: import curl, save a request, manage environments, and a simple name prompt.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { newId, type Collection, type Environment } from '@shared/types';
import { requestFromCurl, type CurlImport } from '@shared/curlRequest';
import KeyValueTable from './KeyValueTable';

export function Modal({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? 'wide' : ''}`}
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header>
        <h2>{title}</h2>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
          ×
        </button>
      </header>
      <div className="modal-body">{children}</div>
    </dialog>
  );
}

export function CurlDialog({ onImport, onClose }: { onImport: (result: CurlImport) => void; onClose: () => void }) {
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  return (
    <Modal title="Import a curl command" onClose={onClose} wide>
      <p className="muted small">Paste a command from API documentation, or “Copy as cURL” from a browser’s developer tools (bash or cmd).</p>
      <textarea
        className="mono code"
        rows={10}
        value={text}
        autoFocus
        spellCheck={false}
        placeholder="curl 'https://api.example.com/v1/items' -H 'Authorization: Bearer …'"
        onChange={(event) => {
          setText(event.target.value);
          setError('');
        }}
        aria-label="curl command"
      />
      {error && <p className="error">{error}</p>}
      <div className="row end">
        <button type="button" className="btn ghost" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="btn primary"
          disabled={!text.trim()}
          onClick={() => {
            try {
              onImport(requestFromCurl(text));
            } catch (problem) {
              setError((problem as Error).message);
            }
          }}
        >
          Import
        </button>
      </div>
    </Modal>
  );
}

export function SaveDialog({ collections, name, onSave, onClose }: { collections: Collection[]; name: string; onSave: (target: { collectionId: string | null; newCollection: string; name: string }) => void; onClose: () => void }) {
  const [requestName, setRequestName] = useState(name);
  const [collectionId, setCollectionId] = useState<string>(collections[0]?.id ?? '');
  const [newCollection, setNewCollection] = useState(collections.length ? '' : 'My collection');
  const creating = !collectionId;
  return (
    <Modal title="Save request" onClose={onClose}>
      <form
        className="form-grid"
        onSubmit={(event) => {
          event.preventDefault();
          onSave({ collectionId: creating ? null : collectionId, newCollection: newCollection.trim(), name: requestName.trim() || 'Untitled request' });
        }}
      >
        <label>
          Name
          <input value={requestName} onChange={(event) => setRequestName(event.target.value)} autoFocus />
        </label>
        <label>
          Collection
          <select value={collectionId} onChange={(event) => setCollectionId(event.target.value)}>
            {collections.map((collection) => (
              <option key={collection.id} value={collection.id}>
                {collection.name}
              </option>
            ))}
            <option value="">New collection…</option>
          </select>
        </label>
        {creating && (
          <label>
            New collection name
            <input value={newCollection} onChange={(event) => setNewCollection(event.target.value)} required />
          </label>
        )}
        <div className="row end">
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary">
            Save
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function PromptDialog({ title, label, value, onSubmit, onClose }: { title: string; label: string; value: string; onSubmit: (value: string) => void; onClose: () => void }) {
  const [text, setText] = useState(value);
  return (
    <Modal title={title} onClose={onClose}>
      <form
        className="form-grid"
        onSubmit={(event) => {
          event.preventDefault();
          if (text.trim()) onSubmit(text.trim());
        }}
      >
        <label>
          {label}
          <input value={text} onChange={(event) => setText(event.target.value)} autoFocus />
        </label>
        <div className="row end">
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={!text.trim()}>
            OK
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function EnvironmentsDialog({
  environments,
  secretsAvailable,
  onSave,
  onDelete,
  onClose,
}: {
  environments: Environment[];
  secretsAvailable: boolean;
  onSave: (environment: Environment) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<string>(environments[0]?.id ?? '');
  const [draft, setDraft] = useState<Environment | null>(environments[0] ? structuredClone(environments[0]) : null);
  const [status, setStatus] = useState('');
  function open(id: string) {
    setSelected(id);
    const environment = environments.find((item) => item.id === id);
    setDraft(environment ? structuredClone(environment) : null);
    setStatus('');
  }
  return (
    <Modal title="Environments" onClose={onClose} wide>
      <div className="env-layout">
        <nav aria-label="Environments">
          {environments.map((environment) => (
            <button key={environment.id} type="button" className={`env-item ${selected === environment.id ? 'active' : ''}`} onClick={() => open(environment.id)}>
              {environment.name}
            </button>
          ))}
          <button
            type="button"
            className="btn small ghost"
            onClick={() => {
              const environment: Environment = { id: newId('env'), name: `Environment ${environments.length + 1}`, variables: [] };
              setSelected(environment.id);
              setDraft(environment);
            }}
          >
            + New environment
          </button>
        </nav>
        {draft ? (
          <div className="stack">
            <label>
              Name
              <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
            </label>
            <KeyValueTable label="Variables" rows={draft.variables} namePlaceholder="base_url" valuePlaceholder="https://api.example.com" allowSecret onChange={(variables) => setDraft({ ...draft, variables })} />
            <p className="muted small">
              Use a variable as {'{{name}}'} in the URL, headers, auth or body. Secret values are {secretsAvailable ? 'encrypted with your system keychain and kept out of the workspace folder' : 'kept only until the app closes, because no system keychain is available'}.
            </p>
            <div className="row end">
              {environments.some((item) => item.id === draft.id) && (
                <button
                  type="button"
                  className="btn ghost danger-text"
                  onClick={async () => {
                    if (!window.confirm(`Delete the environment "${draft.name}"?`)) return;
                    await onDelete(draft.id);
                    setDraft(null);
                    setSelected('');
                  }}
                >
                  Delete
                </button>
              )}
              <button
                type="button"
                className="btn primary"
                onClick={async () => {
                  await onSave({ ...draft, name: draft.name.trim() || 'Environment' });
                  setStatus('Saved.');
                }}
              >
                Save
              </button>
            </div>
            {status && <p className="muted small">{status}</p>}
          </div>
        ) : (
          <p className="muted">Create an environment to keep values such as base URLs and tokens in one place.</p>
        )}
      </div>
    </Modal>
  );
}
