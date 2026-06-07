// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Extract the `url:` value from a Maestro flow's YAML front-matter header. */
export function flowUrl(yaml: string): string | undefined {
  // Capture the rest of the `url:` line, then strip surrounding quotes/space in
  // code. Unambiguous (only `[ \t]` around the literal, `.*` can't cross lines),
  // so there is no super-linear backtracking — unlike a single class that both
  // matches the value and overlaps a trailing whitespace quantifier.
  const m = /^[ \t]*url:[ \t]*(.*)$/m.exec(yaml);
  if (!m) return undefined;
  return (
    m[1]
      .trim()
      .replace(/^["']|["']$/g, "")
      .trim() || undefined
  );
}
