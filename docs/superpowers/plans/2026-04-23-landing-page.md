# Maestro Deck Landing Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the Direction B landing page (HTML/React prototype) to a new production Next.js project at `/Users/ethanmorisset/maestro-deck-landing/`, pixel-accurate on desktop with responsive fallbacks.

**Architecture:** Next.js 14 App Router, TypeScript, Tailwind CSS. One page composed of small focused server components. Single client component for clipboard behavior. No state management library, no runtime deps beyond Next + React.

**Tech Stack:** Next.js 14 · React 18 · TypeScript 5 · Tailwind 3 · next/font (Inter + JetBrains Mono) · pnpm.

**Note on verification:** This is a frontend port without behavioral logic beyond one clipboard action. Per-task verification is `pnpm build` (type safety) and visual check via `pnpm dev`. No unit tests written — the spec's acceptance criteria are visual/structural.

---

## Task 1: Scaffold the Next.js project

**Files:**
- Create: `/Users/ethanmorisset/maestro-deck-landing/` (the whole dir)

- [ ] **Step 1: Create the folder and initialize package.json**

```bash
mkdir -p /Users/ethanmorisset/maestro-deck-landing
cd /Users/ethanmorisset/maestro-deck-landing
```

Create `package.json`:

```json
{
  "name": "maestro-deck-landing",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "next": "^14.2.15",
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@types/node": "^20.12.0",
    "@types/react": "^18.3.12",
    "@types/react-dom": "^18.3.1",
    "autoprefixer": "^10.4.20",
    "postcss": "^8.4.49",
    "tailwindcss": "^3.4.15",
    "typescript": "^5.6.3"
  },
  "engines": { "node": ">=20" }
}
```

- [ ] **Step 2: tsconfig.json, next.config.mjs, postcss.config.mjs, .gitignore**

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

`next.config.mjs`:

```js
/** @type {import('next').NextConfig} */
const nextConfig = { reactStrictMode: true };
export default nextConfig;
```

`postcss.config.mjs`:

```js
export default { plugins: { tailwindcss: {}, autoprefixer: {} } };
```

`.gitignore`:

```
node_modules/
.next/
out/
dist/
.DS_Store
*.log
.env*.local
```

- [ ] **Step 3: Install dependencies**

```bash
cd /Users/ethanmorisset/maestro-deck-landing && pnpm install
```

Expected: `node_modules/` created, lockfile generated.

- [ ] **Step 4: Init git, first commit**

```bash
cd /Users/ethanmorisset/maestro-deck-landing
git init
git add -A
git commit -m "chore: scaffold next.js project"
```

---

## Task 2: Tailwind config with design tokens

**Files:**
- Create: `tailwind.config.ts`
- Create: `app/globals.css`

- [ ] **Step 1: Create `tailwind.config.ts`**

```ts
import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#0a0a0a',
        'ink-2': '#111',
        'ink-muted': '#333',
        'ink-soft': '#444',
        'text-muted': '#555',
        'text-quiet': '#666',
        'text-meta': '#888',
        'text-dim': '#999',
        'bg-soft': '#fafaf9',
        surface: '#f7f7f5',
        'border-soft': '#e8e8e5',
        'border-subtle': '#eee',
        'border-alt': '#ddd',
        terminal: {
          bg: '#0a0a0a',
          text: '#e5e5e5',
          dim: '#888',
          success: '#4ade80',
          border: '#1a1a1a',
          dot: '#2a2a2a',
        },
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      letterSpacing: {
        'tight-h1': '-0.03em',
        'tight-h2': '-0.02em',
        'wide-eyebrow': '0.1em',
        'wide-section': '0.12em',
      },
      maxWidth: { page: '1280px' },
    },
  },
  plugins: [],
};
export default config;
```

- [ ] **Step 2: Create `app/globals.css`**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

