// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

/** Routes that replace the workspace. `App` keeps `MainView` mounted and only
 *  hides it on these, so a page missing from the list renders below the
 *  full-height workspace, off screen. */
const FULL_PAGES = ["/settings", "/image-bank", "/account", "/plugins"];

export function isFullPage(pathname: string): boolean {
  return FULL_PAGES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
