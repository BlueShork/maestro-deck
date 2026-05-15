# Contributing to Maestro Deck

Thanks for your interest in improving Maestro Deck. This document explains how to set up a development environment, the code style we expect, and the process for getting changes merged.

By participating in this project you agree to abide by our [Code of Conduct](CODE_OF_CONDUCT.md).

---

## Contributor License Agreement (CLA)

Before any contribution can be merged, you must sign the Maestro Deck CLA.

The signing process is automated by [CLA Assistant](https://github.com/contributor-assistant/github-action): when you open your first pull request, a bot will comment with a link asking you to read and accept the CLA. Just reply to the bot's comment with the exact phrase it tells you to (typically `I have read the CLA Document and I hereby sign the CLA`) and you're done — your signature is recorded and applies to all your future PRs to this repo.

The full CLA text is available in [CLA.md](CLA.md). In short, by contributing you grant Ethan Morisset the rights needed to use, modify, redistribute, and commercially license your contribution under any license, including future proprietary licenses. This is necessary so the project can be relicensed (e.g. when the BUSL-1.1 transitions to its Change License) without having to track down every past contributor.

PRs that have not signed the CLA cannot be merged.

---

## Table of contents

- [Getting set up](#getting-set-up)
- [Project layout](#project-layout)
- [Code style](#code-style)
- [Commit messages](#commit-messages)
- [Branching strategy](#branching-strategy)
- [Tests](#tests)
- [Pull request checklist](#pull-request-checklist)
- [Reporting bugs and requesting features](#reporting-bugs-and-requesting-features)

---

## Getting set up

You will need:

- [Node.js](https://nodejs.org) 20 or newer
- [pnpm](https://pnpm.io) 10 or newer
- Rust stable, installed via [rustup](https://rustup.rs)
- Platform-specific Tauri 2.x prerequisites: see the [Tauri prerequisites guide](https://v2.tauri.app/start/prerequisites/)
- ADB in your `PATH` (only required to test against a real device)

Clone and install:

```bash
git clone https://github.com/blueshork/maestro-deck.git
cd maestro-deck
pnpm install
pnpm tauri:dev
```

The dev command launches the Tauri shell with hot-reload for both the React frontend (`src/`) and the Rust backend (`src-tauri/`).

---

## Project layout

```
maestro-deck/
  src/            React + TypeScript frontend (webview)
  src-tauri/      Rust backend (Tauri commands, ADB, scrcpy, runner)
  docs/           Architecture and project planning documents
  .github/        Issue templates, PR template, CI workflows
```

A high-level architecture overview lives in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). The full original plan and rationale lives in [docs/PLAN.md](docs/PLAN.md).

---

## Code style

We rely on automated formatters and linters. CI will fail if your branch is not clean.

**Rust**

- `cargo fmt --all` (rustfmt config in `rustfmt.toml`)
- `cargo clippy --all-targets --all-features -- -D warnings`
- No `unwrap()` or `expect()` on the critical paths. Use `anyhow::Result` for error bubbling and `thiserror` for typed library errors.

**TypeScript / React**

- `pnpm prettier --check .` (Prettier config in `.prettierrc`)
- `pnpm eslint .` (ESLint config in `eslint.config.js`)
- TypeScript strict mode is on. Do not introduce `any` without justification.
- Prefer Zustand stores for shared state. Do not introduce Redux or Context-based global state.

Run the same commands locally before pushing:

```bash
cargo fmt --all
cargo clippy --all-targets --all-features -- -D warnings
pnpm format
pnpm lint
```

---

## Commit messages

We follow the [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) specification. The basic shape is:

```
<type>(<optional scope>): <short summary>

<optional body>

<optional footer(s)>
```

Common types:

- `feat` — a new user-facing feature
- `fix` — a bug fix
- `docs` — documentation only
- `refactor` — code change that neither fixes a bug nor adds a feature
- `perf` — performance improvement
- `test` — adding or correcting tests
- `build` — changes to build tooling, packaging, or dependencies
- `ci` — changes to CI configuration
- `chore` — anything else that does not affect production code

Examples:

```
feat(scrcpy): bundle server jar v2.4 and forward control packets
fix(device): handle unauthorized device serial gracefully
docs(readme): clarify ADB install on Windows
```

Keep the summary under 72 characters and use the imperative mood ("add", not "added").

---

## Branching strategy

- `main` is always releasable.
- Work happens on **feature branches** named `feat/<short-name>`, `fix/<short-name>`, `docs/<short-name>`, etc.
- Open a pull request against `main`. Squash-merge is the default; preserve a Conventional Commit style title on the merge commit.
- Long-lived branches are discouraged. Rebase on `main` regularly to avoid merge debt.

---

## Tests

We expect tests to land alongside the code, not as an afterthought.

- **Rust:** unit tests in the same module (`#[cfg(test)] mod tests`), integration tests in `src-tauri/tests/`. Run with `cargo test`.
- **TypeScript:** component and unit tests with the project's configured test runner. Run with `pnpm test`.
- **Performance-sensitive modules** (video decode, hierarchy parsing, input forwarding) should ship with a benchmark or measurement note in the PR description. The KPIs to keep in mind are documented in [docs/PLAN.md](docs/PLAN.md) section 6.

If a change is impossible or impractical to test automatically (for example, real-device behaviour), describe the manual test steps you ran in the PR.

---

## Pull request checklist

Before requesting review, please confirm:

- [ ] The branch is rebased on the latest `main`.
- [ ] `cargo fmt`, `cargo clippy`, `pnpm lint`, and `pnpm format` all pass locally.
- [ ] Tests have been added or updated and `cargo test` / `pnpm test` are green.
- [ ] Documentation (`README.md`, `docs/`, inline doc comments) is updated when behaviour changes.
- [ ] The PR title follows Conventional Commits.
- [ ] The PR description explains the **why** as well as the **what**, and links any related issue.
- [ ] No secrets, credentials, or personal data are included in the diff.

A maintainer will review and either merge, request changes, or open a discussion. Please be patient — Maestro Deck is a community-driven project.

---

## Reporting bugs and requesting features

Use the [issue templates](https://github.com/blueshork/maestro-deck/issues/new/choose). For security-sensitive reports, follow the process in [SECURITY.md](SECURITY.md) instead of opening a public issue.