html, body {
  margin: 0;
  padding: 0;
  background: #fff;
  color: #0a0a0a;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

* { box-sizing: border-box; }

a { color: inherit; text-decoration: none; }
```

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(tailwind): design tokens + globals"
```

---

## Task 3: Root layout with fonts + metadata

**Files:**
- Create: `app/layout.tsx`

- [ ] **Step 1: Write `app/layout.tsx`**

```tsx
import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-inter',
  display: 'swap',
});

const mono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Maestro Deck — Open-source mobile E2E, on your terms',
  description:
    'The open-source runner for the Maestro YAML format. Self-hosted, iOS + Android, CI-native.',
  metadataBase: new URL('https://maestrodeck.dev'),
  openGraph: {
    type: 'website',
    title: 'Maestro Deck',
    description: 'Open-source mobile E2E, on your terms.',
    url: '/',
  },
  twitter: { card: 'summary_large_image' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable}`}>
      <body className="font-sans">{children}</body>
    </html>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add -A && git commit -m "feat(app): root layout with fonts + metadata"
```

---

## Task 4: Icon components

**Files:**
- Create: `components/icons/index.tsx`

One file for all 10 icons — they're tiny and share the same structure. File stays under 200 lines.

- [ ] **Step 1: Create `components/icons/index.tsx`**

```tsx
type IconProps = { size?: number; className?: string };

export const AppleGlyph = ({ size = 16, className }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
    <path d="M16.6 12.8c-.02-2.5 2.04-3.7 2.13-3.76-1.16-1.7-2.97-1.93-3.62-1.96-1.54-.15-3 .9-3.78.9-.78 0-1.98-.88-3.26-.86-1.68.02-3.23.97-4.1 2.47-1.75 3.04-.45 7.55 1.26 10.02.83 1.2 1.82 2.56 3.1 2.51 1.25-.05 1.73-.81 3.24-.81s1.94.81 3.26.78c1.35-.02 2.2-1.23 3.03-2.44.95-1.4 1.34-2.76 1.36-2.83-.03-.01-2.6-1-2.62-3.96zM14.2 5.4c.68-.83 1.15-1.98 1.02-3.12-.99.04-2.2.66-2.9 1.48-.63.72-1.2 1.9-1.05 3.02 1.1.08 2.24-.56 2.93-1.38z"/>
  </svg>
);

export const WindowsGlyph = ({ size = 16, className }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
    <path d="M2 4.5L11 3.2v8.3H2zM12 3l10-1.5V11.5H12zM2 12.5h9v8.3L2 19.5zM12 12.5h10V22.5L12 21z"/>
  </svg>
);

export const LinuxGlyph = ({ size = 16, className }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
    <path d="M12 2.2c-2.3 0-3.7 2.1-3.7 4.9 0 1.5.4 2.6.9 3.5-1.8 1.2-3.3 3.5-3.5 6-.1 1-.8 1.7-1.4 2.5-.5.7-.9 1.4-.4 2 .5.7 1.6.2 2.5-.3.7-.4 1-.3 1.2.1.6 1.4 2 2.3 4.4 2.3s3.9-1 4.5-2.3c.2-.4.5-.5 1.2-.1.9.5 2 1 2.5.3.5-.6.1-1.3-.4-2-.6-.8-1.3-1.5-1.4-2.5-.2-2.5-1.7-4.8-3.5-6 .5-.9.9-2 .9-3.5 0-2.8-1.4-4.9-3.8-4.9zm-1.7 5.1c.5 0 .9.5.9 1.1 0 .4-.2.7-.4.9.1-.3.1-.7-.1-.9-.3-.2-.7 0-.9.3-.1-.1-.1-.2-.1-.3 0-.6.2-1.1.6-1.1zm3.4 0c.4 0 .6.5.6 1.1 0 .1 0 .2-.1.3-.2-.3-.6-.5-.9-.3-.2.2-.2.6-.1.9-.2-.2-.4-.5-.4-.9 0-.6.4-1.1.9-1.1zm-1.7 2.9c.8 0 2 .6 2 1.1 0 .3-1 .6-2 .6s-2-.2-2-.6c0-.5 1.2-1.1 2-1.1z"/>
  </svg>
);

