<h1 align="center">Maestro Deck — source-available visual IDE for Maestro mobile tests</h1>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="public/logo-horizontal-white.svg">
    <source media="(prefers-color-scheme: light)" srcset="public/logo-horizontal.svg">
    <img src="public/logo-horizontal.svg" alt="Maestro Deck" width="420">
  </picture>
</p>

<p align="center">
  Inspect your Android device, build <a href="https://maestro.mobile.dev">Maestro</a> flows visually, and run them — all locally, from one desktop window.
</p>

<p align="center">
  <a href="https://www.maestrodeck.cloud">Website</a> ·
  <a href="https://www.maestrodeck.cloud/docs">Docs</a> ·
  <a href="https://www.maestrodeck.cloud/faq">FAQ</a> ·
  <a href="https://github.com/BlueShork/maestro-deck/releases">Download</a> ·
  <a href="https://github.com/BlueShork/maestro-deck/discussions">Discussions</a>
</p>

<p align="center">
  <a href="https://github.com/BlueShork/maestro-deck/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/BlueShork/maestro-deck/actions/workflows/ci.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-BUSL--1.1-blue.svg"></a>
  <a href="package.json"><img alt="Version" src="https://img.shields.io/github/package-json/v/BlueShork/maestro-deck?color=orange"></a>
  <a href="CONTRIBUTING.md"><img alt="PRs welcome" src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg"></a>
</p>

<p align="center">
  <a href="https://sonarcloud.io/summary/new_code?id=BlueShork_maestro-deck"><img alt="SonarQube Cloud" src="https://sonarcloud.io/images/project_badges/sonarcloud-light.svg"></a>
  <a href="https://sonarcloud.io/summary/new_code?id=BlueShork_maestro-deck"><img alt="Quality gate" src="https://sonarcloud.io/api/project_badges/quality_gate?project=BlueShork_maestro-deck&token=ad460cd2309b7ca91f43029430daf2d31295d3d1"></a>
</p>

<p align="center">
  <img src="docs/images/screenshot-app.png" alt="Maestro Deck screenshot" width="900">
</p>

---

## What is it?

