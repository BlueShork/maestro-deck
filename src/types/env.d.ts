// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

interface ImportMetaEnv {
  readonly DEV: boolean;
  readonly PROD: boolean;
  readonly MODE: string;
}

/** Minimal slice of Vite's HMR API — only what modules owning singletons need
 *  to opt out of hot patching. Absent in production builds. */
interface ImportMetaHot {
  accept(cb?: (mod: unknown) => void): void;
  invalidate(): void;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
  readonly hot?: ImportMetaHot;
}

// Vite's `?raw` suffix returns the file contents as a plain string.
declare module "*.md?raw" {
  const content: string;
  export default content;
}

declare const __APP_VERSION__: string;
