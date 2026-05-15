// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

interface ImportMetaEnv {
  readonly DEV: boolean;
  readonly PROD: boolean;
  readonly MODE: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Vite's `?raw` suffix returns the file contents as a plain string.
declare module "*.md?raw" {
  const content: string;
  export default content;
}

declare const __APP_VERSION__: string;
