import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/globals.css";

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
    <App />
  </React.StrictMode>,
);

// React schedules the first commit on the next microtask; wait for the paint
// that follows before fading the splash.
requestAnimationFrame(() => requestAnimationFrame(hideSplash));
