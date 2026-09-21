# Screenshot bank in GitLab CI (add-on to the existing Maestro job)

This reproduces **exactly** what Maestro Deck's screenshot bank does — same
capture pipeline (Maestro `takeScreenshot`), same diff algorithm (YIQ
pixelmatch), same system-chrome masking — so a green CI means the same thing as
a green review in the app.

> This file is intentionally **not committed**. Maestro already runs in your
> GitLab pipeline; this is a **pure addition** — you drop in one diff script and
> append a few lines to (or after) the existing Maestro job. The flows and the
> bank already live under `maestro/` — nothing there moves.

---

## How it maps to the app

| App concept | CI equivalent |
|---|---|
| Baselines in `maestro/bank/<device_key>/*.png` | **Same path** — committed in your repo |
| Captures from `takeScreenshot:` | Same — Maestro writes `<name>.png` next to the running flow |
| Diff (YIQ, per-pixel `tolerance` 0.1) | `visual-diff.mjs` (identical math) |
| Regression threshold `0.001` (0.1% of pixels) | `VR_THRESHOLD` (same default) |
| "Ignore system chrome" toggle | `VR_IGNORE_CHROME` (top/bottom/right bands, same ratios) |

The precision is identical because the diff is a line-for-line port of the app's
`src-tauri/src/bank/diff.rs` (YIQ color delta, `max_delta = 35215 · tolerance²`)
and the mask ratios mirror `src-tauri/src/bank/mod.rs`:

- iOS: top **6%**, bottom **4%**, right **2%**
- Android: top **4.5%**, bottom **4.5%**, right **2%**

---

## 1. Repo layout (your existing Maestro structure — unchanged)

```
your-project/
├─ maestro/                        # your flows, exactly as they are today
│  ├─ login.yaml                   #   maestro/*.yaml
│  ├─ directories/                 #   …or maestro/directories/*.yaml
│  │  └─ settings.yaml
│  └─ bank/                        # the committed baselines (the "bank")
│     └─ iPhone_15_1179x2556/      #   device_key = <model>_<WxH>
│        ├─ home.png
│        └─ settings.png
├─ scripts/
│  └─ visual-diff.mjs              # the diff script (you add this)   — section 2
└─ .gitlab-ci.yml                  # add a few lines here             — section 3
```

You touch **only** `scripts/visual-diff.mjs` and `.gitlab-ci.yml`. The flows and
`maestro/bank/…` stay where they are.

To **seed / update** the bank, do it from the app (**Replace baseline**) or run
the flows once and copy the produced PNGs into
`maestro/bank/<device_key>/` — then review the git diff and commit.

---

## 2. `scripts/visual-diff.mjs`

Zero build step. One dependency: `pngjs`.

```bash
yarn add -D pngjs
```

