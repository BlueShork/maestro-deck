// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import App from "./App";
import "./styles/globals.css";

// Native context menu = "Inspect Element" entrypoint in WKWebView. Block it
// globally; our own InspectActionMenu (DeviceView) calls preventDefault
// upstream so it still wins on the device canvas in inspect mode.
window.addEventListener("contextmenu", (e) => {
  if (!e.defaultPrevented) e.preventDefault();
});

// Block the dev-tools keyboard shortcuts in production. In dev builds the
// Tauri CLI keeps devtools available regardless of these handlers.
window.addEventListener("keydown", (e) => {
  const key = e.key.toLowerCase();
  if (e.key === "F12") {
    e.preventDefault();
    return;
  }
  if ((e.metaKey || e.ctrlKey) && e.altKey && (key === "i" || key === "j")) {
    e.preventDefault();
  }
});

// Keep the splash visible at least this long so the pulse animation has time
// to breathe even on fast machines where React mounts in a few ms.
const SPLASH_MIN_MS = 450;
const mountedAt = performance.now();

function hideSplash() {
  const el = document.getElementById("splash");
  if (!el) return;
  const waited = performance.now() - mountedAt;
  const remaining = Math.max(0, SPLASH_MIN_MS - waited);
  setTimeout(() => {
    el.classList.add("fade-out");
    // Remove from DOM after the CSS transition ends (320ms) so it doesn't
    // intercept pointer events or inflate memory.
    el.addEventListener("transitionend", () => el.remove(), { once: true });
  }, remaining);
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>,
);

// React schedules the first commit on the next microtask; wait for the paint
// that follows before fading the splash.
requestAnimationFrame(() => requestAnimationFrame(hideSplash));
