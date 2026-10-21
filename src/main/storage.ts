// Everything the user creates is stored on this computer. Collections and environments are JSON files in a
// workspace folder (default: Documents/Actecal API Tester) that can be kept in git. Secret variable values
// are kept out of that folder, encrypted with the system keychain (Electron safeStorage), in the app's
// data folder, as is the request history.
import { app, safeStorage } from 'electron';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Collection, Environment, HistoryEntry, KeyValue, Workspace } from '../shared/types';

const MAX_HISTORY = 100;
const ID = /^[A-Za-z0-9_-]{1,80}$/;

const dataFile = (name: string) => join(app.getPath('userData'), name);

function readJson<T>(path: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return fallback;
  }
}
// Writes to a temporary file first, so a crash never leaves half a file.
function writeJson(path: string, value: unknown): void {
  const temp = `${path}.tmp`;
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(temp, path);
}

interface Settings {
  workspacePath?: string;
}
const settings = (): Settings => readJson<Settings>(dataFile('settings.json'), {});

export function workspacePath(): string {
  const chosen = settings().workspacePath;
  const fallback = process.env.API_TESTER_WORKSPACE || join(app.getPath('documents'), 'Actecal API Tester');
  const path = chosen && existsSync(chosen) ? chosen : fallback;
  mkdirSync(join(path, 'collections'), { recursive: true });
  mkdirSync(join(path, 'environments'), { recursive: true });
  return path;
}

export function setWorkspacePath(path: string): void {
  writeJson(dataFile('settings.json'), { ...settings(), workspacePath: path });
}

// ---------- Files the user may send ----------
// The renderer can only name files that the user picked in a dialog, or that saved requests already use.
const allowedFiles = new Set<string>();
export const allowFiles = (paths: string[]) => paths.forEach((path) => allowedFiles.add(path));
export const fileAllowed = (path: string) => allowedFiles.has(path);

function filesIn(collection: Collection): string[] {
  const paths: string[] = [];
  for (const request of collection.requests || []) {
    const body = request.body;
    if (body?.type === 'file' && body.filePath) paths.push(body.filePath);
    if (body?.type === 'form') body.fields.forEach((field) => field.filePath && paths.push(field.filePath));
  }
  return paths;
}

// ---------- Secrets ----------
type SecretStore = Record<string, string>;
const secretKey = (environmentId: string, name: string) => `${environmentId}:${name}`;
export const secretsAvailable = () => safeStorage.isEncryptionAvailable();
const sessionSecrets: SecretStore = {};

function readSecrets(): SecretStore {
  if (!secretsAvailable()) return sessionSecrets;
  const stored = readJson<SecretStore>(dataFile('secrets.json'), {});
  const plain: SecretStore = {};
  for (const [key, value] of Object.entries(stored)) {
    try {
      plain[key] = safeStorage.decryptString(Buffer.from(value, 'base64'));
    } catch {
      // Encrypted on another machine or with another key; skip it.
    }
  }
  return plain;
}
function writeSecrets(plain: SecretStore): void {
  if (!secretsAvailable()) {
    Object.assign(sessionSecrets, plain);
    return;
  }
  const stored: SecretStore = {};
  for (const [key, value] of Object.entries(plain)) stored[key] = safeStorage.encryptString(value).toString('base64');
  writeJson(dataFile('secrets.json'), stored);
}

// ---------- Load and save ----------
function listJson<T>(folder: string): T[] {
  return readdirSync(folder)
    .filter((name) => name.endsWith('.json'))
    .map((name) => readJson<T | null>(join(folder, name), null))
    .filter((item): item is T => Boolean(item));
}

export function loadWorkspace(): Workspace {
  const path = workspacePath();
  const collections = listJson<Collection>(join(path, 'collections')).filter((item) => ID.test(item.id) && Array.isArray(item.requests));
  collections.forEach((collection) => allowFiles(filesIn(collection)));
  const secrets = readSecrets();
  const environments = listJson<Environment>(join(path, 'environments'))
    .filter((item) => ID.test(item.id) && Array.isArray(item.variables))
    .map((environment) => ({
      ...environment,
      variables: environment.variables.map((row: KeyValue) => (row.secret ? { ...row, value: secrets[secretKey(environment.id, row.name)] ?? '' } : row)),
    }));
  const history = readJson<HistoryEntry[]>(dataFile('history.json'), []);
  history.forEach((entry) => entry.request && allowFiles(filesIn({ id: 'history', name: '', requests: [entry.request] })));
  return { path, collections: collections.sort((a, b) => a.name.localeCompare(b.name)), environments: environments.sort((a, b) => a.name.localeCompare(b.name)), history };
}

function checkId(id: string): void {
  if (!ID.test(id)) throw new Error('Invalid id.');
}

export function saveCollection(collection: Collection): void {
  checkId(collection.id);
  const unknown = filesIn(collection).filter((path) => !fileAllowed(path));
  if (unknown.length) throw new Error('A request uses a file that was not chosen in this app.');
  writeJson(join(workspacePath(), 'collections', `${collection.id}.json`), collection);
}

export function deleteCollection(id: string): void {
  checkId(id);
  rmSync(join(workspacePath(), 'collections', `${id}.json`), { force: true });
}

export function saveEnvironment(environment: Environment): void {
  checkId(environment.id);
  const secrets = readSecrets();
  for (const key of Object.keys(secrets)) if (key.startsWith(`${environment.id}:`)) delete secrets[key];
  const variables = environment.variables.map((row) => {
    if (!row.secret) return row;
    secrets[secretKey(environment.id, row.name)] = row.value;
    return { ...row, value: '' };
  });
  writeSecrets(secrets);
  writeJson(join(workspacePath(), 'environments', `${environment.id}.json`), { ...environment, variables });
}

export function deleteEnvironment(id: string): void {
  checkId(id);
  rmSync(join(workspacePath(), 'environments', `${id}.json`), { force: true });
  const secrets = readSecrets();
  for (const key of Object.keys(secrets)) if (key.startsWith(`${id}:`)) delete secrets[key];
  writeSecrets(secrets);
}

export function addHistory(entry: HistoryEntry): HistoryEntry[] {
  if (filesIn({ id: 'history', name: '', requests: [entry.request] }).some((path) => !fileAllowed(path))) throw new Error('A request uses a file that was not chosen in this app.');
  const history = [entry, ...readJson<HistoryEntry[]>(dataFile('history.json'), [])].slice(0, MAX_HISTORY);
  writeJson(dataFile('history.json'), history);
  return history;
}

export function clearHistory(): void {
  writeJson(dataFile('history.json'), []);
}
