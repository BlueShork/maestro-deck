// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

/**
 * Re-express a piecewise-linear animation over `points` (sorted, possibly
 * outside [0, 1]; the value holds before the first point and after the last)
 * as keyframes whose offsets all sit in [0, 1], sampling the real value at the
 * two edges. Unlike clamping the offsets alone, the curve over [0, 1] is
 * unchanged — an entry that finishes before the scroll starts still shows its
 * end state at 0.
 */
export function toUnitKeyframes(
  points: number[],
  values: number[],
): { offsets: number[]; values: number[] } {
  const at = (t: number): number => {
    if (t <= points[0]) return values[0];
    for (let i = 1; i < points.length; i++) {
      if (t <= points[i]) {
        const span = points[i] - points[i - 1];
        if (span <= 0) return values[i];
        const k = (t - points[i - 1]) / span;
        return values[i - 1] + (values[i] - values[i - 1]) * k;
      }
    }
    return values[values.length - 1];
  };
  const offsets = [0];
  const out = [at(0)];
  points.forEach((p, i) => {
    if (p > 0 && p < 1) {
      offsets.push(p);
      out.push(values[i]);
    }
  });
  offsets.push(1);
  out.push(at(1));
  return { offsets, values: out };
}
