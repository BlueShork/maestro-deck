# What's New in v0.9.6

## Fixes
- **Fixed a black screen right after launch.** The app crashed as soon as its automatic setup started, which v0.9.5 triggers to install Maestro 2.10.0. Setup now runs normally, with its progress shown next to Run.

---

# What's New in v0.9.5

## Maestro 2.10.0
- **Maestro Deck now runs on Maestro CLI 2.10.0** (previously 2.5.1). The app's automatic setup downloads it for you, and replaces a Maestro it installed at an older version.
- **Same features, new engine** — Maestro 2.6 removed `maestro studio`, which the app relied on. The inspector, taps and live preview now go through `maestro mcp` on Android, iOS simulators and the web.
- **Dark mode commands** from Maestro 2.9 (`setDarkMode`, `toggleDarkMode`, `assertDarkMode`, `assertLightMode`) are suggested in the editor, tracked in the run console and known to Billy.
- **Known limitation:** physical iPhones still need the patched Maestro 2.5.1 and don't work with 2.10.0 yet.

## Fixes
- Screenshots taken with `takeScreenshot` land next to the flow again, so the screenshot bank finds them instead of reporting them as missing.
- The screenshot bank gallery no longer leaves cards small, faded and far apart when it fits without scrolling, no longer crashes into a black screen on WebKit, and web baselines show a globe icon.
- The "Recovering driver…" notice no longer stays on screen after the driver has recovered.

---

# What's New in v0.9.0

## Maestro Deck Cloud
- **Optional sign-in** with a Maestro Deck Cloud account, plus an account page with your plan and remaining runs.
- **Run flows in the cloud** — on a hosted Android emulator, a hosted iOS simulator, or a real phone from the device farm. A label next to Run says where the flow is about to go.
- **Live preview of cloud runs** — watch the Android emulator, iOS simulator or device-farm phone while your flow runs remotely.
- **Clearer cloud results** — failed runs say why, passing runs are no longer marked as failed, and finished runs stop polling.

## Billy
- **Maestro Deck as an AI provider** — use Billy with your Maestro Deck account, no API key needed. It is the default on fresh installs; bring-your-own-key providers are still available.
- **Voice input**, with a live meter while Billy is listening.

## Getting started
- **Automatic toolchain setup** — on first launch the app installs what it needs (Java, Maestro, …) in its own folder, with a progress chip next to Run.
- **Guided first test** — a walkthrough with a sample app takes you from writing your first flow to running it, locally or in the cloud. It shows once, and you can reopen it anytime.

## Interface
- **New update prompt** — updates now arrive as a ticket with the release notes: tear off the stub to install.
- **Animated step status** in the console, and a segmented control to switch console views.
- **Loaders** while a device's first frame arrives and while a run uploads, queues and runs.
- **New toasts** that rise from the bottom and can be swiped away.
- Refreshed splash screen, empty device state, image bank gallery and console tabs.

## Fixes
- The editor draws its own caret, and inspector actions are inserted at the last cursor position.
- Screenshot bank images are aligned correctly.

---

# What's New in v0.8.0

## Devices panel redesign
- **Real brand icons** for Apple/Android devices, replacing generic icons.
- **Clearer connected state** — connected devices stay green via border/background/icon instead of a pulsing dot.
- **Auto-poll for hotplug** — plugged-in devices and booted simulators now appear automatically in the background.
- **iOS simulators as tappable rows** — tap a simulator to launch it, instead of picking from a dropdown.
- **Scrollable device list** — a long list of devices/simulators now scrolls instead of overflowing the panel.
- **Uniform toolbar buttons** — Run / Run all line up with the icon buttons instead of rendering shorter.

## Maintenance
- Dependency updates (js-yaml, vitest, postcss, actions/setup-node).

---

# What's New in v0.7.0

## Visual regression
- **Screenshot bank** — capture reference screenshots and compare later runs against them to catch unintended visual changes, with a side-by-side image diff.

## Performance
- **Perf panel improvements** and a configurable **`APP_ID`** so performance metrics target the right app.

## Maintenance
- Dependency and CI updates (js-yaml, vite, actions/checkout).

---

# What's New in v0.5.5

## iOS
- **Running flows on the iOS Simulator now works reliably** — starting a flow with the inspector open no longer hangs forever on "waiting for iOS driver".
- **Much faster simulator reconnect** — reconnecting to the same booted simulator reuses the warm driver instead of paying the 1–2 min cold start again.
- **Physical iPhone preview is more robust** — the live screen now shows even on devices where the USB mirror stays silent (it falls back to a screenshot mirror), and inspecting a physical device no longer freezes.
- **Clearer first-connect feedback** — the simulator shows a "starting iOS driver…" message instead of a silent spinner, and the driver now gets its full startup window before timing out.

