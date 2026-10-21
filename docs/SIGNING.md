# Code signing

Signing proves that an installer comes from Actecal and has not been changed. Without it the app still works,
but each operating system warns before opening it. Test builds can go out unsigned (see "Testing without
certificates" below).

| Platform | What is needed | Cost | Without it |
|---|---|---|---|
| macOS | Apple Developer Program (organisation) → Developer ID Application certificate → notarization | US$99 a year, in local currency where available | Gatekeeper blocks the first launch; the user must allow it in System Settings |
| Windows | An Authenticode code-signing certificate: SignPath Foundation (free for open source) or a paid OV certificate | Free (SignPath) or a yearly fee | SmartScreen shows "Windows protected your PC" |
| Linux | Nothing | — | No warning; publish SHA-256 checksums |

## macOS: Apple Developer ID

1. **Get a D-U-N-S Number** for the company (free, from Dun & Bradstreet; Apple's page explains how to look one up or request one: https://developer.apple.com/support/D-U-N-S). It must match the company's legal name and address. Allow a few days.
2. **Enrol in the Apple Developer Program as an organisation** at https://developer.apple.com/programs/enroll, with an Apple Account that has two-factor authentication. Apple asks for the legal entity name, the D-U-N-S Number, a company website and a work email on the company domain, and may call to verify. The person enrolling must be able to sign for the company. The fee is US$99 a year.
3. **Create the certificate** (the Account Holder or an Admin does this):
   - On a Mac, open Keychain Access → Certificate Assistant → Request a Certificate From a Certificate Authority, and save the request to disk.
   - At https://developer.apple.com/account/resources/certificates, choose **+** → **Developer ID Application**, upload the request and download the certificate.
   - Double-click it to add it to the keychain, then export it (with its private key) as a `.p12` file with a strong password.
4. **Set up notarization.** Create an app-specific password for the Apple Account at https://account.apple.com (Sign-In and Security → App-Specific Passwords), and note the Team ID from the developer account's Membership page.
5. **Add the GitHub secrets** (repository → Settings → Secrets and variables → Actions):
   - `MAC_CERT_P12_BASE64`: the `.p12` file, base64-encoded (`base64 -i developer-id.p12 | pbcopy`);
   - `MAC_CERT_PASSWORD`: its password;
   - `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID`.

The release workflow then signs with the hardened runtime and notarizes. Keep the `.p12` file and its password out of the repository; `.gitignore` excludes `*.p12`.

## Windows

### Option A: SignPath Foundation (free for open-source projects)

SignPath Foundation signs Windows releases of open-source projects for free (https://signpath.org). Its terms
(https://signpath.org/terms) require, among other things:

- an OSI-approved licence (this project uses MIT) and no proprietary components in what is signed;
- builds made by a public CI system from the public repository (GitHub Actions here), not on a developer's computer;
- a code signing policy published by the project (`CODE_SIGNING_POLICY.md`) and two-factor authentication for the people who approve releases.

Steps:

1. Make the repository public and publish a first (unsigned) release, so the project can be reviewed.
2. Apply at https://signpath.org with the repository URL.
3. After approval, install the SignPath GitHub App, and add the API token and organisation ID that SignPath gives as GitHub secrets.
4. In `.github/workflows/release.yml`, after "Package for Windows", upload the installers from `release/` as a workflow artifact, submit it with `signpath/github-action-submit-signing-request`, and upload the signed installers to the release.

SignPath signs Windows files only; macOS still needs the Apple certificate.

### Option B: a paid OV code-signing certificate

Buy an Organisation Validation (OV) code-signing certificate from a certificate authority such as Sectigo,
DigiCert, GlobalSign, SSL.com or Certum. The CA checks the company's registration documents. Since June 2023 the
private key must be kept on a hardware token or in a cloud HSM, so for GitHub Actions choose the CA's cloud-signing
service (for example SSL.com eSigner or DigiCert KeyLocker) and follow its GitHub Actions guide.

Azure Artifact Signing (formerly Trusted Signing, about US$9.99 a month) is simpler, but Microsoft currently offers
it only to organisations in the USA, Canada, the EU and the UK
(https://learn.microsoft.com/windows/apps/package-and-deploy/code-signing-options).

A new certificate can still show a SmartScreen warning for a while, until the signed downloads build reputation.

## Testing without certificates

Unsigned builds work; only the first launch needs an extra step.

- **macOS:** open the app once; macOS refuses it. Then open System Settings → Privacy & Security, scroll to the
  message about "Actecal API Tester" and choose **Open Anyway**. (Control-click → Open no longer skips this on
  macOS 15 and later.) Developers can instead run `xattr -dr com.apple.quarantine "/Applications/Actecal API Tester.app"`.
  Builds made on your own Mac are not quarantined and open directly.
- **Windows:** on "Windows protected your PC", choose **More info** → **Run anyway**.
- **Linux:** make the AppImage executable (`chmod +x Actecal-API-Tester-*.AppImage`) and run it, or install the `.deb`.

Local builds: `npm run dist:mac`, `npm run dist:win` or `npm run dist:linux` write the installers to `release/`.
Without a certificate, macOS builds get an ad-hoc signature so they run on Apple silicon.
