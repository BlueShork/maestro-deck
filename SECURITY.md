# Security policy

## Supported versions

Maestro Deck is pre-release. Only the latest tagged version receives security fixes.

| Version | Supported |
|---------|-----------|
| 0.1.x   | yes       |
| < 0.1   | no        |

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security problems.

Email **blueshork.dev@gmail.com** with:

- A description of the issue
- Steps to reproduce
- Affected version(s) and platform(s)
- Any proof-of-concept code (optional)

You should receive an acknowledgement within 5 business days. If the report is
confirmed, we will work on a fix and coordinate a release. Credit will be given
in the release notes unless you prefer to remain anonymous.

## Scope

Maestro Deck is an offline desktop app. The relevant attack surface includes:

- The Tauri IPC bridge between the webview and the Rust backend
- The local filesystem access granted via `tauri-plugin-fs`
- The bundled `scrcpy-server.jar` (pushed to a user-connected device)
- Spawned subprocesses (`adb`, `maestro`)

Out of scope:

- Vulnerabilities in user-supplied YAML flows
- Vulnerabilities in third-party tools (`adb`, `maestro`, `scrcpy`) — please
  report those upstream
