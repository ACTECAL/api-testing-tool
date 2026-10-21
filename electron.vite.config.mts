import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { defineConfig as defineElectronConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';

// Three builds: the main process (Node), the preload script (sandboxed, CommonJS) and the renderer (React).
// Dependencies of the main process stay in node_modules (externalizeDeps, the default).
const shared = { '@shared': resolve('src/shared') };

// The page's Content Security Policy (index.html) allows no network access and no inline scripts. The dev
// server needs both for hot reload (its WebSocket and React's refresh script), so only `npm run dev` relaxes it.
function devCsp(): Plugin {
  return {
    name: 'dev-csp',
    apply: 'serve',
    transformIndexHtml: (html) =>
      html.replace(/(http-equiv="Content-Security-Policy"\s+content="[^"]*)/, (csp) =>
        csp.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'").replace("connect-src 'none'", 'connect-src ws://localhost:* http://localhost:*'),
      ),
  };
}
void defineConfig;

export default defineElectronConfig({
  main: {
    resolve: { alias: shared },
  },
  preload: {
    resolve: { alias: shared },
  },
  renderer: {
    root: 'src/renderer',
    resolve: { alias: shared },
    plugins: [react(), devCsp()],
    build: {
      rollupOptions: { input: resolve('src/renderer/index.html') },
    },
  },
});
