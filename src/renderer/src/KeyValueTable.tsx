// Editable name/value rows with an on/off switch, for params, headers, form fields and variables.
import { newRow, type KeyValue } from '@shared/types';

interface Props {
  rows: KeyValue[];
  onChange: (rows: KeyValue[]) => void;
  label: string;
  namePlaceholder?: string;
  valuePlaceholder?: string;
  /** Form data: a row can hold a file instead of text. */
  allowFiles?: boolean;
  /** Environments: a row can be marked secret (stored encrypted, shown masked). */
  allowSecret?: boolean;
}

const fileName = (path?: string) => (path ? path.split(/[\\/]/).pop() : '');

export default function KeyValueTable({ rows, onChange, label, namePlaceholder = 'Name', valuePlaceholder = 'Value', allowFiles = false, allowSecret = false }: Props) {
  const update = (id: string, patch: Partial<KeyValue>) => onChange(rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  async function chooseFile(row: KeyValue) {
    const [path] = await window.api.chooseFiles();
    if (path) update(row.id, { filePath: path });
  }
  return (
    <div className="kv" role="group" aria-label={label}>
      {rows.map((row, index) => (
        <div key={row.id} className={`kv-row ${row.enabled ? '' : 'is-off'}`}>
          <input type="checkbox" checked={row.enabled} onChange={(event) => update(row.id, { enabled: event.target.checked })} aria-label={`Use ${label.toLowerCase()} row ${index + 1}`} />
          <input className="mono" value={row.name} placeholder={namePlaceholder} spellCheck={false} onChange={(event) => update(row.id, { name: event.target.value })} aria-label={`${label} row ${index + 1}: name`} />
          {allowFiles && (
            <select value={row.kind || 'text'} onChange={(event) => update(row.id, { kind: event.target.value as KeyValue['kind'] })} aria-label={`${label} row ${index + 1}: type`}>
              <option value="text">Text</option>
              <option value="file">File</option>
            </select>
          )}
          {row.kind === 'file' ? (
            <div className="kv-file">
              <button type="button" className="btn small" onClick={() => chooseFile(row)}>
                {row.filePath ? 'Change file' : 'Choose file'}
              </button>
              <span className="muted" title={row.filePath}>
                {row.filePath ? fileName(row.filePath) : row.value ? `Choose ${row.value}` : 'No file chosen'}
              </span>
            </div>
          ) : (
            <input
              className="mono"
              type={allowSecret && row.secret ? 'password' : 'text'}
              value={row.value}
              placeholder={valuePlaceholder}
              spellCheck={false}
              onChange={(event) => update(row.id, { value: event.target.value })}
              aria-label={`${label} row ${index + 1}: value`}
            />
          )}
          {allowSecret && (
            <label className="kv-secret">
              <input type="checkbox" checked={Boolean(row.secret)} onChange={(event) => update(row.id, { secret: event.target.checked })} />
              Secret
            </label>
          )}
          <button type="button" className="icon-btn" onClick={() => onChange(rows.filter((item) => item.id !== row.id))} aria-label={`Remove ${label.toLowerCase()} row ${index + 1}`}>
            ×
          </button>
        </div>
      ))}
      <button type="button" className="btn small ghost" onClick={() => onChange([...rows, newRow(allowFiles ? { kind: 'text' } : {})])}>
        + Add
      </button>
    </div>
  );
}
