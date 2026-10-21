// What the preload script exposes as window.api.
import type { Collection, Environment, HistoryEntry, HttpResult, SendPayload, Workspace } from '../shared/types';

export interface Api {
  info(): Promise<{ version: string; platform: string; secretsAvailable: boolean }>;
  loadWorkspace(): Promise<Workspace>;
  chooseWorkspace(): Promise<Workspace | null>;
  saveCollection(collection: Collection): Promise<void>;
  deleteCollection(id: string): Promise<void>;
  saveEnvironment(environment: Environment): Promise<void>;
  deleteEnvironment(id: string): Promise<void>;
  addHistory(entry: HistoryEntry): Promise<HistoryEntry[]>;
  clearHistory(): Promise<void>;
  chooseFiles(options?: { multiple?: boolean }): Promise<string[]>;
  saveResponse(options: { name: string; bytes: Uint8Array }): Promise<string | null>;
  send(payload: SendPayload): Promise<HttpResult>;
  cancel(id: string): Promise<void>;
  openExternal(url: string): Promise<void>;
  checkUpdates(): Promise<{ latest: string | null; url: string; newer: boolean }>;
}

declare global {
  interface Window {
    api: Api;
  }
}