export const BrewGlyph = ({ size = 16, className }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden className={className}>
    <path d="M7 10c0-2.2 2.2-4 5-4s5 1.8 5 4v1H7v-1z"/>
    <path d="M7 11h10l-1 9H8z"/>
    <path d="M12 6V3M10 3h4"/>
  </svg>
);

export const TerminalGlyph = ({ size = 16, className }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={className}>
    <path d="M4 7l4 4-4 4M12 15h8"/>
  </svg>
);

export const BookGlyph = ({ size = 16, className }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={className}>
    <path d="M4 4h7a3 3 0 013 3v13a2 2 0 00-2-2H4V4z"/>
    <path d="M20 4h-7a3 3 0 00-3 3v13a2 2 0 012-2h8V4z"/>
  </svg>
);

export const GitHubGlyph = ({ size = 16, className }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
    <path d="M12 2a10 10 0 00-3.16 19.49c.5.1.68-.22.68-.48l-.01-1.7c-2.78.6-3.37-1.34-3.37-1.34-.46-1.16-1.12-1.47-1.12-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.9 1.52 2.35 1.08 2.92.83.1-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.94 0-1.1.39-1.99 1.03-2.69-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.03a9.56 9.56 0 015 0c1.91-1.3 2.75-1.03 2.75-1.03.55 1.38.2 2.4.1 2.65.64.7 1.03 1.59 1.03 2.69 0 3.84-2.34 4.69-4.57 4.93.36.31.68.92.68 1.86l-.01 2.76c0 .27.18.59.69.49A10 10 0 0012 2z"/>
  </svg>
);

export const CopyGlyph = ({ size = 14, className }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={className}>
    <rect x="9" y="9" width="11" height="11" rx="2"/>
    <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
  </svg>
);

export const CheckGlyph = ({ size = 14, className }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={className}>
    <path d="M20 6L9 17l-5-5"/>
  </svg>
);

export const ArrowGlyph = ({ size = 14, className }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={className}>
    <path d="M5 12h14M13 6l6 6-6 6"/>
  </svg>
);

export const MonogramGlyph = ({ size = 18, className }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 18 18" aria-hidden className={className}>
    <rect x="0.5" y="0.5" width="17" height="17" fill="none" stroke="currentColor"/>
    <path d="M3 9h12M9 3v12" stroke="currentColor"/>
  </svg>
);
```

- [ ] **Step 2: Commit**

```bash
git add -A && git commit -m "feat(icons): all SVG icons"
```

---

## Task 5: Data files

**Files:**
- Create: `lib/comparison.ts`
- Create: `lib/platforms.ts`

- [ ] **Step 1: `lib/comparison.ts`**

```ts
export type ComparisonRow = { feat: string; studio: string; deck: string };

export const COMPARE_ROWS: ComparisonRow[] = [
  { feat: 'License',                  studio: 'Proprietary',           deck: 'Apache 2.0' },
  { feat: 'Self-hosted runner',       studio: 'Cloud only',            deck: 'Yes, on your box' },
  { feat: 'Flow DSL',                 studio: 'YAML',                  deck: 'YAML — fully compatible' },
  { feat: 'iOS & Android targets',    studio: 'Yes',                   deck: 'Yes' },
  { feat: 'CI integrations',          studio: 'Proprietary plugins',   deck: 'GitHub · GitLab · CircleCI' },
  { feat: 'Flake retries & parallel', studio: 'Paid tier',             deck: 'Built-in' },
  { feat: 'Telemetry',                studio: 'On by default',         deck: 'Off by default' },
  { feat: 'Pricing',                  studio: 'Per-seat subscription', deck: 'Free, forever' },
];
```

- [ ] **Step 2: `lib/platforms.ts`**

```ts
import type { ComponentType } from 'react';
import { AppleGlyph, WindowsGlyph, LinuxGlyph, BrewGlyph } from '@/components/icons';

export type Platform = {
  id: 'mac' | 'win' | 'linux' | 'brew';
  label: string;
  sub: string;
  Icon: ComponentType<{ size?: number; className?: string }>;
  href: string;
};