## Android
- **Fixed the frozen mirror on Android 16** — updated the bundled screen-mirroring engine (scrcpy 3.3.4), so Android 16 emulators and devices no longer freeze on the first frame.

## General
- **Web Browser is now an opt-in beta** — it's off by default; enable it from **Settings → Device & Performance** if you want to try it.
- **Reorganized Settings** into clearer groups (Appearance, Editor, Application, Mirroring, Inspector, …).
- **The console "Clear" button now works in Simple mode** — it clears the step list, not just the raw log.
- **Inspect mode resets cleanly when you switch devices** — no more stuck "loading" spinner.
- **No more spurious "update failed" popup on startup** when you're already up to date.

---

# What's New in v0.4.0

## iOS support
Maestro Deck now drives iPhones, not just Android:
- **iOS Simulator preview** — pick a booted simulator (or launch one from the app) and see a live, low-latency screen mirror powered by ScreenCaptureKit. Tap, swipe, type, and press Home directly on the preview.
- **Physical iPhone support** — connect a real device over USB and preview/inspect it through the `maestro-ios-device` bridge. A guided **Settings → Tools** checklist walks you through the one-time setup (Xcode, Maestro, on-device bridge) and can auto-install the bridge for you.
- **Run flows on iOS** — execute your Maestro flows against the simulator while the live preview keeps streaming, with the gutter highlighting each step as it runs.
- **Cross-platform selectors** — the inspector folds accessibility labels into text so the selectors you capture stay portable between Android and iOS.

## Workspace & UI
- **Right-click context menu** in the file tree, plus create-folder actions from the header and per-folder buttons. Empty directories now show up in the tree.
- **Full-screen settings page** with instant back navigation.
- **Confirm-before-quit** dialog that cleans up running sessions on exit.
- Centered About panel with the app logo.

## Fixes
- Perf panel now fills the full height and width of its resizable pane.
- Inspector action-menu clicks no longer leak through to the device view.
- Run gutter correctly detects id-based and unquoted steps in the run output.

---

# What's New in v0.3.2

## Bug fixes
- **Inspector mode now works when launching from the Dock or Applications folder** — on macOS, GUI-launched apps inherit a minimal `PATH` that doesn't include Homebrew, Android Studio, or `~/.maestro/bin`. Maestro Deck now probes those locations directly and falls back to your login shell, so `maestro` and `adb` are found even when launched outside a terminal.
- **New "Tool paths" section in Settings** — explicitly point Maestro Deck at your `adb` and `maestro` binaries when auto-detection fails (typical on locked-down corporate machines). Browse for the file or paste a path; changes apply on the next call without restarting the app.

---

# What's New in v0.3.1

## Bug fixes
- **Billy chat now works in production** — fixed a Content Security Policy that blocked direct calls to the Vertex AI and Anthropic APIs from the packaged app. Selecting Gemini Flash (or any model) no longer fails with "Load failed".

## Internal
- Release pipeline now correctly uploads updater signatures and `latest.json` for both macOS and Windows.

---

# What's New in v0.3.0

## Auto-update
Maestro Deck now ships with built-in auto-update on macOS and Windows:
- **Check on startup** — the app silently looks for new versions when you launch it
- **Manual check** — click the version label in the toolbar to check on demand
- **Release notes** — see what's new before downloading
- **One-click install** — download and restart, no separate installer to run

## BYOK Chat Assistant (Billy)
- **Bring your own key** — wire up Anthropic or Vertex AI credentials and chat with Billy directly inside the editor
- **Model picker** — switch between providers and models per-conversation (Anthropic Claude or Vertex Gemini)
- **Persisted choice** — your selected provider/model now sticks across restarts
- **Workspace context** — Billy can read your open flow and the YAML files in the workspace to give targeted help

## Run highlight fixes
- **Multi-line steps** — `assertVisible: { id: ... }`, `scrollUntilVisible: { element: ... }` and other object-form selectors now correctly highlight all of their lines as they execute
- **Resilient matching** — when the Maestro CLI emits a selector format that differs from the parsed YAML, the gutter still falls back to the next pending step in order

## Improvements
- Dynamic version display in the toolbar (read from `package.json` at build time)
- Version aligned across `package.json`, `tauri.conf.json`, and `Cargo.toml`

---

Crafted with care by Ethan Morisset.
