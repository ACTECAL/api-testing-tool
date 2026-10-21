// The only bridge between the page and the main process: a fixed list of calls, no Node APIs.
import { contextBridge, ipcRenderer } from 'electron';
import type { Api } from './api';

const call = (channel: string) => (...args: unknown[]) => ipcRenderer.invoke(channel, ...args);

const api: Api = {
  info: call('app:info') as Api['info'],
  loadWorkspace: call('workspace:load') as Api['loadWorkspace'],
  chooseWorkspace: call('workspace:choose') as Api['chooseWorkspace'],
  saveCollection: call('collection:save') as Api['saveCollection'],
  deleteCollection: call('collection:delete') as Api['deleteCollection'],
  saveEnvironment: call('environment:save') as Api['saveEnvironment'],
  deleteEnvironment: call('environment:delete') as Api['deleteEnvironment'],
  addHistory: call('history:add') as Api['addHistory'],
  clearHistory: call('history:clear') as Api['clearHistory'],
  chooseFiles: call('file:choose') as Api['chooseFiles'],
  saveResponse: call('file:saveResponse') as Api['saveResponse'],
  send: call('http:send') as Api['send'],
  cancel: call('http:cancel') as Api['cancel'],
  openExternal: call('app:openExternal') as Api['openExternal'],
  checkUpdates: call('app:checkUpdates') as Api['checkUpdates'],
};

contextBridge.exposeInMainWorld('api', api);