Maestro Deck mirrors your Android phone on your desktop, lets you tap and type on it, inspects the UI, and helps you build & run [Maestro](https://maestro.mobile.dev) flows — all from one window.

- **Local only.** No account, no telemetry.
- **Fast.** Native Tauri shell, sub-second startup.
- **Source-available.** BUSL-1.1, transitions to Apache-2.0 on 2030-05-15.

> Early development. v0.1 targets a single Android device over USB.

---

## Why Maestro Deck

Maestro is the YAML mobile-testing framework. Maestro Deck is the desktop app that makes writing those flows feel like clicking through your app instead of guessing selectors.

|                         | Maestro Deck                                         | Maestro Studio               | Appium Inspector           |
| ----------------------- | ---------------------------------------------------- | ---------------------------- | -------------------------- |
| Install                 | Single signed app (DMG/MSI)                          | `maestro studio` (browser)   | Java + Appium server setup |
| Footprint               | Native Tauri shell (~80 MB RAM idle, system webview) | Electron-based, ~400+ MB RAM | JVM + Chromium inspector   |
| Cost                    | Free, source-available (BUSL-1.1)                    | Free, closed source          | Free, open source          |
| Live mirroring          | ✅ scrcpy-grade, 60 fps                              | ⚠️ Periodic screenshots      | ⚠️ Screenshot-based        |
| Smart selectors         | ✅ id → text → desc → point                          | ✅                           | ⚠️ Manual                  |
| Built-in YAML editor    | ✅ CodeMirror + Maestro syntax                       | ✅ Basic                     | ❌                         |
| One-click run with logs | ✅                                                   | ❌ (separate CLI)            | ❌                         |
| Telemetry / account     | None                                                 | mobile.dev account flows     | None                       |
| Cloud execution         | Out of scope (stays local)                           | Paid mobile.dev cloud        | N/A                        |

If you already use Maestro Studio: Deck is a native, local-first alternative with a tighter mirror-inspect-edit-run loop and no cloud coupling.

---

## Features

- Live device mirroring over USB (60 fps target, low input latency)
- Tap, swipe, type, and key forwarding
- UI hierarchy inspection with element overlay
- Smart selectors (`resource-id` → `text` → `content-desc` → point fallback)
- YAML editor with Maestro syntax highlighting (CodeMirror)
- One-click flow run with live, color-coded logs
- macOS and Windows (Linux planned)

---

## Requirements

- **OS:** macOS 12+ or Windows 10+ (Linux support planned)
- **Android device:** Android 8.0 (API 26) or later with USB debugging enabled
- **Tooling:** ADB and the Maestro CLI on your `PATH` (see Quickstart)

---

## Quickstart

**1. Install ADB**

| OS      | Command                                                                                       |
| ------- | --------------------------------------------------------------------------------------------- |
| macOS   | `brew install android-platform-tools`                                                         |
| Linux   | `sudo apt install adb`                                                                        |
| Windows | [Platform Tools](https://developer.android.com/tools/releases/platform-tools) + add to `PATH` |

**2. Install Maestro** — see the [official guide](https://maestro.mobile.dev/getting-started/installing-maestro).

**3. Get Maestro Deck** — download from [Releases](https://github.com/BlueShork/maestro-deck/releases) or [build from source](#build-from-source).

**4. Plug in a device** with USB debugging enabled, accept the prompt, and pick it in the app.

---

## Build from source

Requires Node 20+, [pnpm](https://pnpm.io) 10+, Rust (via [rustup](https://rustup.rs)), and the [Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/).

```bash
git clone https://github.com/BlueShork/maestro-deck.git
cd maestro-deck
pnpm install
pnpm tauri:dev
```

Build a release bundle:

```bash
pnpm tauri:build
```

Installers are written to `src-tauri/target/release/bundle/`.

---

## How it works

Single-window Tauri 2 app: React + TypeScript on the frontend, Rust on the backend driving ADB and a bundled scrcpy server.

```
  React (webview)  <-- IPC -->  Rust (Tauri)  <-- USB -->  Android
```

More details in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## Roadmap

| Version              | Scope                                                   |
| -------------------- | ------------------------------------------------------- |
| **v0.1** _(current)_ | Android USB, single device, inspector + editor + runner |
| **v0.2**             | iOS simulator, multi-device, record mode                |
| **v0.3**             | iOS physical devices, plugin system                     |
| **v1.0**             | Production-ready                                        |

Cloud execution is a non-goal. Maestro Deck stays local.

---

## Contributing

Contributions of any size are welcome.

- [Good first issues](https://github.com/BlueShork/maestro-deck/labels/good%20first%20issue)
- [Discussions](https://github.com/BlueShork/maestro-deck/discussions)
- [CONTRIBUTING.md](CONTRIBUTING.md) for setup and PR process
- [Code of Conduct](CODE_OF_CONDUCT.md)

For security issues, see [SECURITY.md](SECURITY.md).

---

## License

Maestro Deck is licensed under the [Business Source License 1.1](LICENSE) — Copyright 2026 Ethan Morisset.

**What this means:**

- The source code is publicly available and you may read, copy, modify, and redistribute it.
- You may use Maestro Deck in **production for the internal business operations of your organization and its employees** under the Additional Use Grant in the [LICENSE](LICENSE).
- **You may not** offer Maestro Deck as a hosted or embedded service to third parties, or redistribute it (in original or modified form) as a commercial product or as part of a commercial offering. These uses require a commercial license — contact the author to discuss terms.
- On **2030-05-15** (the Change Date), the license automatically transitions to [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0), making Maestro Deck fully open source.

BUSL-1.1 is a *source-available* (not OSI-approved open source) license, similar to those used by Sentry, MariaDB, CockroachDB, and HashiCorp products.

Contributions are accepted under a [Contributor License Agreement](CLA.md) — see [CONTRIBUTING.md](CONTRIBUTING.md) for details.

---

## Trademark notice

**Maestro Deck™** is a trademark of Ethan Morisset, filed with the French INPI on 2026-05-19 (application n°5259782, Nice classes 9 and 42) — status: *French trademark filed, under examination*. See the [legal notice](https://www.maestrodeck.cloud/legal/mentions-legales) on the official website for up-to-date filing status.

Maestro Deck is an independent, community-built project. It is **not affiliated with, endorsed by, or sponsored by mobile.dev Inc.**, the maintainers of the [Maestro](https://maestro.mobile.dev) mobile testing framework. "Maestro" and related marks are used here nominatively to describe interoperability with the Maestro framework, and any such marks remain the property of their respective owners.

---

## Legal notice

Maestro Deck is published by **Ethan Morisset**, entrepreneur individuel registered in France. Full statutory legal information — publisher identity, SIREN, hosting, contact details, and data handling — is available on the official website:

- **Mentions légales:** [maestrodeck.cloud/legal/mentions-legales](https://www.maestrodeck.cloud/legal/mentions-legales)
- **Terms of use (CGU):** [maestrodeck.cloud/legal/cgu](https://www.maestrodeck.cloud/legal/cgu)
- **Terms of sale (CGV):** [maestrodeck.cloud/legal/cgv](https://www.maestrodeck.cloud/legal/cgv)
- **Privacy policy:** [maestrodeck.cloud/legal/confidentialite](https://www.maestrodeck.cloud/legal/confidentialite)
- **Cookies:** [maestrodeck.cloud/legal/cookies](https://www.maestrodeck.cloud/legal/cookies)
- **License terms:** [LICENSE](LICENSE) (BUSL-1.1)
- **Security disclosures:** [SECURITY.md](SECURITY.md)

Maestro Deck (the desktop application) runs entirely locally and does not collect telemetry or personal data — any data processed by the app stays on your machine.

By downloading, building, or using Maestro Deck, you agree to the terms set out in the [LICENSE](LICENSE) and the legal information published at [maestrodeck.cloud](https://www.maestrodeck.cloud/).

---

## Acknowledgements

Thanks to everyone who has contributed code, issues, ideas, and feedback to Maestro Deck — this project is shaped by its contributors.

A special thank you to [KRANSBOOK](https://github.com/KRANSBOOK) for the encouragement and support throughout the development of this project.
