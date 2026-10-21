# Security

Please report vulnerabilities privately through GitHub: this repository → **Security** → **Report a
vulnerability**. Do not open a public issue for a security problem.

## How the app is built to be safe

- The window runs with `contextIsolation`, `sandbox` and no Node integration. The page has a strict Content
  Security Policy with `connect-src 'none'`, so it cannot make network requests itself; it never loads remote
  content, navigates or opens windows.
- The preload script exposes a fixed list of calls. The main process checks every argument, and sends only files
  that the user picked in a file dialog (or that saved requests already used).
- Electron fuses turn off `RunAsNode`, `NODE_OPTIONS` and the inspector flags, and turn on ASAR integrity checks.
- Secret environment values are encrypted with the system keychain (Electron `safeStorage`) and kept out of the
  workspace folder, so collections can be shared or kept in git without them.
- No telemetry. The only call the app makes on its own behalf is the update check, and only when the user asks.

## What the app does not protect against

It sends exactly what you tell it to, to whatever address you enter, like curl. Request history (including any
tokens typed straight into headers) is stored unencrypted in the app's data folder on your computer; use secret
environment variables for tokens, and "Clear" in History to remove it.
