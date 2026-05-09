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