```js
// scripts/visual-diff.mjs
// Port of maestro-deck's bank diff (src-tauri/src/bank/{diff,mod}.rs).
// Same YIQ pixelmatch + system-chrome masking => same pass/fail decisions.
//
// Structure assumed (matches the app):
//   baselines : maestro/bank/<device_key>/*.png   (committed)
//   captures  : produced by `maestro test`; wherever your GitLab job runs
//               maestro from — found recursively from VR_SEARCH_ROOT by basename.
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { PNG } from "pngjs";

// --- config (defaults mirror the app) ---
const TOLERANCE = Number(process.env.VR_TOLERANCE ?? 0.1); // per-pixel sensitivity
const THRESHOLD = Number(process.env.VR_THRESHOLD ?? 0.001); // changed-pixel share
const PLATFORM = process.env.VR_PLATFORM ?? "ios"; // ios | android | web
const IGNORE_CHROME = (process.env.VR_IGNORE_CHROME ?? "1") !== "0";
const MAESTRO_DIR = process.env.VR_MAESTRO_DIR ?? "maestro"; // flows + bank root
const SEARCH_ROOT = process.env.VR_SEARCH_ROOT ?? "."; // where to hunt captures
const DEVICE_KEY = process.env.VR_DEVICE_KEY; // e.g. iPhone_15_1179x2556
if (!DEVICE_KEY) {
  console.error("VR_DEVICE_KEY is required (e.g. iPhone_15_1179x2556).");
  process.exit(1);
}
const BANK_DIR = join(MAESTRO_DIR, "bank", DEVICE_KEY);

// mask fractions — mirror bank/mod.rs (status_bar / nav_bar / scrollbar)
function ratios(platform, on) {
  if (!on) return { top: 0, bottom: 0, right: 0 };
  if (platform === "ios") return { top: 0.06, bottom: 0.04, right: 0.02 };
  if (platform === "android") return { top: 0.045, bottom: 0.045, right: 0.02 };
  return { top: 0, bottom: 0, right: 0 };
}

// YIQ perceptual delta — mirror bank/diff.rs color_delta (alpha ignored).
function colorDelta(a, b, o) {
  const ar = a[o], ag = a[o + 1], ab = a[o + 2];
  const br = b[o], bg = b[o + 1], bb = b[o + 2];
  const dy =
    (ar * 0.29889531 + ag * 0.58662247 + ab * 0.11448223) -
    (br * 0.29889531 + bg * 0.58662247 + bb * 0.11448223);
  const di =
    (ar * 0.59597799 - ag * 0.2741761 - ab * 0.32180189) -
    (br * 0.59597799 - bg * 0.2741761 - bb * 0.32180189);
  const dq =
    (ar * 0.21147017 - ag * 0.52261711 + ab * 0.31114694) -
    (br * 0.21147017 - bg * 0.52261711 + bb * 0.31114694);
  return 0.5053 * dy * dy + 0.299 * di * di + 0.1957 * dq * dq;
}

function diffRatio(bank, cap) {
  if (bank.width !== cap.width || bank.height !== cap.height) {
    return { dimMismatch: true, ratio: 0 };
  }
  const w = cap.width, h = cap.height;
  const r = ratios(PLATFORM, IGNORE_CHROME);
  const maskTop = Math.min(Math.round(h * r.top), h);
  const maskBottom = Math.min(Math.round(h * r.bottom), h - maskTop);
  const maskRight = Math.min(Math.round(w * r.right), w);
  const bottomStart = h - maskBottom;
  const rightStart = w - maskRight;
  const maxDelta = 35215 * TOLERANCE * TOLERANCE;
  const A = bank.data, B = cap.data;
  let changed = 0, compared = 0;
  for (let y = 0; y < h; y++) {
    const rowMasked = y < maskTop || y >= bottomStart;
    for (let x = 0; x < w; x++) {
      if (rowMasked || x >= rightStart) continue; // ignored band
      compared++;
      if (colorDelta(A, B, (y * w + x) * 4) > maxDelta) changed++;
    }
  }
  return { dimMismatch: false, ratio: compared === 0 ? 0 : changed / compared };
}

// Recursively index every capture PNG under SEARCH_ROOT, EXCLUDING the bank dir
// (and .git/node_modules). `takeScreenshot: home` writes home.png relative to
// Maestro's CWD, which varies per job — so we find captures by basename.
const SKIP = new Set([".git", "node_modules"]);
function indexCaptures(dir, bankAbs, acc) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && SKIP.has(entry.name)) continue;
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (resolve(p) === bankAbs) continue; // never treat baselines as captures
      indexCaptures(p, bankAbs, acc);
    } else if (entry.name.endsWith(".png")) {
      acc.set(entry.name, p); // basename -> path (first wins)
    }
  }
  return acc;
}

const read = (p) => PNG.sync.read(readFileSync(p));
const pct = (r) => `${(r * 100).toFixed(3)}%`;

if (!existsSync(BANK_DIR) || !statSync(BANK_DIR).isDirectory()) {
  console.error(`No bank at ${BANK_DIR}/ — wrong VR_DEVICE_KEY or not seeded.`);
  process.exit(1);
}
const baselines = readdirSync(BANK_DIR).filter((f) => f.endsWith(".png"));
if (baselines.length === 0) {
  console.error(`No baselines in ${BANK_DIR}/ — seed it first (see the doc).`);
  process.exit(1);
}

const captures = indexCaptures(SEARCH_ROOT, resolve(BANK_DIR), new Map());

let passed = 0, changed = 0, missing = 0;
for (const file of baselines) {
  const capPath = captures.get(file);
  if (!capPath) {
    console.error(`✗ ${file}: capture missing (flow didn't produce it)`);
    missing++;
    continue;
  }
  const res = diffRatio(read(join(BANK_DIR, file)), read(capPath));
  if (res.dimMismatch) {
    console.error(`✗ ${file}: dimensions differ from baseline`);
    changed++;
  } else if (res.ratio > THRESHOLD) {
    console.error(`✗ ${file}: ${pct(res.ratio)} changed (> ${pct(THRESHOLD)})`);
    changed++;
  } else {
    console.log(`✓ ${file}: ${pct(res.ratio)} changed`);
    passed++;
  }
}
console.log(`\n${passed} passed · ${changed} changed · ${missing} missing`);
process.exit(changed + missing > 0 ? 1 : 0);
```

Run it locally exactly like CI:

```bash
VR_PLATFORM=ios VR_DEVICE_KEY=iPhone_15_1179x2556 node scripts/visual-diff.mjs
```

---

## 3. `.gitlab-ci.yml` — the addition

Maestro already runs in your pipeline. The regression check is just: after the
flows have produced their PNGs, run the diff against the committed bank. Two
ways to wire it — pick one.

### Option A — append to your existing Maestro job (simplest)

The captures are already in the job workspace, so just add two lines to its
`script:` and expose the report as an artifact.

```yaml
# your existing job — only the *added* lines are marked ADDED
maestro:
  # image:, tags:, before_script:, etc. stay as they are
  variables:
    VR_PLATFORM: ios
    VR_IGNORE_CHROME: "1"                 # set "0" to compare the full screen
    VR_DEVICE_KEY: iPhone_15_1179x2556    # MUST match maestro/bank/<...> + device
  script:
    - maestro test maestro/              # <- your existing Maestro run (unchanged)
    - yarn add -D pngjs                  # ADDED  (skip if node/pngjs already present)
    - node scripts/visual-diff.mjs       # ADDED  compare bank vs captures
  artifacts:
    when: always
    paths:
      - "**/*.png"                        # captures kept for inspection on failure
