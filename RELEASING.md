# Releasing breathpause

Releases are cut by pushing a git tag. The [`Release` workflow](.github/workflows/release.yml)
then runs the tests, builds the artifacts, and publishes them with a full set of *free* trust
signals — no code-signing certificate required.

```
git tag v0.1.0
git push origin v0.1.0
```

## What the workflow does (in order)

1. **Tests gate the release.** Pester (Windows) + `run-tests.sh` (macOS). A failure cancels everything downstream — a broken tag never ships.
2. **Builds artifacts**, both stamped with the tag in their header:
   - Windows: `dist/breathpause.ps1` → wrapped into `breathpause-<version>.msi` via WiX (winget needs an installer, not a bare script).
   - macOS: `dist/breathpause.js` (labeled **experimental** — not yet verified on real hardware).
3. **SHA-256 checksums** for every artifact (`SHA256SUMS.txt`).
4. **Build-provenance attestation** (SLSA) — publicly verifiable because the repo is public:
   `gh attestation verify <file> --repo Markus-Wildgruber/breathpause`.
5. **VirusTotal scan** — each artifact is uploaded and the report links are folded into the release notes.
6. **GitHub Release** created with the MSI, the JS, checksums, and the trust notes.
7. **winget PR** opened against `microsoft/winget-pkgs` via winget-releaser.

## One-time setup (the things only you can do)

### 1. Confirm the package identity
winget requires the **PackageIdentifier** to be `Publisher.Package` (it must contain a dot —
a bare `breathpause` is rejected). So:
- **PackageIdentifier** = `MarkusWildgruber.breathpause` (used by `env.PACKAGE_ID` in `release.yml`
  and by `winget-releaser`). To change the publisher segment, update `env.PACKAGE_ID` and
  `build/breathpause.wxs` → `Manufacturer`.
- **Moniker** = `breathpause` — the short alias that lets users run `winget install breathpause`
  (what the README shows). Set it in the first manual manifest (step 3); `winget-releaser`
  carries it forward on later version bumps.

### 2. Add two repo secrets
*Settings → Secrets and variables → Actions → New repository secret*

| Secret | What | Where to get it |
|---|---|---|
| `VT_API_KEY` | VirusTotal API key (free tier is plenty) | virustotal.com → sign in → your profile → **API key** |
| `WINGET_TOKEN` | Classic PAT with **`public_repo`** scope | github.com → Settings → Developer settings → Tokens (classic). Used to fork/PR `winget-pkgs`. |

### 3. Do the first winget submission by hand
winget needs the package *identity* to exist before automation can bump it. For the **first**
release, submit the manifest manually (e.g. `komac new` / `wingetcreate new`, or a manual PR to
`microsoft/winget-pkgs`) and let it merge. **Include `Moniker: breathpause`** in that manifest so
`winget install breathpause` resolves. Every release after that, the workflow's winget step
handles the version bump automatically (and preserves the moniker).

## Local build (no release)

```powershell
pwsh -File build/build-win.ps1                       # → dist/breathpause.ps1
dotnet tool install --global wix                      # once
pwsh -File build/build-msi.ps1 -Version 0.1.0         # → dist/breathpause-0.1.0.msi
```
```bash
./build/build-macos.sh                                # → dist/breathpause.js
```

## Known gap: the unknown-publisher prompt

The MSI is **unsigned**, so a per-machine install shows Windows' "unknown publisher" UAC prompt.
Nothing in the free trust story removes that — only a paid Authenticode (ideally EV) certificate
makes the OS vouch for the publisher. The provenance + VirusTotal + checksum signals are how a
cautious user verifies the file in the meantime.

> Future option to drop the prompt *without* paying: switch the MSI to a **per-user** install
> (`Scope="perUser"`, install under LocalAppData), which doesn't require elevation. It's a real
> behavior change (per-user vs per-machine), so it's left as a deliberate decision, not a default.
