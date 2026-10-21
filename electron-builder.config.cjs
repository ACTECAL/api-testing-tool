// Installers for Windows, macOS and Linux (electron-builder), published as a draft GitHub Release.
// Signing is optional: without certificates the builds are unsigned, which is fine for testing. With the
// secrets in .github/workflows/release.yml they are signed (and notarized on macOS); see docs/SIGNING.md.
const signedMac = Boolean(process.env.CSC_LINK || process.env.CSC_NAME);
const notarize = signedMac && Boolean(process.env.APPLE_TEAM_ID && (process.env.APPLE_API_KEY || process.env.APPLE_ID));

/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: 'com.actecal.apitester',
  productName: 'Actecal API Tester',
  copyright: 'Copyright © 2026 Actecal',
  directories: { output: 'release', buildResources: 'build' },
  files: ['out/**', 'package.json'],
  asar: true,
  artifactName: 'Actecal-API-Tester-${version}-${os}-${arch}.${ext}',
  // Turn off Electron features this app does not need, so its binary cannot be reused as a Node runtime.
  electronFuses: {
    runAsNode: false,
    enableCookieEncryption: true,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false,
    enableEmbeddedAsarIntegrityValidation: true,
    onlyLoadAppFromAsar: true,
  },
  mac: {
    category: 'public.app-category.developer-tools',
    target: [
      { target: 'dmg', arch: ['arm64', 'x64'] },
      { target: 'zip', arch: ['arm64', 'x64'] },
    ],
    // The hardened runtime is what notarization needs; ad-hoc test builds go without it (with it, macOS
    // library validation would stop an ad-hoc-signed Electron app from starting).
    hardenedRuntime: signedMac,
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.plist',
    // Without a Developer ID certificate, an ad-hoc signature still lets the app run on Apple silicon.
    identity: signedMac ? undefined : '-',
    notarize,
  },
  win: {
    target: [{ target: 'nsis', arch: ['x64', 'arm64'] }],
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
  },
  linux: {
    target: [
      { target: 'AppImage', arch: ['x64'] },
      { target: 'deb', arch: ['x64'] },
    ],
    category: 'Development',
    maintainer: 'Actecal <sales@actecal.com>',
    synopsis: 'Free, open-source API client',
  },
  publish: { provider: 'github', owner: 'ACTECAL', repo: 'api-testing-tool', releaseType: 'draft' },
};