```

### Option B — separate downstream job (keeps concerns split)

Have the Maestro job publish its captures as artifacts, then a dedicated job
consumes them and runs the diff. Requires Node in the image (or install it).

```yaml
visual-regression:
  stage: test
  needs: ["maestro"]        # runs after your Maestro job, reuses its artifacts
  image: node:20            # any image with node; pngjs is installed below
  variables:
    VR_PLATFORM: ios
    VR_IGNORE_CHROME: "1"
    VR_DEVICE_KEY: iPhone_15_1179x2556
  script:
    - yarn add -D pngjs
    - node scripts/visual-diff.mjs
  artifacts:
    when: always
    paths:
      - "**/*.png"
```

For Option B the Maestro job must expose the captures, e.g.:

```yaml
maestro:
  # …
  artifacts:
    paths:
      - "**/*.png"   # so visual-regression can read the produced screenshots
```

**Where the captures land (the one gotcha).** `takeScreenshot: home` writes
`home.png` relative to Maestro's **CWD** — i.e. wherever your job invokes
`maestro test` from, *not* necessarily next to the flow. The diff script doesn't
care: it searches recursively from `VR_SEARCH_ROOT` (default `.`, the repo root)
and matches captures to baselines **by filename**, skipping `maestro/bank/`,
`.git` and `node_modules`. So it works whether you run `maestro test maestro/`
from the root or `cd` into each flow's folder. If your captures land in one known
subdir, narrow the scan with `VR_SEARCH_ROOT=that/dir` to speed it up.

**Android variant:** set `VR_PLATFORM: android` and point `VR_DEVICE_KEY` at the
Android `<model>_<WxH>` bank folder. Everything else is identical — as long as
the emulator your pipeline already uses matches the resolution that seeded the
bank.

---

## 4. Updating baselines (when a UI change is intentional)

1. Let CI fail and download the `captures` artifact (or run the flows locally).
2. Replace the changed files in `maestro/bank/<device_key>/`, review the diff,
   commit.

That's the CI equivalent of clicking **Replace baseline** in the app.

---

## Notes on staying pixel-identical to the app

- **Same device.** `device_key` in the app is `model + WxH`; in CI, pinning the
  simulator model/OS keeps the resolution — and therefore the baselines — valid.
  `VR_DEVICE_KEY` **must** name the same `maestro/bank/<…>` folder, or every file
  reports MISSING (wrong folder) / dimension mismatch (wrong resolution).
- **Same masking.** `VR_IGNORE_CHROME=1` matches the app's "Ignore system
  chrome" toggle ON. If you run the app with it OFF, set `VR_IGNORE_CHROME=0`.
- **Same thresholds.** `VR_TOLERANCE=0.1`, `VR_THRESHOLD=0.001` are the app
  defaults; override both here and in the app's Visual Regression settings if
  you tune them.
- **Same capture.** Both use Maestro `takeScreenshot`, so the input PNGs come
  from the identical pipeline; only the pinned device differs from your desk.
- **Same capture location.** The app runs Maestro with `CWD = flow folder`; the
  workflow loop above reproduces that so captures land next to the flows and the
  diff finds them by basename under `maestro/`.
```