export const PLATFORMS: Platform[] = [
  { id: 'mac',   label: 'macOS',    sub: 'Universal · .dmg',          Icon: AppleGlyph,   href: '#' },
  { id: 'win',   label: 'Windows',  sub: 'x64 · .exe installer',      Icon: WindowsGlyph, href: '#' },
  { id: 'linux', label: 'Linux',    sub: '.deb · .rpm · AppImage',    Icon: LinuxGlyph,   href: '#' },
  { id: 'brew',  label: 'Homebrew', sub: 'brew install maestrodeck',  Icon: BrewGlyph,    href: '#' },
];

export const INSTALL_CMD = 'curl -fsSL https://get.maestrodeck.dev | sh';
```

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(lib): data files for comparison + platforms"
```

---

## Task 6: InstallBlock (client component)

**Files:**
- Create: `components/InstallBlock.tsx`

- [ ] **Step 1: Write the component**

```tsx
'use client';

import { useState } from 'react';
import { CopyGlyph, CheckGlyph } from '@/components/icons';
import { INSTALL_CMD } from '@/lib/platforms';

export function InstallBlock({ cmd = INSTALL_CMD }: { cmd?: string }) {
  const [copied, setCopied] = useState(false);

  const onCopy = async () => {
    try {
      await navigator.clipboard?.writeText(cmd);
    } catch {
      // silently ignore per spec
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  return (
    <div className="bg-terminal-bg text-[#fafafa] rounded-[10px] px-5 py-[18px] font-mono text-sm flex items-center gap-[14px]">
      <div className="flex gap-1.5">
        <span className="w-2.5 h-2.5 rounded-full bg-[#333]" />
        <span className="w-2.5 h-2.5 rounded-full bg-[#333]" />
        <span className="w-2.5 h-2.5 rounded-full bg-[#333]" />
      </div>
      <span className="text-[#666]">$</span>
      <span className="flex-1 whitespace-nowrap overflow-hidden text-ellipsis">{cmd}</span>
      <button
        type="button"
        onClick={onCopy}
        aria-label="Copy install command"
        className={`bg-transparent border border-[#222] rounded-md px-2.5 py-1.5 text-xs inline-flex items-center gap-1.5 transition-colors cursor-pointer ${
          copied ? 'text-white' : 'text-[#888]'
        }`}
      >
        {copied ? (
          <>
            <CheckGlyph size={12} />
            <span aria-live="polite">Copied</span>
          </>
        ) : (
          <>
            <CopyGlyph size={12} />
            Copy
          </>
        )}
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add -A && git commit -m "feat(install-block): terminal-variant copy button"
```

---

## Task 7: Downloads (pills) + DocsButton

**Files:**
- Create: `components/Downloads.tsx`
- Create: `components/DocsButton.tsx`

- [ ] **Step 1: `components/Downloads.tsx`**

```tsx
import { PLATFORMS } from '@/lib/platforms';

export function Downloads() {
  return (
    <div className="flex flex-wrap gap-2.5">
      {PLATFORMS.map(({ id, label, href, Icon }) => (
        <a
          key={id}
          href={href}
          className="inline-flex items-center gap-2 px-4 py-2.5 border border-ink-2 rounded-full text-ink-2 bg-white text-[13px] font-medium transition-colors hover:bg-ink-2 hover:text-white"
        >
          <Icon size={15} />
          {label}
        </a>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: `components/DocsButton.tsx`**

```tsx
import type { ReactNode } from 'react';
import { BookGlyph, ArrowGlyph } from '@/components/icons';

type Variant = 'primary' | 'outline' | 'ghost';

