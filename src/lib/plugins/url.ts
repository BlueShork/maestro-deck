// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

/** URL of a file inside an installed plugin, served by the Rust `mdplugin`
 *  scheme. Windows' WebView2 exposes custom schemes as `http://<scheme>.localhost`. */
export function pluginUrl(id: string, path: string, userAgent = navigator.userAgent): string {
  const base = /Windows/.test(userAgent) ? "http://mdplugin.localhost" : "mdplugin://localhost";
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  return `${base}/${encodeURIComponent(id)}/${encoded}`;
}
