# breathpause

**An always-on-top breathing bubble that paces your focus sessions. No install, no Electron, no bloat.**

A translucent bubble sits in the corner of your screen and breathes. It doubles as a pomodoro
timer: work, then the desktop softly blurs while the bubble guides you through a breathing break,
then back to work.

No telemetry, no network calls. On Windows, it's a single PowerShell file. On macOS, it's a single
JavaScript file run by `osascript`.

<p align="center"><em>(demo GIF coming — see <code>tmp/reach.md</code>)</em></p>

## Features

- **Breathing + Pomodoro** — Classic work/break/long-break timer. During work, the bubble breathes
  quietly in the corner. On breaks, it centers and grows to guide your breathing.
- **Custom patterns** — Set your own breathing phases (like box breathing `4-4-4-4`, or `4-7-8`)
  for work and break states.
- **Native UI** — Uses the OS's native GUI toolkit (WPF on Windows, Cocoa on macOS) for real
  desktop blurring and low resource usage.
- **Keyboard friendly** — Global hotkeys to pause/resume, skip intervals, or open settings.
- **Zero install** — The app is literally one script. No Node, Python, or heavy browsers required.
- **Private** — Settings are saved locally as JSON. No network calls.

## Install & run

> ⚠️ **Status:** Windows is in alpha (verified on a real machine). macOS is written but untested on
> real hardware — testers welcome.

### Windows (PowerShell 5.1+)

```powershell
winget install breathpause
```

Or download `breathpause.ps1` from the
[latest release](https://github.com/Markus-Wildgruber/breathpause/releases/latest) and run:

```powershell
powershell -ExecutionPolicy Bypass -File breathpause.ps1
```

(If Windows SmartScreen blocks it, right-click the file → **Properties → Unblock**.)

### macOS (macOS 10.10+)

Download `breathpause.js` from the
[latest release](https://github.com/Markus-Wildgruber/breathpause/releases/latest) and run:

```bash
osascript -l JavaScript breathpause.js
```

(Global hotkeys require granting **Accessibility** permission.)

## Security & trust

Because the app ships as a single, un-obfuscated script, you can open it in a text editor and read
exactly what it does before running it.

Every release is built by GitHub Actions, carries a signed [SLSA attestation](https://slsa.dev), and
is scanned by VirusTotal — links are in the release notes. The Windows MSI is unsigned, so you may
see an "unknown publisher" prompt; the checks above are how you verify the file instead.

## Development

The codebase splits into **core** logic (a pure, unit-tested engine) and **shell** (the OS-specific
GUI). The build scripts concatenate them into the single distributed file.

```bash
# Windows tests & build (outputs dist/breathpause.ps1)
pwsh -NoProfile -File run-tests.ps1
pwsh -NoProfile -File build/build-win.ps1

# macOS tests & build (outputs dist/breathpause.js)
./run-tests.sh
./build/build-macos.sh
```

## Configuration

Settings and a local event log (`events.log`) are stored in the standard app-data folders:

- **Windows:** `%APPDATA%\breathpause\`
- **macOS:** `~/Library/Application Support/breathpause/`

## License

[MIT](LICENSE) © 2026 Markus Wildgruber
