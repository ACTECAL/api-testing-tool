// Main process: one window with Electron's security settings on, and a small, validated IPC surface.
// The renderer has no Node access and no network access of its own (its CSP allows none); every request
// goes out from here, after checks on what the renderer asked for.
import { app, BrowserWindow, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Collection, Environment, HistoryEntry, SendPayload } from '../shared/types';
import { cancelRequest, sendRequest } from './http';
import {
  addHistory,
  allowFiles,
  clearHistory,
  deleteCollection,
  deleteEnvironment,
  fileAllowed,
  loadWorkspace,
  saveCollection,
  saveEnvironment,
  secretsAvailable,
  setWorkspacePath,
} from './storage';

const REPOSITORY = 'ACTECAL/api-testing-tool';
let window: BrowserWindow | null = null;

// For tests and portable use: keep the app's data in another folder.
if (process.env.API_TESTER_USER_DATA) app.setPath('userData', process.env.API_TESTER_USER_DATA);

function createWindow(): void {
  window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 560,
    show: false,
    title: 'Actecal API Tester',
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  });
  window.once('ready-to-show', () => window?.show());
  // The app never navigates or opens windows; links open in the browser, and only https ones.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    // Development: show the page's warnings and errors in the terminal.
    window.webContents.on('console-message', (event) => {
      if (event.level === 'warning' || event.level === 'error') console.log(`[renderer ${event.level}] ${event.message}`);
    });
    window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else window.loadFile(join(__dirname, '../renderer/index.html'));
}

// ---------- IPC, with every argument checked ----------
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isString = (value: unknown, max = 1_000_000): value is string => typeof value === 'string' && value.length <= max;

function checkPayload(value: unknown): SendPayload {
  if (!isObject(value)) throw new Error('Invalid request.');
  const p = value as unknown as SendPayload;
  if (!isString(p.id, 100) || !isString(p.method, 20) || !isString(p.url, 65_536) || !/^https?:\/\//i.test(p.url)) throw new Error('Invalid request.');
  if (!Array.isArray(p.headers) || p.headers.length > 500 || !p.headers.every((pair) => Array.isArray(pair) && pair.length === 2 && isString(pair[0], 1000) && isString(pair[1], 65_536))) throw new Error('Invalid headers.');
  if (typeof p.timeoutMs !== 'number' || p.timeoutMs < 1000 || p.timeoutMs > 600_000) throw new Error('Invalid time limit.');
  if (typeof p.followRedirects !== 'boolean' || typeof p.verifyTls !== 'boolean' || !isString(p.proxy, 2000)) throw new Error('Invalid settings.');
  const body = p.body;
  if (!isObject(body)) throw new Error('Invalid body.');
  if (body.type === 'text' && !isString(body.text, 100 * 1024 * 1024)) throw new Error('Invalid body.');
  if (body.type === 'file' && !(isString(body.filePath, 4096) && fileAllowed(body.filePath))) throw new Error('Choose the body file again: only files picked in this app can be sent.');
  if (body.type === 'form') {
    if (!Array.isArray(body.fields) || body.fields.length > 1000) throw new Error('Invalid form.');
    for (const field of body.fields) {
      if (!isObject(field) || !isString(field.name, 1000)) throw new Error('Invalid form.');
      if (field.filePath !== undefined && !(isString(field.filePath, 4096) && fileAllowed(field.filePath))) throw new Error('Choose the form files again: only files picked in this app can be sent.');
      if (field.value !== undefined && !isString(field.value, 100 * 1024 * 1024)) throw new Error('Invalid form.');
    }
  } else if (!['none', 'text', 'file'].includes(body.type as string)) throw new Error('Invalid body.');
  return p;
}

const documentShape = (value: unknown, list: 'requests' | 'variables') => isObject(value) && isString(value.id, 100) && isString(value.name, 500) && Array.isArray(value[list]);

function handle(channel: string, listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown): void {
  ipcMain.handle(channel, (event, ...args) => {
    // Only the app's own page may call in.
    if (event.senderFrame?.url && !/^(file:|http:\/\/localhost:|http:\/\/127\.0\.0\.1:)/.test(event.senderFrame.url)) throw new Error('Not allowed.');
    return listener(event, ...args);
  });
}

function registerIpc(): void {
  handle('app:info', () => ({ version: app.getVersion(), platform: process.platform, secretsAvailable: secretsAvailable() }));
  handle('workspace:load', () => loadWorkspace());
  handle('workspace:choose', async () => {
    const result = await dialog.showOpenDialog(window!, { title: 'Choose a workspace folder', properties: ['openDirectory', 'createDirectory'] });
    if (result.canceled || !result.filePaths[0]) return null;
    setWorkspacePath(result.filePaths[0]);
    return loadWorkspace();
  });
  handle('collection:save', (_event, value) => {
    if (!documentShape(value, 'requests')) throw new Error('Invalid collection.');
    saveCollection(value as unknown as Collection);
  });
  handle('collection:delete', (_event, id) => isString(id, 100) && deleteCollection(id));
  handle('environment:save', (_event, value) => {
    if (!documentShape(value, 'variables')) throw new Error('Invalid environment.');
    saveEnvironment(value as unknown as Environment);
  });
  handle('environment:delete', (_event, id) => isString(id, 100) && deleteEnvironment(id));
  handle('history:add', (_event, entry) => {
    if (!isObject(entry) || !isObject(entry.request)) throw new Error('Invalid history entry.');
    return addHistory(entry as unknown as HistoryEntry);
  });
  handle('history:clear', () => clearHistory());
  handle('file:choose', async (_event, options) => {
    const multiple = isObject(options) && options.multiple === true;
    const result = await dialog.showOpenDialog(window!, { title: 'Choose a file to send', properties: multiple ? ['openFile', 'multiSelections'] : ['openFile'] });
    if (result.canceled) return [];
    allowFiles(result.filePaths);
    return result.filePaths;
  });
  handle('file:saveResponse', async (_event, options) => {
    if (!isObject(options) || !(options.bytes instanceof Uint8Array) || !isString(options.name, 255)) throw new Error('Invalid file.');
    const result = await dialog.showSaveDialog(window!, { title: 'Save the response', defaultPath: options.name.replace(/[\\/:*?"<>|]/g, '_') || 'response' });
    if (result.canceled || !result.filePath) return null;
    await writeFile(result.filePath, options.bytes);
    return result.filePath;
  });
  handle('http:send', (_event, payload) => sendRequest(checkPayload(payload), `Actecal-API-Tester/${app.getVersion()}`));
  handle('http:cancel', (_event, id) => isString(id, 100) && cancelRequest(id));
  handle('app:openExternal', (_event, url) => {
    if (isString(url, 2000) && url.startsWith('https://')) shell.openExternal(url);
  });
  // Only when the user asks: one request to GitHub for the latest release. No other calls home.
  handle('app:checkUpdates', async () => {
    const response = await fetch(`https://api.github.com/repos/${REPOSITORY}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } });
    if (!response.ok) return { latest: null, url: `https://github.com/${REPOSITORY}/releases`, newer: false };
    const release = (await response.json()) as { tag_name?: string; html_url?: string };
    const latest = String(release.tag_name || '').replace(/^v/, '');
    const newer = latest.localeCompare(app.getVersion(), undefined, { numeric: true }) > 0;
    return { latest, url: release.html_url || `https://github.com/${REPOSITORY}/releases`, newer };
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (window?.isMinimized()) window.restore();
    window?.focus();
  });
  app.whenReady().then(() => {
    registerIpc();
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
