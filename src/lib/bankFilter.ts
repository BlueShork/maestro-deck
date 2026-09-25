// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import type { BankGroup, BankImage } from "@/types/visualRegression";

/** Case-insensitive substring match; a blank query matches everything. */
export function matchesQuery(text: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return text.toLowerCase().includes(q);
}

export function filterImages(images: BankImage[], query: string): BankImage[] {
  if (!query.trim()) return images;
  return images.filter((i) => matchesQuery(i.name, query));
}

/** A group stays visible when its key (underscores read as spaces) or at
 *  least one of its screenshots matches. */
export function filterGroups(groups: BankGroup[], query: string): BankGroup[] {
  if (!query.trim()) return groups;
  return groups.filter(
    (g) =>
      matchesQuery(g.device_key, query) ||
      matchesQuery(g.device_key.replace(/_/g, " "), query) ||
      g.images.some((i) => matchesQuery(i.name, query)),
  );
}
