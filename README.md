<div align="center">

<img src="img/breathpause-256.png" alt="breathpause logo" width="110">

# breathpause

**An always-on-top breathing bubble that paces your focus sessions —<br>native, zero dependencies, no Electron.**

[Install](#install) · [Features](#features) · [How it works](#how-it-works) · [Security &amp; trust](#security--trust) · [Releases](https://github.com/Markus-Wildgruber/breathpause/releases)

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS-1f6feb)
![Dependencies](https://img.shields.io/badge/dependencies-zero-brightgreen)
![Status](https://img.shields.io/badge/status-alpha-orange)

</div>

<p align="center"><img src="img/demo.gif" alt="breathpause demo — a translucent orb breathing in the corner during work, then the desktop blurs and the orb grows to guide a breathing break" width="700"></p>

## What is breathpause

breathpause is a native always-on-top breathing bubble for Windows and macOS. It sits in the corner of
your screen and breathes quietly while you work, then runs a pomodoro break where the desktop softly
blurs and the bubble grows to guide your breathing — and back to work.

The app is early, but the foundation is real: native WPF and Cocoa shells driven by one shared
pure-logic core, custom breathing patterns, a pomodoro cycle with long breaks, real desktop blur on
breaks, configurable global hotkeys, a system tray control, a settings window, a local JSONL event log,
single-instance behavior, and a signed release pipeline for Windows and macOS.

## Why

Most focus apps are full Electron windows that weigh hundreds of megabytes and phone home. breathpause
is designed as a desktop utility:

- always visible at the edge of the screen, never in your way
- light enough to leave running all day
- built on the GUI toolkit your OS already ships — nothing to install
- local-first by default, with no telemetry and no network calls
- readable and verifiable before you run it

## Features

- **Breathing + pomodoro** — work / break / long-break cycle; the bubble breathes quietly in the corner during work, then centers and grows to guide your breathing on breaks.
- **Real desktop blur** — the break overlay blurs the desktop behind it (DWM acrylic on Windows, native on macOS), not a translucent `<div>`.
- **Custom breathing patterns** — build your own from inhale / exhale / hold phases, with separate patterns for work, break, and long-break states.
- **Configurable timers** — default 25-minute work, 5-minute break, and 15-minute long break, with auto-continue or wait-for-Resume between segments.
- **Global hotkeys + tray** — optional hotkeys for start/stop, pause/resume, skip, and settings, plus a native system tray control.
- **Tunable look** — adjust bubble size, opacity, colors, and fonts from an in-app settings window.
- **Local-first** — hand-editable JSON settings and a plain local JSONL event log; no telemetry, no network calls.

## Platform Status

| Platform | Status | Notes |
|---|---|---|
| **Windows** 10/11 | Working — alpha | Verified on a real machine. Release includes an `.msi` and the single-file `breathpause.ps1`. Built locally and in GitHub Actions. |
| **macOS** 10.10+ | Written, not yet run on a Mac | Builds in CI and ships a single-file `breathpause.js`. **Testers welcome** — untested on real hardware. |

## Verification Status

Both native targets are checked by GitHub Actions on every push. The release process publishes
artifacts only after those workflows pass.

What is verified:

- Windows core logic (Pester 5) — breathing engine, pomodoro state machine, settings, time formatting
- macOS core logic (node:test) with a coverage soft gate
- Windows bundle build with PowerShell parser and static undefined-command checks
- macOS bundle build with a Node syntax check
- A `-Debug` doctor self-check of the built Windows bundle (informational)

What is not fully verified yet:

- Physical macOS QA on real hardware
- Windows code signing and macOS notarization
- A signed auto-update channel
- A full keyboard and accessibility pass

## Install

Download the latest Windows or macOS build from
[GitHub Releases](https://github.com/Markus-Wildgruber/breathpause/releases).

### Windows (PowerShell 5.1+)

```powershell
winget install breathpause
```

Or grab `breathpause.ps1` from the
[latest release](https://github.com/Markus-Wildgruber/breathpause/releases/latest) and run:

```powershell
powershell -ExecutionPolicy Bypass -File breathpause.ps1
```

The Windows MSI is unsigned, so SmartScreen may show an "unknown publisher" prompt. If it blocks the
script, right-click the file → **Properties → Unblock**. The checks under
[Security &amp; trust](#security--trust) are how you verify the file instead.

### macOS (10.10+)

Grab `breathpause.js` from the
[latest release](https://github.com/Markus-Wildgruber/breathpause/releases/latest) and run:

```bash
osascript -l JavaScript breathpause.js
```

Global hotkeys require granting **Accessibility** permission. macOS builds are unsigned until signing
and notarization are configured.

## Usage

- The bubble breathes in your chosen corner while you work, then runs the break automatically.
- Open the settings window from the system tray icon to adjust patterns, timers, appearance, and hotkeys.
- Assign global hotkeys to start/stop, pause/resume, skip the current segment, or open settings.
- Choose auto-continue to flow between segments, or wait for Resume at each one.
- Use the tray icon to open settings or quit.

## How it works

The codebase splits into a **core** (pure logic — breathing engine, pomodoro state machine, pattern
model) and a **shell** (GUI + OS calls). The core has no GUI dependencies, so it's unit-tested
headlessly to high coverage on both platforms; the build scripts simply concatenate the modules into
one distributable file.

```text
src/
  win/    core/ + shell/ + main.ps1   →  build → dist/breathpause.ps1   (single file)
  macos/  core/ + shell/ + main.js    →  build → dist/breathpause.js     (single file)
```

Native window behavior is kept in a small, explicit layer: the bubble stays always-on-top and
frameless, real desktop blur sits behind the break overlay, and a single-instance guard keeps a second
launch from spawning a duplicate.

## Security &amp; trust

A breathing app shouldn't ask for blind trust:

- **Readable** — one un-obfuscated script you can open and read before running.
- **Provenance** — every release is built by GitHub Actions and carries a signed
  [SLSA attestation](https://slsa.dev): `gh attestation verify <file> --repo Markus-Wildgruber/breathpause`.
- **Scanned** — each artifact is run through VirusTotal; links are in the release notes.
- **Verifiable** — SHA-256 sums on every release, and the build is plain concatenation you can reproduce.

## Data and Privacy

breathpause is local-first. Settings and a local event log (`events.log`, JSONL) live in the standard
app-data folders, are hand-editable, and never leave your machine. There is no analytics layer and no
network sync.

- **Windows:** `%APPDATA%\breathpause\`
- **macOS:** `~/Library/Application Support/breathpause/`

## Development

Requirements: PowerShell (Windows) or Node.js LTS (macOS core). No other dependencies.

```bash
# Windows: tests (Pester) + build  → dist/breathpause.ps1
pwsh -NoProfile -File run-tests.ps1
pwsh -NoProfile -File build/build-win.ps1

# macOS: tests (node:test) + build → dist/breathpause.js
./run-tests.sh
./build/build-macos.sh
```

GitHub Actions runs the core tests and bundle builds for both targets on every push, and `release.yml`
cuts a release — gated on the tests — when a `vX.Y.Z` tag is pushed.

## Contributing

This is early, and the most useful thing right now is **real-device testing — especially macOS**. Bug
reports, fixes, and breathing-pattern ideas are all welcome — open an issue or a PR. Edge-window
behavior, accessibility, and keyboard-first flows are especially good places to help.

## License

[MIT](LICENSE) © 2026 Markus Wildgruber
