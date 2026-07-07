// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

export type MetricCardId = "cpu" | "ram" | "fps" | "jank" | "frameTimes" | "thermal";

export type DevicePlatform = "android" | "ios" | "web";

export type MetricsLayout =
  | { kind: "cards"; cards: MetricCardId[]; note?: string }
  | { kind: "limited"; message: string };

/** Which metric cards a device can provide, or a "limited support" message. */
export function metricsForDevice(platform: DevicePlatform, physical: boolean): MetricsLayout {
  if (platform === "android") {
    return { kind: "cards", cards: ["cpu", "ram", "fps", "jank", "frameTimes", "thermal"] };
  }
  if (platform === "ios" && !physical) {
    return {
      kind: "cards",
      cards: ["cpu", "ram"],
      note: "FPS and frame timing aren't available on the iOS simulator.",
    };
  }
  if (platform === "ios" && physical) {
    return {
      kind: "limited",
      message:
        "Per-app performance metrics aren't available on physical iPhones — they require Instruments.",
    };
  }
  return { kind: "limited", message: "The Web target has no per-app performance metrics." };
}

const THERMAL_LABELS: Record<number, string> = {
  0: "None",
  1: "Light",
  2: "Moderate",
  3: "Severe",
  4: "Critical",
  5: "Emergency",
  6: "Shutdown",
};

/** Map an Android THERMAL_STATUS_* code to a label. */
export function thermalLabel(code: number | null): string {
  if (code == null) return "—";
  return THERMAL_LABELS[code] ?? "Unknown";
}
