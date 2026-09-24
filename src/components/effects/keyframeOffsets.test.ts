import { describe, expect, it } from "vitest";

import { toUnitKeyframes } from "./keyframeOffsets";

describe("toUnitKeyframes", () => {
  it("keeps an in-range animation as is, framed by holds at 0 and 1", () => {
    expect(toUnitKeyframes([0.1, 0.3, 0.3, 0.7], [0.5, 1, 1, 0.5])).toEqual({
      offsets: [0, 0.1, 0.3, 0.3, 0.7, 1],
      values: [0.5, 0.5, 1, 1, 0.5, 0.5],
    });
  });

  // Regression: clamping the offsets alone (toKeyframeOffsets) piled the
  // entry keyframes up at 0, so the first row started half-size and faded
  // instead of fully shown.
  it("samples the real value at 0 when the entry happens before the scroll starts", () => {
    const { offsets, values } = toUnitKeyframes([-0.667, -0.167, -0.167, 1.333], [0.5, 1, 1, 0.5]);
    expect(offsets[0]).toBe(0);
    expect(offsets[offsets.length - 1]).toBe(1);
    expect(values[0]).toBeCloseTo(1 - (0.167 / 1.5) * 0.5, 3);
    expect(values[values.length - 1]).toBeCloseTo(1 - (1.167 / 1.5) * 0.5, 3);
    // Every offset is a valid, sorted WAAPI keyframe offset.
    expect(offsets.every((o, i) => o >= 0 && o <= 1 && (i === 0 || o >= offsets[i - 1]))).toBe(
      true,
    );
  });

  it("holds the edge values when the whole animation is out of range", () => {
    expect(toUnitKeyframes([-2, -1], [3, 7])).toEqual({ offsets: [0, 1], values: [7, 7] });
    expect(toUnitKeyframes([2, 3], [3, 7])).toEqual({ offsets: [0, 1], values: [3, 3] });
  });
});
