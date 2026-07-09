// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { type CSSProperties, useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/Button";
import { TOUR_STEPS } from "@/lib/tourSteps";
import { usePanelsStore } from "@/stores/panelsStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useTourStore } from "@/stores/tourStore";

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

/**
 * First-launch spotlight tour. Rendered at the App level so it survives route
 * changes. For the active step it opens the required panels, measures the
 * target `[data-tour]` element, dims the viewport except a cut-out around it,
 * and shows an explanatory bubble. Non-blocking: Next and Skip are always
 * available and no user action is ever required. Falls back to a centered
 * bubble when the target can't be measured (panel hidden, or SSR/test env).
 *
 * We read store state via getState() (not the hook) so that the node-env
 * renderToStaticMarkup tests can drive the component by calling setState()
 * and observe the correct output. The component subscribes to store changes
 * via its own useState/useEffect so the UI still re-renders in production.
 */
export function TourOverlay() {
  // Read current store state directly so that SSR / test environments see
  // whatever setState() has set, not the store's frozen initial snapshot.
  const [tourState, setTourState] = useState(() => useTourStore.getState());
  const [settingsState, setSettingsState] = useState(() => useSettingsStore.getState());

  useEffect(() => {
    // Subscribe to store changes for live updates in the browser.
    const unsubTour = useTourStore.subscribe(setTourState);
    const unsubSettings = useSettingsStore.subscribe(setSettingsState);
    return () => {
      unsubTour();
      unsubSettings();
    };
  }, []);

  const { isActive, stepIndex, next, prev, skip } = tourState;
  const { inspectKey } = settingsState;

  const step = isActive ? TOUR_STEPS[stepIndex] : undefined;
  const [rect, setRect] = useState<Rect | null>(null);

  // Open required panels, then measure the target — re-measuring on resize and
  // when the target element itself changes size (panel drag).
  useEffect(() => {
    if (!step) {
      setRect(null);
      return;
    }
    for (const id of step.requiresPanel) usePanelsStore.getState().show(id);

    let raf = 0;
    const measure = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const el = document.querySelector(`[data-tour="${step.target}"]`);
        if (!el) {
          setRect(null);
          return;
        }
        const r = el.getBoundingClientRect();
        setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
      });
    };
    measure();
    window.addEventListener("resize", measure);
    const el = document.querySelector(`[data-tour="${step.target}"]`);
    const ro = el ? new ResizeObserver(measure) : null;
    if (el && ro) ro.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", measure);
      ro?.disconnect();
    };
  }, [step]);

  const onKey = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") skip();
    },
    [skip],
  );
  useEffect(() => {
    if (!isActive) return;
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isActive, onKey]);

  if (!step) return null;

  const isFirst = stepIndex === 0;
  const isLast = stepIndex === TOUR_STEPS.length - 1;
  const body = step.body.replace("{inspectKey}", inspectKey);

  const PAD = 6;
  const ring = rect
    ? {
        top: rect.top - PAD,
        left: rect.left - PAD,
        width: rect.width + PAD * 2,
        height: rect.height + PAD * 2,
      }
    : null;

  // Bubble position: below/right of the ring when there's room, else centered.
  const bubbleStyle: CSSProperties = ring
    ? {
        top: Math.min(ring.top + ring.height + 12, window.innerHeight - 220),
        left: Math.min(Math.max(12, ring.left), window.innerWidth - 372),
      }
    : { top: "50%", left: "50%", transform: "translate(-50%, -50%)" };

  return (
    <div className="fixed inset-0 z-[100]">
      {/* Dim layer. When we have a ring, a box-shadow "punches" the spotlight
          hole; otherwise a flat dim covers everything. */}
      {ring ? (
        <div
          className="pointer-events-auto absolute rounded-lg ring-2 ring-primary transition-all"
          style={{
            top: ring.top,
            left: ring.left,
            width: ring.width,
            height: ring.height,
            boxShadow: "0 0 0 9999px rgba(0,0,0,0.6)",
          }}
        />
      ) : (
        <div className="pointer-events-auto absolute inset-0 bg-black/60" />
      )}

      <div
        className="pointer-events-auto absolute w-[360px] rounded-lg border border-border bg-background p-4 shadow-xl"
        style={bubbleStyle}
      >
        <div className="mb-1 text-xs font-medium text-muted-foreground">
          {stepIndex + 1} / {TOUR_STEPS.length}
        </div>
        <h3 className="mb-1.5 text-sm font-semibold text-foreground">{step.title}</h3>
        <p className="mb-4 text-sm leading-relaxed text-muted-foreground">{body}</p>
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={skip}
            className="text-xs text-muted-foreground underline-offset-2 hover:underline"
          >
            Skip tour
          </button>
          <div className="flex items-center gap-2">
            {!isFirst && (
              <Button size="sm" variant="ghost" onClick={prev}>
                Back
              </Button>
            )}
            <Button size="sm" variant="default" onClick={next}>
              {isLast ? "Finish" : "Next"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
