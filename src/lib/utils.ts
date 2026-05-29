// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Extract the `url:` value from a Maestro flow's YAML front-matter header. */
export function flowUrl(yaml: string): string | undefined {
  const m = yaml.match(/^\s*url:\s*["']?([^"'\n]+)["']?\s*$/m);
  return m?.[1]?.trim();
}
