#!/usr/bin/env node
// Git hook runner: `node scripts/hooks/run.mjs pre-commit|pre-push`.
// pre-commit stays fast and only looks at staged files; pre-push runs the
// slower whole-project checks, limited to the side (frontend / Rust) the
// pushed commits touch.

import { spawn, execFileSync } from "node:child_process";
import { statSync } from "node:fs";
import { createChecklist, printBanner, printSummary } from "./ui.mjs";

const CARGO = "src-tauri/Cargo.toml";
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const ZERO_SHA = /^0+$/;

const git = (...args) =>
  execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
const lines = (text) => text.split("\n").filter(Boolean);

const has = (bin) => {
  try {
    execFileSync(process.platform === "win32" ? "where" : "which", [bin], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};

const plural = (n, word) => `${n} ${word}${n > 1 ? "s" : ""}`;

// Runs a shell command, keeping its combined output for the failure report.
function run(command, args = []) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      shell: true,
      env: { ...process.env, FORCE_COLOR: "1", CLICOLOR_FORCE: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (d) => (output += d));
    child.stderr.on("data", (d) => (output += d));
    child.on("error", (err) => resolve({ ok: false, output: String(err) }));
    child.on("close", (code) => resolve({ ok: code === 0, output }));
  });
}

const quote = (files) => files.map((f) => `"${f}"`);

// ── pre-commit ────────────────────────────────────────────────────────────

function preCommitChecks() {
  const staged = lines(git("diff", "--cached", "--name-only", "--diff-filter=ACMR"));
  const prettierFiles = staged.filter((f) => /^src\/.*\.(ts|tsx|css|json)$/.test(f));
  const eslintFiles = staged.filter((f) => /\.(ts|tsx|js|mjs|cjs)$/.test(f) && !f.startsWith("src-tauri/"));
  const rustFiles = staged.filter((f) => f.endsWith(".rs"));
  const manifests = staged.filter((f) => /^src-tauri\/Cargo\.(toml|lock)$/.test(f));

  return [
    {
      label: "Staged files",
      hint: "conflict markers, file sizes",
      skip: staged.length === 0 && "nothing staged",
      run: async () => {
        const problems = [];
        const diff = git("diff", "--cached", "-U0", "--no-color", "--diff-filter=ACMR");
        let file = "";
        for (const line of diff.split("\n")) {
          if (line.startsWith("+++ b/")) file = line.slice(6);
          else if (/^\+(<{7}|>{7})( |$)/.test(line)) problems.push(`${file}: conflict marker "${line.slice(1, 8)}"`);
        }
        for (const f of staged) {
          const size = statSync(f, { throwIfNoEntry: false })?.size ?? 0;
          if (size > MAX_FILE_BYTES) problems.push(`${f}: ${(size / 1024 / 1024).toFixed(1)} MB (limit 5 MB)`);
        }
        return { ok: problems.length === 0, output: problems.join("\n"), detail: plural(staged.length, "file") };
      },
    },
    {
      label: "Secrets",
      hint: "gitleaks",
      skip: !has("gitleaks") && "gitleaks not installed (brew install gitleaks)",
      run: () => run("gitleaks", ["protect", "--staged", "--redact", "--no-banner"]),
    },
    {
      label: "Prettier",
      hint: plural(prettierFiles.length, "file"),
      skip: prettierFiles.length === 0 && "no frontend files staged",
      detail: plural(prettierFiles.length, "file"),
      run: () => run("pnpm", ["exec", "prettier", "--check", ...quote(prettierFiles)]),
    },
    {
      label: "ESLint",
      hint: plural(eslintFiles.length, "file"),
      skip: eslintFiles.length === 0 && "no TS/JS files staged",
      detail: plural(eslintFiles.length, "file"),
      run: () => run("pnpm", ["exec", "eslint", "--max-warnings", "0", "--no-warn-ignored", ...quote(eslintFiles)]),
    },
    {
      label: "rustfmt",
      hint: plural(rustFiles.length, "file"),
      skip: rustFiles.length === 0 && "no Rust files staged",
      detail: plural(rustFiles.length, "file"),
      run: () => run("cargo", ["fmt", "--manifest-path", CARGO, "--all", "--", "--check"]),
    },
    {
      label: "Cargo.lock",
      hint: "in sync with Cargo.toml",
      skip: manifests.length === 0 && "Cargo manifests untouched",
      run: () => run("cargo", ["metadata", "--locked", "--format-version", "1", "--manifest-path", CARGO]),
    },
  ];
}

