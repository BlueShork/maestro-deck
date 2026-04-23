# Maestro Deck

> An open-source visual IDE for [Maestro](https://maestro.mobile.dev) mobile UI tests.

Maestro Deck is a fast, native desktop app for inspecting Android devices, building Maestro flows visually, and running them — without ever sending a byte to the cloud.

- **No login, no account, no telemetry.** Your device, your tests, your machine.
- **Fast and lightweight.** Native Tauri shell with a target of < 1s cold start and < 100 MB RAM idle.
- **100% offline.** Auditable, open source, and yours forever under Apache 2.0.

---

## Status

![CI](https://img.shields.io/badge/ci-pending-lightgrey)
![License](https://img.shields.io/badge/license-Apache%202.0-blue)
![Version](https://img.shields.io/badge/version-0.1.0--dev-orange)

> Maestro Deck is in early development. The v0.1 milestone targets Android over USB on a single physical device. See the [roadmap](#roadmap) for what comes next.

---

## Features (v0.1)

- Live mirror of an Android device over USB (60 fps target, < 50 ms input-to-display latency)
- Click, swipe, type, and key-press forwarding directly to the device
- On-demand UI hierarchy inspection with element overlay and tree view
- Smart selector suggestion (`resource-id`, `text`, `content-desc`, point fallback)
- Monaco-based YAML editor with Maestro syntax highlighting and snippets
- One-click flow execution with live, color-coded log streaming
- Cross-platform: macOS (Intel + Apple Silicon), Linux, Windows

---

## Screenshots

> Screenshots will be added as the UI lands. Placeholders below.

![Editor view](docs/screenshots/editor.png)

![Inspector overlay](docs/screenshots/inspector.png)

![Run console](docs/screenshots/run-console.png)

---

## Quickstart

### 1. Install ADB

You need the Android Debug Bridge in your `PATH`.

- **macOS:** `brew install android-platform-tools`
- **Linux (Debian/Ubuntu):** `sudo apt install adb`
- **Windows:** install the [Android SDK Platform Tools](https://developer.android.com/tools/releases/platform-tools) and add the folder to `PATH`.

Verify with `adb version`.

### 2. Install Maestro

Follow the [official Maestro install guide](https://maestro.mobile.dev/getting-started/installing-maestro). The `maestro` binary must be reachable from your `PATH`.

Verify with `maestro --version`.

### 3. Get Maestro Deck

**Option A — Download a release** (recommended)

Grab the latest installer for your OS from the [Releases page](https://github.com/blueshork/maestro-deck/releases).

**Option B — Build from source**

See [Build from source](#build-from-source) below.

### 4. Connect a device

1. Enable Developer Options and USB debugging on your Android device.
2. Plug it in via USB and accept the debugging prompt.
3. Launch Maestro Deck and pick your device from the selector.

---

## Build from source

### Prerequisites

- [Node.js](https://nodejs.org) 20 or newer
- [pnpm](https://pnpm.io) 10 or newer
- Rust stable (install via [rustup](https://rustup.rs))
- Platform-specific Tauri 2.x prerequisites — see the [Tauri prerequisites guide](https://v2.tauri.app/start/prerequisites/)

### Clone and run

```bash
git clone https://github.com/blueshork/maestro-deck.git
cd maestro-deck
pnpm install
pnpm tauri:dev
```

The dev build will open a window with hot-reload for both the React frontend and the Rust backend.

To produce a release bundle:

```bash
pnpm tauri:build
```

Installers land in `src-tauri/target/release/bundle/`.

---

## Architecture

Maestro Deck is a Tauri 2.x desktop app. The frontend is React 18 + TypeScript in the webview; the backend is a native Rust process that talks to the device through ADB and a bundled scrcpy server.

```
+----------------------------+        +---------------------------+
|  React frontend (webview)  | <----> |  Rust backend (Tauri)     |
|  - DeviceView (canvas)     |  IPC   |  - device / scrcpy / video|
|  - InspectorPanel          |        |  - input / hierarchy      |
|  - FlowEditor (Monaco)     |        |  - selector / yaml        |
|  - RunConsole              |        |  - runner (maestro spawn) |
+----------------------------+        +-------------+-------------+
                                                    |
                                                    v USB
                                              Android device
```

For a deeper dive into modules, IPC events, and critical flows, read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). The full project plan and rationale live in [docs/PLAN.md](docs/PLAN.md).

---

## Roadmap

**v0.1 — current**
Android over USB, single physical device, inspect + flow editor + runner.

**v0.2**
- iOS simulator support
- Multi-device mirroring (stream several devices in parallel)
- Record mode (capture interactions automatically as YAML)

**v0.3**
- iOS physical device support via WebDriverAgent
- Plugin system for custom Maestro commands

**v1.0**
- Stable, documented, used in production by real QA teams
- Optional AI assistance (Claude / MCP) if the integration matches the project vision

Cloud execution is an explicit non-goal. Maestro Deck stays local.

---

## Contributing

Issues, discussions, and pull requests are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a PR, and the [Code of Conduct](CODE_OF_CONDUCT.md) before participating in the community.

Security issues should be reported privately — see [SECURITY.md](SECURITY.md).

---

## License

Maestro Deck is released under the [Apache License 2.0](LICENSE).

Copyright 2026 Ethan Morisset.
