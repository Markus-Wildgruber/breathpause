<div align="center">

<img src="app/public/img/breathpause-256.png" alt="breathpause logo" width="110">

# breathpause

**An always-on-top breathing bubble that paces your focus sessions —<br>native, no Electron, no runtime dependencies.**

[Install](#install) · [Features](#features) · [Development](#development) · [Releases](https://github.com/Markus-Wildgruber/breathpause/releases)

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS-1f6feb)
![Status](https://img.shields.io/badge/status-alpha-orange)

</div>

## What is breathpause

breathpause is a native always-on-top breathing bubble for Windows and macOS. It sits in the corner of your screen and breathes quietly while you work, then takes over the screen with a frosted breathing break when the pomodoro timer runs out.

Built with **Tauri v2 + Svelte**: a small Rust backend hosts the system webview (WebView2 on Windows, WKWebView on macOS) — no Electron, no Node.js runtime, no background services. The Windows installer is around 3 MB.

## Features

- **Breathing + pomodoro** — work / break / long-break cycle; the bubble breathes quietly in the corner during work, then guides your breathing on breaks.
- **Custom breathing patterns** — build your own from inhale / exhale / hold phases with per-second timing (supports decimals like 5.5 s). Separate patterns for work and break.
- **Configurable timers** — default 25-minute work, 5-minute break, 15-minute long break with configurable long-break interval.
- **Frosted break overlay** — the break takes over the screen with a blurred snapshot of your desktop; press Esc to leave early.
- **Skin system** — swap the bubble appearance with bundled skins (orb, sleepy seal, cute bear, sweet jelly) or import your own as an SVG or zipped folder, recolored to taste.
- **Appearance per mode** — separate size, opacity, position, colors, and font for work and break modes.
- **Global hotkeys** — system-wide shortcuts for start/stop, pause/resume, skip, open settings, and show/hide; customizable by pressing the keys.
- **Start on boot** — optional autostart at login.
- **System tray** — pause, open settings, or quit from the tray icon. Hiding the bubble pauses the session.
- **Chime on transitions** — optional audio cue when work/break segments switch.
- **Local-first** — settings live in localStorage; no telemetry, no network calls.

## Platform Status

| Platform | Status | Notes |
|---|---|---|
| **Windows** 10 / 11 | Working — alpha | Requires WebView2 (pre-installed on Windows 11; auto-bootstrapped on Windows 10 by the installer). |
| **macOS** | Built — CI-tested | Universal (Apple Silicon + Intel) `.dmg`; launch, rendering and settings are verified on CI runners. Unsigned, and not yet verified on physical hardware. |

## Install

Download the latest release from [GitHub Releases](https://github.com/Markus-Wildgruber/breathpause/releases).

### Windows

**Installer:** Run `breathpause_x.y.z_x64-setup.exe` — installs per-user, no admin rights needed.

**Standalone:** Download `breathpause_x.y.z_x64-standalone.exe`, drop it anywhere, and run it directly — no installation required.

**winget:** `winget install MarkusWildgruber.BreathPause` (once published to the community repo).

The installer and executable are unsigned (alpha), so Windows SmartScreen may show an "unknown publisher" prompt. Click **More info → Run anyway** to proceed.

### macOS

**Installer:** Open `breathpause_x.y.z_universal.dmg` and drag breathpause into Applications. Runs on both Apple Silicon and Intel.

The app is unsigned (alpha), so Gatekeeper will refuse to open it on first launch. Either **right-click the app → Open**, then confirm in the dialog, or clear the quarantine flag from a terminal:

```sh
xattr -dr com.apple.quarantine /Applications/breathpause.app
```

## Usage

1. Launch breathpause — a translucent orb appears in the top-right corner and starts breathing.
2. The bubble breathes quietly during the work segment, then switches to break mode automatically.
3. Right-click the system tray icon to pause, open settings, or quit.
4. Left-click the tray icon or bubble to show / hide.
5. Open **Settings** from the tray to adjust appearance, patterns, timers, skins, and behavior (hotkeys, start-on-boot, chime).
6. All settings take effect when you click **Save**.

## Development

Requirements: [Rust](https://rustup.rs) + [Node.js LTS](https://nodejs.org).

```bash
cd app
npm install

# Run core logic tests
npm test

# Dev server in the browser (no Tauri window)
npm run dev

# Dev with live Tauri window
npx tauri dev

# Production Windows build (cross-compile from Linux/macOS via cargo-xwin)
cargo install cargo-xwin
npx tauri build --target x86_64-pc-windows-msvc --runner cargo-xwin
```

CI runs `npm test` and `npm run build` on every push.

## Contributing

Bug reports, breathing-pattern ideas, and skin designs are welcome — open an issue or a PR.

## License

[MIT](LICENSE) © 2026 Markus Wildgruber
