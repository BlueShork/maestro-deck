import { describe, expect, it } from "vitest";

import { toKeyframeOffsets } from "./keyframeOffsets";

describe("toKeyframeOffsets", () => {
  it("clamps into [0, 1] and never decreases", () => {
    expect(toKeyframeOffsets([0, -0.6, -0.1, -0.1, 0.9, 1])).toEqual([0, 0, 0, 0, 0.9, 1]);
    expect(toKeyframeOffsets([0, 0.2, 0.5, 0.5, 1.4, 1])).toEqual([0, 0.2, 0.5, 0.5, 1, 1]);
  });

  it("leaves a valid range untouched", () => {
    expect(toKeyframeOffsets([0, 0.1, 0.3, 0.3, 0.7, 1])).toEqual([0, 0.1, 0.3, 0.3, 0.7, 1]);
  });
});