// ── pre-push ──────────────────────────────────────────────────────────────

const FRONTEND = /^(src|e2e)\/|^(package\.json|pnpm-lock\.yaml|tsconfig[^/]*\.json|vite\.config\.ts|vitest\.config\.ts)$/;
const RUST = /^src-tauri\//;

// Files changed by the pushed commits, or null when unknown (run everything).
async function pushedFiles() {
  if (process.stdin.isTTY) return null;
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  const refs = lines(input);
  if (refs.length === 0) return null;
  const files = new Set();
  for (const ref of refs) {
    const [, local, , remote] = ref.split(" ");
    if (ZERO_SHA.test(local)) continue; // branch deletion
    let base = remote;
    try {
      if (ZERO_SHA.test(remote)) base = git("merge-base", local, "origin/main").trim();
      else git("cat-file", "-e", remote);
      for (const f of lines(git("diff", "--name-only", base, local))) files.add(f);
    } catch {
      return null;
    }
  }
  return [...files];
}

async function prePushChecks() {
  const files = await pushedFiles();
  const touches = (re) => files === null || files.some((f) => re.test(f));
  const noFrontend = !touches(FRONTEND) && "no frontend changes pushed";
  const noRust = !touches(RUST) && "no Rust changes pushed";

  return [
    {
      label: "TypeScript",
      hint: "tsc --noEmit",
      lane: "tsc",
      skip: noFrontend,
      run: () => run("pnpm", ["typecheck"]),
    },
    {
      label: "Unit tests",
      hint: "vitest",
      lane: "vitest",
      skip: noFrontend,
      run: () => run("pnpm", ["exec", "vitest", "run", "--passWithNoTests"]),
    },
    // Cargo serialises on the target dir lock, so Rust checks share one lane.
    {
      label: "Clippy",
      hint: "-D warnings",
      lane: "cargo",
      skip: noRust,
      run: () => run("cargo", ["clippy", "--manifest-path", CARGO, "--all-targets", "--locked", "--", "-D", "warnings"]),
    },
    {
      label: "Rust tests",
      hint: "cargo test --lib",
      lane: "cargo",
      skip: noRust,
      run: () => run("cargo", ["test", "--manifest-path", CARGO, "--lib", "--locked"]),
    },
  ];
}

// ── runner ────────────────────────────────────────────────────────────────

const HOOKS = { "pre-commit": preCommitChecks, "pre-push": prePushChecks };

async function main() {
  const hook = process.argv[2];
  if (!HOOKS[hook]) {
    process.stderr.write(`Unknown hook "${hook}". Expected one of: ${Object.keys(HOOKS).join(", ")}\n`);
    process.exit(2);
  }

  const checks = (await HOOKS[hook]()).map((c, i) => ({
    ...c,
    lane: c.lane ?? `lane-${i}`,
    status: c.skip ? "skipped" : "pending",
    reason: c.skip || undefined,
  }));

  printBanner(hook, checks.length);
  const list = createChecklist(checks);
  const startedAt = Date.now();
  list.start();

  const lanes = Map.groupBy(
    checks.filter((c) => c.status === "pending"),
    (c) => c.lane,
  );
  await Promise.all(
    [...lanes.values()].map(async (lane) => {
      for (const check of lane) {
        check.status = "running";
        list.update();
        const t = Date.now();
        const result = await check.run();
        check.ms = Date.now() - t;
        check.output = result.output ?? "";
        check.detail = result.ok ? (result.detail ?? check.detail) : undefined;
        check.status = result.ok ? "passed" : "failed";
        list.update();
      }
    }),
  );

  list.stop();
  printSummary(checks, Date.now() - startedAt);
  process.exit(checks.some((c) => c.status === "failed") ? 1 : 0);
}

main();