export function DocsButton({
  variant = 'primary',
  href = '#docs',
  children,
}: {
  variant?: Variant;
  href?: string;
  children: ReactNode;
}) {
  const base =
    'inline-flex items-center gap-2 rounded-lg text-sm font-medium transition-colors';

  if (variant === 'ghost') {
    return (
      <a href={href} className={`${base} py-3 text-ink-2`}>
        <BookGlyph size={15} />
        {children}
        <ArrowGlyph size={13} />
      </a>
    );
  }

  if (variant === 'outline') {
    return (
      <a
        href={href}
        className={`${base} px-5 py-3 border border-ink-2 text-ink-2 bg-white hover:bg-ink-2 hover:text-white`}
      >
        <BookGlyph size={15} />
        {children}
      </a>
    );
  }

  return (
    <a href={href} className={`${base} px-5 py-3 bg-ink-2 text-white hover:bg-black`}>
      <BookGlyph size={15} />
      {children}
    </a>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(components): downloads pills + docs button"
```

---

## Task 8: Nav

**Files:**
- Create: `components/Nav.tsx`

- [ ] **Step 1: Write the component**

```tsx
import { MonogramGlyph, GitHubGlyph } from '@/components/icons';

const LINKS = [
  { href: '#install',  label: './install' },
  { href: '#features', label: './features' },
  { href: '#compare',  label: './vs-studio' },
  { href: '#docs',     label: './docs' },
];

export function Nav() {
  return (
    <nav className="grid grid-cols-[1fr_auto] items-center border-b border-ink-2 font-mono text-[13px] px-6 py-[18px] md:px-8 lg:px-12">
      <div className="flex items-center gap-2.5">
        <MonogramGlyph size={18} className="text-ink-2" />
        <span className="font-semibold">maestro-deck</span>
        <span className="text-text-dim">v0.8.2</span>
      </div>
      <div className="flex items-center gap-5 md:gap-6 lg:gap-7">
        {LINKS.map(({ href, label }) => (
          <a key={href} href={href} className="hidden md:inline text-ink-2">
            {label}
          </a>
        ))}
        <a href="#gh" className="inline-flex items-center gap-1.5 text-ink-2">
          <GitHubGlyph size={13} />
          github
        </a>
      </div>
    </nav>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add -A && git commit -m "feat(nav): top navigation with responsive hide"
```

---

## Task 9: TerminalPane

**Files:**
- Create: `components/TerminalPane.tsx`

- [ ] **Step 1: Write the component**

```tsx
export function TerminalPane() {
  return (
    <div className="bg-terminal-bg text-terminal-text">
      <div className="flex items-center gap-2 px-[18px] py-[14px] border-b border-terminal-border font-mono text-xs text-[#777]">
        <span className="w-2.5 h-2.5 rounded-full bg-terminal-dot" />
        <span className="w-2.5 h-2.5 rounded-full bg-terminal-dot" />
        <span className="w-2.5 h-2.5 rounded-full bg-terminal-dot" />
        <span className="ml-2.5">~/app · maestro-deck test</span>
      </div>
      <div className="max-h-[420px] lg:max-h-none overflow-auto">
        <pre className="m-0 px-[22px] pt-[22px] pb-7 font-mono text-[13px] leading-[1.7] whitespace-pre">
<span className="text-terminal-dim">{'$ '}</span><span className="text-terminal-text">maestro-deck test flows/checkout.yaml</span>{'\n'}
<span className="text-terminal-dim">{'  '}</span>Starting Deck runner v0.8.2 · iPhone 15 Pro (17.4){'\n'}
<span className="text-terminal-dim">{'  '}</span><span className="text-terminal-success">✓</span> launchApp com.acme.shop{'\n'}
<span className="text-terminal-dim">{'  '}</span><span className="text-terminal-success">✓</span> tapOn "Sign in"{'\n'}
<span className="text-terminal-dim">{'  '}</span><span className="text-terminal-success">✓</span> inputText "admin@acme.dev"{'\n'}
<span className="text-terminal-dim">{'  '}</span><span className="text-terminal-success">✓</span> tapOn id:cart-button{'\n'}
<span className="text-terminal-dim">{'  '}</span><span className="text-terminal-success">✓</span> assertVisible "Order placed"{'\n'}
<span className="text-terminal-dim">{'\n  '}</span>12 steps · 4.1s · 0 flakes{'\n'}
<span className="text-terminal-dim">{'  '}</span>report → ./deck-report/2026-04-23.html{'\n'}
<span className="text-terminal-dim">{'\n$ '}</span><span className="text-terminal-text">_</span>
        </pre>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add -A && git commit -m "feat(terminal): static test-run pane"
```

---

## Task 10: Hero

**Files:**
- Create: `components/Hero.tsx`

- [ ] **Step 1: Write the component**

```tsx
import { InstallBlock } from '@/components/InstallBlock';
import { Downloads } from '@/components/Downloads';
import { DocsButton } from '@/components/DocsButton';
import { TerminalPane } from '@/components/TerminalPane';

export function Hero() {
  return (
    <section className="grid grid-cols-1 lg:grid-cols-[1.1fr_1fr] border-b border-ink-2">
      <div className="px-6 pt-10 pb-8 md:px-8 md:pt-12 md:pb-10 lg:px-12 lg:pt-16 lg:pb-14 lg:border-r lg:border-ink-2">
        <div className="font-mono text-xs text-text-quiet mb-7 tracking-[.04em]">
          {'// open-source · apache 2.0 · drop-in for maestro studio'}
        </div>
        <h1 className="font-sans font-medium text-[40px] md:text-[52px] lg:text-[64px] tracking-tight-h1 leading-[1.05] lg:leading-[1.02] m-0">
          Mobile E2E,<br />
          <span className="font-mono font-normal text-[34px] md:text-[44px] lg:text-[54px]">{'>_'}</span>{' '}
          on your terms.
        </h1>
        <p className="text-base text-ink-soft mt-6 max-w-[440px] leading-[1.55]">
          The open-source runner for the Maestro YAML format. Same flows you already wrote — run them on hardware you already own.
        </p>

        <div id="install" className="mt-10 max-w-full lg:max-w-[520px]">
          <div className="font-mono text-[11px] text-text-dim mb-2 uppercase tracking-wide-eyebrow">
            One-liner install
          </div>
          <InstallBlock />
        </div>

        <div className="mt-8 max-w-full lg:max-w-[520px]">
          <div className="font-mono text-[11px] text-text-dim mb-3 uppercase tracking-wide-eyebrow">
            Or grab a binary
          </div>
          <Downloads />
        </div>

        <div className="mt-8 flex flex-wrap gap-3">
          <DocsButton variant="primary">Read the docs</DocsButton>
          <DocsButton variant="outline">./quickstart</DocsButton>
        </div>
      </div>

      <TerminalPane />
    </section>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add -A && git commit -m "feat(hero): two-column hero with install + terminal"
```

---

## Task 11: Features

**Files:**
- Create: `components/Features.tsx`

- [ ] **Step 1: Write the component**

```tsx
const FEATURES: Array<[string, string, string]> = [
  ['001', 'YAML flows',    'Plain-text, diffable, reviewable. Same syntax your team already knows.'],
  ['002', 'Self-hosted',   'Daemon runs on your CI node. Nothing phones home.'],
  ['003', 'iOS & Android', 'Simulators, emulators, physical devices — one CLI.'],
  ['004', 'CI-native',     'GitHub Actions, GitLab CI, CircleCI, Buildkite templates included.'],
];

export function Features() {
  return (
    <section id="features" className="border-b border-ink-2">
      <div className="px-6 py-4 md:px-8 lg:px-12 border-b border-ink-2 font-mono text-xs text-text-quiet uppercase tracking-wide-section">
        § Features
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4">
        {FEATURES.map(([num, title, body], i) => (
          <div
            key={num}
            className={[
              'px-6 py-8 md:px-6 md:py-8 lg:px-6 lg:pt-8 lg:pb-9',
              // vertical dividers on lg: right border except last
              i < 3 ? 'lg:border-r lg:border-ink-2' : '',
              // md 2x2 grid: right border on left column cells
              i % 2 === 0 ? 'md:border-r md:border-ink-2 lg:border-r' : '',
              // bottom divider for mobile + md top row
              i < FEATURES.length - 1 ? 'border-b border-ink-2 md:border-b lg:border-b-0' : '',
              i < 2 ? 'md:border-b md:border-ink-2 lg:border-b-0' : 'md:border-b-0',
            ].join(' ')}
          >
            <div className="font-mono text-[11px] text-text-dim mb-7">{num}</div>
            <div className="text-lg font-semibold mb-2.5 tracking-[-0.01em]">{title}</div>
            <div className="text-[13px] text-text-muted leading-[1.55]">{body}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add -A && git commit -m "feat(features): four-column feature grid"
```

---

## Task 12: Comparison

**Files:**
- Create: `components/Comparison.tsx`

- [ ] **Step 1: Write the component**

```tsx
import { COMPARE_ROWS } from '@/lib/comparison';
import { CheckGlyph } from '@/components/icons';

export function Comparison() {
  return (
    <section id="compare" className="border-b border-ink-2">
      <div className="px-6 py-4 md:px-8 lg:px-12 border-b border-ink-2 font-mono text-xs text-text-quiet uppercase tracking-wide-section">
        § Deck vs Studio
      </div>
      <div className="px-4 py-6 md:px-6 md:py-8 lg:px-12 lg:pt-10 lg:pb-14 overflow-x-auto">
        <table className="w-full border-collapse text-sm min-w-[640px]">
          <thead>
            <tr className="font-mono text-[11px] text-text-dim uppercase tracking-wide-eyebrow">
              <th className="text-left py-3 pr-4 border-b border-ink-2 w-[32%] font-normal">Capability</th>
              <th className="text-left py-3 px-4 border-b border-ink-2 font-normal">Studio (SaaS)</th>
              <th className="text-left py-3 px-4 border-b border-ink-2 font-normal bg-surface">Deck (OSS)</th>
            </tr>
          </thead>
          <tbody>
            {COMPARE_ROWS.map((r) => (
              <tr key={r.feat}>
                <td className="py-4 pr-4 border-b border-border-subtle text-ink-muted">{r.feat}</td>
                <td className="py-4 px-4 border-b border-border-subtle text-text-meta">{r.studio}</td>
                <td className="py-4 px-4 border-b border-border-subtle bg-surface text-ink-2 font-medium">
                  <span className="inline-flex items-center gap-2">
                    <CheckGlyph size={12} />
                    {r.deck}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add -A && git commit -m "feat(comparison): deck vs studio table"
```

---

## Task 13: DocsTeaser

**Files:**
- Create: `components/DocsTeaser.tsx`

- [ ] **Step 1: Write the component**

```tsx
import { DocsButton } from '@/components/DocsButton';
import { ArrowGlyph } from '@/components/icons';

const POPULAR = [
  'Getting started → installing the runner',
  'Writing your first flow',
  'Running on physical iOS devices',
  'CI recipe · GitHub Actions',
  'Migrating from Maestro Studio',
  'Parallel execution & retries',
];

export function DocsTeaser() {
  return (
    <section id="docs" className="grid grid-cols-1 lg:grid-cols-2 border-b border-ink-2">
      <div className="px-6 py-10 md:px-8 md:py-12 lg:px-12 lg:py-14 lg:border-r lg:border-ink-2">
        <div className="font-mono text-xs text-text-quiet mb-5 uppercase tracking-wide-eyebrow">
          § Docs
        </div>
        <h2 className="text-[28px] md:text-[32px] lg:text-[36px] font-medium m-0 tracking-tight-h2 leading-[1.1]">
          Everything you need,<br />indexed and searchable.
        </h2>
        <p className="text-[15px] text-text-muted mt-4 max-w-[440px]">
          Reference for every command. Recipes for common flows. Migration guide from Maestro Studio in 12 minutes.
        </p>
        <div className="mt-7 flex flex-wrap gap-3">
          <DocsButton variant="primary">Read the docs</DocsButton>
          <DocsButton variant="outline">Migration guide</DocsButton>
        </div>
      </div>
      <div className="px-6 py-10 md:px-8 md:py-12 lg:px-12 lg:py-14 bg-surface font-mono text-[13px]">
        <div className="text-text-dim mb-3.5 text-[11px] uppercase tracking-wide-eyebrow">Popular</div>
        {POPULAR.map((title, i) => (
          <a
            key={title}
            href="#"
            className={`flex justify-between items-center py-3 border-b border-border-alt text-ink-2 ${
              i === 0 ? 'border-t' : ''
            }`}
          >
            <span>{title}</span>
            <ArrowGlyph size={13} />
          </a>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add -A && git commit -m "feat(docs-teaser): two-pane docs promo"
```

---

## Task 14: Footer

**Files:**
- Create: `components/Footer.tsx`

- [ ] **Step 1: Write the component**

```tsx
const FOOTER_LINKS = [
  { href: '#', label: 'github' },
  { href: '#', label: 'discord' },
  { href: '#', label: 'changelog' },
  { href: '#', label: 'security' },
];

export function Footer() {
  return (
    <footer className="px-6 py-5 md:px-8 lg:px-12 flex flex-wrap justify-between gap-3 font-mono text-xs text-text-meta">
      <div>maestro-deck · apache 2.0 · © 2026 contributors</div>
      <div className="flex gap-5">
        {FOOTER_LINKS.map(({ href, label }) => (
          <a key={label} href={href}>{label}</a>
        ))}
      </div>
    </footer>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add -A && git commit -m "feat(footer): mono footer strip"
```

---

## Task 15: Compose the page

**Files:**
- Create: `app/page.tsx`

- [ ] **Step 1: Write the page**

```tsx
import { Nav } from '@/components/Nav';
import { Hero } from '@/components/Hero';
import { Features } from '@/components/Features';
import { Comparison } from '@/components/Comparison';
import { DocsTeaser } from '@/components/DocsTeaser';
import { Footer } from '@/components/Footer';

export default function Page() {
  return (
    <main className="mx-auto w-full lg:max-w-page lg:border-x lg:border-ink-2 bg-white text-ink">
      <Nav />
      <Hero />
      <Features />
      <Comparison />
      <DocsTeaser />
      <Footer />
    </main>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add -A && git commit -m "feat(page): compose landing sections"
```

---

## Task 16: Build + visual verification

**Files:** (none — verification only)

- [ ] **Step 1: Typecheck**

```bash
cd /Users/ethanmorisset/maestro-deck-landing && pnpm typecheck
```

Expected: no errors.

- [ ] **Step 2: Build**

```bash
cd /Users/ethanmorisset/maestro-deck-landing && pnpm build
```

Expected: build succeeds, one static route `/` emitted.

- [ ] **Step 3: Dev server — visual check**

```bash
cd /Users/ethanmorisset/maestro-deck-landing && pnpm dev
```

Open `http://localhost:3000` at 1280px width. Compare against `/Users/ethanmorisset/Downloads/design_handoff_maestro_deck/preview.html` (Direction B section). Check:
- Nav: monogram + wordmark + version on left, 4 path-style links + github on right.
- Hero left: eyebrow, H1 with mono `>_`, sub, install block (dark), pills, 2 CTAs.
- Hero right: terminal with 5 green ✓ lines.
- Features: 4-col grid, `001`–`004`, 1px vertical dividers.
- Comparison: table, Deck column shaded, check icons.
- Docs teaser: two panes, right with 6 mono links.
- Footer: mono strip.

Then resize to 768px and 375px — verify responsive strategy applies (1-col hero, 2-col features, footer wrapping, table scroll).

- [ ] **Step 4: Fix any visual discrepancies found**

If anything is off, correct in the relevant component file and re-verify. Report what was adjusted.

- [ ] **Step 5: Final commit if any fixes**

```bash
git add -A && git commit -m "fix(visual): post-verification adjustments"
```

---

## Self-Review Checklist (run before handoff)

- [ ] Every spec section (Nav, Hero, TerminalPane, Features, Comparison, DocsTeaser, Footer) has a task.
- [ ] All 11 icons from the handoff exist in `components/icons/index.tsx`.
- [ ] Both data sources (COMPARE_ROWS × 8, PLATFORMS × 4) are exported from `lib/`.
- [ ] InstallBlock is the only `'use client'` component.
- [ ] Tailwind tokens cover every color in the spec's Design Tokens table.
- [ ] No task references an undefined symbol or file.
- [ ] Responsive behavior for each section matches the spec's responsive table.
