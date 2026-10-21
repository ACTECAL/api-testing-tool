# Actecal API Tester

A free, open-source desktop app for testing HTTP APIs, for Windows, macOS and Linux. Requests go out from the app
itself, so there are none of a web page's limits: no CORS errors, and any header (Cookie, Host, Origin), proxies and
self-signed certificates for local servers. No account, no telemetry, and everything stays on your computer.

Made by [Actecal](https://actecal.com). MIT licensed.

## Features

- **Requests:** any method; params kept in step with the URL; headers; Bearer, Basic and API-key auth; bodies as raw
  JSON/text/XML, form data with files, URL-encoded fields or a whole file (for example a PUT to a signed storage URL).
- **Settings per request:** time limit, follow redirects (Authorization and Cookie are dropped when a redirect leaves
  the original site), TLS verification on or off, and an HTTP proxy.
- **Responses:** status, time and size; formatted JSON, text or an image preview; headers and cookies; save the body
  to a file. Responses up to 50 MB are read in full.
- **curl:** import any curl command, including “Copy as cURL” from browser developer tools; copy a request as curl
  or JavaScript fetch.
- **Collections and environments:** saved as JSON files in a workspace folder you choose (default:
  `Documents/Actecal API Tester`), so they can be shared and kept in git. Use `{{variables}}` anywhere. Secret values
  are encrypted with your system keychain and never written to the workspace folder.
- **History** of the last 100 requests.
- Keyboard: **Cmd/Ctrl + Enter** sends, **Cmd/Ctrl + S** saves.

## Install

Download the installer for your system from [Releases](https://github.com/ACTECAL/api-testing-tool/releases):
`.dmg` for macOS (Apple silicon `arm64` or Intel `x64`), `.exe` for Windows, `.AppImage` or `.deb` for Linux.

Until the releases are code-signed, the first launch needs one extra step:

- **macOS:** open the app, then System Settings → Privacy & Security → **Open Anyway**.
- **Windows:** on “Windows protected your PC”, choose **More info** → **Run anyway**.
- **Linux:** `chmod +x Actecal-API-Tester-*.AppImage`, then run it.

## Privacy

The app sends only the requests you make. The one other request is to the GitHub API, when you choose “Check for
updates”. Collections and environments live in your workspace folder; history, settings and encrypted secrets live in
the app's data folder. See [SECURITY.md](SECURITY.md).

## Development

Requires Node.js 22.12 or later.

```sh
npm install
npm run dev          # the app with hot reload
npm test             # unit tests (vitest)
npm run typecheck
npm run test:e2e     # builds the app and drives it end to end (playwright-core)
npm run dist:mac     # installers in release/ (also dist:win, dist:linux)
```

Code layout:

| Folder | What |
|---|---|
| `src/main` | Main process: window and security settings, IPC with input checks, the request runner (`http.ts`, undici), storage |
| `src/preload` | The fixed API exposed to the page as `window.api` |
| `src/renderer` | The React interface |
| `src/shared` | Types, `{{variable}}` substitution, URL and params, request building, curl import/export (`curl.js` is shared with the web curl tester on actecal.com) |

## Releases

1. Update `version` in `package.json` and commit.
2. Tag and push: `git tag v0.1.0 && git push origin v0.1.0`.
3. The Release workflow builds every platform and uploads the installers to a draft release. Check it, then publish.

Signing and notarization switch on when the secrets exist: see [docs/SIGNING.md](docs/SIGNING.md) for how to buy and
set up the certificates, and [CODE_SIGNING_POLICY.md](CODE_SIGNING_POLICY.md).
