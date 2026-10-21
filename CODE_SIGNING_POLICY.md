# Code signing policy

Release installers are built only by the GitHub Actions workflow in `.github/workflows/release.yml`, from a
version tag in this public repository. Builds made on a developer's computer are never signed or published.

- **Who signs:** Windows installers are signed through SignPath Foundation once the project is approved, and
  macOS apps with Actecal's Apple Developer ID. Until then, releases are unsigned and marked as such.
- **Who approves:** members of the ACTECAL GitHub organisation with maintainer rights, using two-factor
  authentication on GitHub (and on SignPath).
- **What is signed:** only files built from this repository's source: the app and its installers.
- **Privacy:** the app collects no data and sends nothing anywhere except the requests the user makes, and one
  request to the GitHub API when the user chooses "Check for updates".
