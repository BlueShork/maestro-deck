# Maestro Deck — Landing Page (Direction B) Implementation Spec

**Date:** 2026-04-23
**Source:** `/Users/ethanmorisset/Downloads/design_handoff_maestro_deck/` (Direction B only — docs shell / Direction C is out of scope)
**Target:** new sibling folder `/Users/ethanmorisset/maestro-deck-landing/`

---

## Goal

Port the Direction B landing page (technical grid, terminal-heavy, monospace-rich) from the HTML/React prototype to a production Next.js project. Fidelity: pixel-accurate on desktop (≥ 1024px). Provide a best-effort responsive adaptation for tablet and mobile without inventing design elements beyond the strategy documented here.

Direction C (docs shell) is explicitly out of scope for this spec — it may be added later in a separate project.

---

## Stack

- **Next.js 14 (App Router)** — TypeScript, statically exportable.
- **Tailwind CSS** — design tokens configured in `tailwind.config.ts`.
- **next/font/google** — Inter + JetBrains Mono, exposed as CSS variables (`--font-inter`, `--font-mono`) to eliminate FOUT.
- No other runtime dependencies. No state management library. No client-side router beyond Next.js built-in.

Node engine requirement: `>= 20` (match the main app's `engines.node`).

---

## Folder structure

```
maestro-deck-landing/
├── app/
│   ├── layout.tsx            # <html>/<body>, font loading, metadata
│   ├── page.tsx              # Composes all sections in order
│   └── globals.css           # @tailwind base/components/utilities + minimal reset
├── components/
│   ├── Nav.tsx               # Server component
│   ├── Hero.tsx              # Server component (composes Install + Downloads + CTAs)
│   ├── TerminalPane.tsx      # Server component — right column terminal card
│   ├── Features.tsx          # Server component
│   ├── Comparison.tsx        # Server component
│   ├── DocsTeaser.tsx        # Server component
│   ├── Footer.tsx            # Server component
│   ├── InstallBlock.tsx      # 'use client' — clipboard state only
│   ├── Downloads.tsx         # Server component (hover via CSS :hover)
│   ├── DocsButton.tsx        # Server component
│   └── icons/
│       ├── Apple.tsx, Windows.tsx, Linux.tsx, Brew.tsx
│       ├── GitHub.tsx, Book.tsx, TerminalGlyph.tsx
│       └── Copy.tsx, Check.tsx, Arrow.tsx
├── lib/
│   └── comparison-data.ts    # COMPARE_ROWS (8 rows)
├── public/
│   └── favicon.svg           # Monogram SVG (outlined square + crosshair)
├── tailwind.config.ts
├── postcss.config.mjs
├── next.config.mjs
├── tsconfig.json
├── package.json
├── .gitignore
└── README.md                 # Short — how to run, how to deploy
```

Each component file has a single responsibility. Components are composed by `app/page.tsx` top-to-bottom in the order Nav → Hero (+ TerminalPane) → Features → Comparison → DocsTeaser → Footer.

---

## Design tokens

All colors and fonts defined once in `tailwind.config.ts`. No inline styles in components — everything through Tailwind utility classes.

### Colors

```ts
colors: {
  ink:           '#0a0a0a',   // primary text, terminal bg
  'ink-2':       '#111',      // borders, button fills
  'ink-muted':   '#333',      // secondary text
  'ink-soft':    '#444',      // lead paragraphs
  'text-muted':  '#555',      // feature body
  'text-quiet':  '#666',      // eyebrows
  'text-meta':  '#888',       // mono meta
  'text-dim':   '#999',       // disabled/meta
  bg:           '#fff',
  'bg-soft':    '#fafaf9',
  surface:      '#f7f7f5',    // Deck comparison column, docs teaser right pane
  'border-soft': '#e8e8e5',
  'border-subtle': '#eee',
  'border-alt': '#ddd',       // docs teaser list separators
  terminal: {
    bg:      '#0a0a0a',
    text:    '#e5e5e5',
    dim:     '#888',
    success: '#4ade80',
    border:  '#1a1a1a',
    dot:     '#2a2a2a',
  },
},
```

### Typography

Fonts loaded via `next/font/google`:

```ts
// app/layout.tsx
import { Inter, JetBrains_Mono } from 'next/font/google';
const inter = Inter({ subsets: ['latin'], weight: ['400','500','600'], variable: '--font-inter', display: 'swap' });
const mono  = JetBrains_Mono({ subsets: ['latin'], weight: ['400','500'], variable: '--font-mono', display: 'swap' });
```

Tailwind:

```ts
fontFamily: {
  sans: ['var(--font-inter)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
  mono: ['var(--font-mono)',  'ui-monospace',  'SFMono-Regular', 'Menlo', 'monospace'],
},
```

### Responsive breakpoints

Tailwind defaults: `md: 768px`, `lg: 1024px`. The design is locked at `lg+`. Below that, the fallbacks below apply.

---

## Section-by-section behavior

### 1. Nav

**Desktop (`lg+`):** single row grid `1fr auto`, padding `18px 48px`, 1px `ink-2` bottom border. Left: monogram SVG (18×18) + `maestro-deck` (Inter 600, 13px) + `v0.8.2` (mono, `text-dim`). Right: 5 links in mono 13px, gap 28px — `./install`, `./features`, `./vs-studio`, `./docs`, `github` (with GitHub icon).

**Mobile (`< md`):** logo + `github` link only. Hide the 4 path-style links. Padding 24px. No hamburger — keep it simple.

**Tablet (`md → lg`):** all links visible, gap 20px, padding 32px.

### 2. Hero

**Desktop:** 2-col grid `1.1fr 1fr`, 1px `ink-2` vertical divider between. 1px `ink-2` bottom border.

**Left column** (padding `64px 48px 56px`):
- Eyebrow: `// open-source · apache 2.0 · drop-in for maestro studio` — mono 12px, `text-quiet`, letter-spacing .04em, margin-bottom 28px.
- H1: `Mobile E2E,<br/><span mono>>_</span> on your terms.` — Inter 500, **64px**, letter-spacing -0.03em, line-height 1.02. The `>_` span is mono 400 54px.
- Sub: 16px `ink-soft`, max-width 440px, line-height 1.55, margin-top 24px.
- **Install block** (terminal variant, max-width 520px) preceded by `ONE-LINER INSTALL` label (mono 11px `text-dim`, uppercase, letter-spacing .1em).
- **Downloads** (pills variant) preceded by `OR GRAB A BINARY` label (same styling).
- 2 CTAs: primary "Read the docs", outline "./quickstart".

**Right column:** terminal pane — see TerminalPane spec below.

**Mobile (`< md`):** single column stacked. H1 shrinks to **40px** (keep -0.03em, line-height 1.05). Padding 32px. Terminal renders below the left content, full-width. Install block shrinks to `max-w-full`.

**Tablet (`md → lg`):** single column, H1 **52px**, padding 48px, terminal below.

### 3. TerminalPane (right column of hero)

Fully static — no animation, no typing effect, no state. Rendered as a single `<pre>` block with colored spans.

- Wrapper: `bg-terminal-bg text-terminal-text`, no padding on wrapper.
- Header bar: flex row, padding `14px 18px`, 1px `terminal-border` bottom, mono 12px `#777`. Three 10×10 dots (`terminal-dot`), then ` ~/app · maestro-deck test`.
- Content: `<pre>` padding `22px 22px 28px`, mono 13px, line-height 1.7, `whitespace-pre-wrap`. Includes the test run transcript from the handoff verbatim (6 ✓ steps, summary line, report path, final `$ _`).

**Mobile:** wrap in `overflow-x-auto` container, max-height `420px` with `overflow-y-auto`. Font unchanged — horizontal scroll preserves the alignment of the ✓ column rather than letting it wrap.

### 4. Features

**Desktop:** section header strip (padding `16px 48px`, 1px `ink-2` top+bottom, mono 12px `text-quiet` uppercase, letter-spacing .12em: `§ Features`). Below: 4-col grid with 1px `ink-2` vertical dividers between columns. Each cell padding `32px 24px 36px`.

Each feature:
- Number `001`–`004` (mono 11px `text-dim`, margin-bottom 28px).
- Title (Inter 600, 18px, letter-spacing -0.01em, margin-bottom 10px).
- Body (13px `text-muted`, line-height 1.55).

Content from the handoff verbatim:
1. YAML flows — Plain-text, diffable, reviewable. Same syntax your team already knows.
2. Self-hosted — Daemon runs on your CI node. Nothing phones home.
3. iOS & Android — Simulators, emulators, physical devices — one CLI.
4. CI-native — GitHub Actions, GitLab CI, CircleCI, Buildkite templates included.

**Mobile (`< md`):** 1 col, horizontal 1px `ink-2` dividers between rows (replace vertical).
**Tablet (`md → lg`):** 2 col (2×2), with 1px dividers on inner edges only.

### 5. Comparison

Section header strip: `§ Deck vs Studio`.

**Desktop:** table inside `40px 48px 56px` padding. 3 columns: `Capability | Studio (SaaS) | Deck (OSS)`. Width distribution: 32% / auto / auto. Headers in mono 11px `text-dim` uppercase letter-spacing .1em, 1px `ink-2` bottom. The Deck column header and body cells have `bg-surface` (`#f7f7f5`). Body rows: 16px padding, 1px `border-subtle` bottom. Deck cell includes an inline `CheckGlyph` 12px before the value, weight 500 `ink-2`.

Data lives in `lib/comparison-data.ts` (the 8 rows from the handoff).

**Mobile:** wrap the whole `<table>` in `overflow-x-auto`. Padding reduces to `24px 16px` on the container. Cell padding reduces to `12px`. Table keeps its 3 columns — no card/stack transformation (too lossy for a comparison).

### 6. DocsTeaser

Section grid with 1px `ink-2` bottom border.

**Desktop:** 2-col grid `1fr 1fr`, 1px `ink-2` vertical divider.

**Left** (padding `56px 48px`): `§ Docs` eyebrow, H2 "Everything you need,<br/>indexed and searchable." (Inter 500, 36px, letter-spacing -0.02em, line-height 1.1), body 15px `text-muted` max-width 440px, 2 CTAs (primary "Read the docs", outline "Migration guide").

**Right** (padding `56px 48px`, `bg-surface`): "POPULAR" label (mono 11px uppercase letter-spacing .1em `text-dim`), then 6 link rows. Each row: flex between, padding `12px 0`, 1px `border-alt` top (first row only) + bottom, label (mono 13px `ink-2`), trailing `ArrowGlyph` 13px.

Link titles from the handoff verbatim (6 items).

**Mobile:** 1 col stacked. Right pane (Popular list) renders below the left. Padding reduces to `32px 24px`.

### 7. Footer

Flex row, padding `20px 48px`, mono 12px `text-meta`. Left: `maestro-deck · apache 2.0 · © 2026 contributors`. Right: 4 links (github, discord, changelog, security), gap 20px.

**Mobile:** `flex-wrap` with 12px vertical gap, padding `20px 24px`, stacks naturally.

---

## Reusable components

### InstallBlock (terminal variant only for this spec)

`'use client'`. State: `copied: boolean`.

```
bg-terminal-bg text-[#fafafa] rounded-[10px] px-5 py-[18px]
font-mono text-sm flex items-center gap-[14px]
```

Children: 3 dots (10×10 `#333`), `$` prompt (`text-[#666]`), command span (`flex-1 whitespace-nowrap overflow-hidden text-ellipsis`), Copy button on the right.

Button: `bg-transparent border border-[#222] rounded-md px-[10px] py-[6px] text-xs text-[#888]`. On copy: writes to clipboard via `navigator.clipboard?.writeText(cmd)`, sets `copied = true`, schedules `setCopied(false)` after 1400ms. Clipboard failure silently ignored (wrap in try/catch).

Default command: `curl -fsSL https://get.maestrodeck.dev | sh`.

The other two variants (underlined, boxed) from the shared.jsx are **not implemented** in this spec — Direction C would need them. Keep the component open for extension if added later.

### Downloads (pills variant only for this spec)

Server component. Static flex-wrap, gap 10px. Each pill: `<a>` with `inline-flex items-center gap-2 px-4 py-[10px] border border-ink-2 rounded-full text-ink-2 bg-white text-[13px] font-medium transition-colors`.

Hover inversion via CSS `:hover` (Tailwind `hover:bg-ink-2 hover:text-white`) — no React state.

Platforms (from handoff):
- mac / macOS / Apple glyph
- win / Windows / Windows glyph
- linux / Linux / Linux (Tux) glyph
- brew / Homebrew / Brew glyph

URLs: placeholder `href="#"` for v1. To be wired to real GitHub release artifacts later.

### DocsButton

Server component. Three variants: `primary` (bg `ink-2`, text white), `outline` (1px `ink-2` border, text `ink-2`), `ghost` (no border, book icon + trailing arrow). All: `inline-flex items-center gap-2 px-5 py-3 rounded-lg text-sm font-medium`.

### Icons

Each in `components/icons/`, exported as a React component taking `size?: number` prop. SVG markup copied verbatim from `shared.jsx` (stroke/fill unchanged — they use `currentColor` where relevant). `viewBox="0 0 24 24"`, `aria-hidden`.

---

## Content copy

All body copy, titles, feature descriptions, comparison rows, and popular doc link titles come from the handoff `direction-b.jsx` **verbatim**. No rewording for v1. The handoff README calls this out as "realistic-but-placeholder" — we preserve it exactly so the design team owns copy changes separately.

---

## Interactions

1. **Install copy** — only dynamic behavior. 1400ms revert timer. No toast, no error surfacing on failure.
2. **Pill hover** — CSS only.
3. **Link hovers** (nav, footer, docs teaser rows) — no hover styles beyond underline-on-focus for accessibility. The handoff does not specify link hover styles.

No scroll behavior, no animations, no intersection observers, no sticky elements.

---

## Accessibility

- Semantic HTML: `<nav>`, `<main>`, `<section>`, `<footer>`, `<table>` with `<thead>`/`<tbody>`.
- Each section gets an `id` matching the nav anchor (`install`, `features`, `compare`, `docs`).
- All decorative SVGs have `aria-hidden`.
- Copy button has `aria-label="Copy install command"` and `aria-live="polite"` on the status text.
- Color contrast: body text (≥ 13px) meets WCAG AA — `text-quiet` #666 on white = 5.74:1 ✓, `text-muted` #555 on white = 7.46:1 ✓. Meta text (`text-meta` #888, `text-dim` #999) at 11–12px is **below AA contrast** against white. This is a deliberate design choice inherited from the handoff; we preserve it for v1. Flag to the design team on first review if compliance is a hard requirement.
- Focus rings: default browser outlines preserved (no `outline: none`).

---

## SEO / metadata

```ts
// app/layout.tsx
export const metadata = {
  title: 'Maestro Deck — Open-source mobile E2E, on your terms',
  description: 'The open-source runner for the Maestro YAML format. Self-hosted, iOS + Android, CI-native.',
  metadataBase: new URL('https://maestrodeck.dev'),
  openGraph: { type: 'website', title: 'Maestro Deck', description: '...', url: '/' },
  twitter: { card: 'summary_large_image' },
};
```

No OG image for v1 — add in a later pass.

---

## Build & deploy

- `pnpm dev` / `pnpm build` / `pnpm start`.
- Output: default Next.js server. Can be switched to `output: 'export'` for fully static deploy if preferred — deferred decision.
- No CI setup in this spec (will be added when the project is first pushed).

---

## Out of scope (explicit)

- Direction C (docs shell) — separate spec when needed.
- MDX pipeline.
- Dynamic GitHub stars/version badge — `v0.8.2` is hardcoded for v1.
- Real download URLs — placeholder `#` for v1.
- Real `/install`, `/features`, etc. routes — these are in-page anchors only for v1.
- Animated terminal (typing effect) — the handoff uses a static transcript and we keep it that way.
- Dark mode.
- i18n (the app is French-speaking but the landing is English per handoff).
- Analytics, consent banners.

---

## Acceptance criteria

- Rendered at 1280px viewport matches `preview.html` Direction B pixel-for-pixel (verified by running both side by side in a browser).
- At 768px and 375px viewports, the responsive strategy above is applied correctly — no horizontal scroll on the page root, no overflowing text, no overlapping elements.
- Copy button writes to clipboard and flips to "Copied" for exactly 1400ms.
- All 8 comparison rows render with correct surface color on the Deck column and the inline check icon.
- `pnpm build` completes with zero type errors and zero warnings.
