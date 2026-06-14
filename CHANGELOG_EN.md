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
