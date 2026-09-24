// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

/**
 * Clamp a scroll range into [0, 1] and make it non-decreasing. On WebKit with
 * ScrollTimeline support, motion hands useTransform's input range to WAAPI as
 * keyframe offsets, which throw a TypeError when out of range or unsorted —
 * and that error unmounts the whole app.
 */
export function toKeyframeOffsets(range: number[]): number[] {
  let floor = 0;
  return range.map((v) => {
    floor = Math.max(floor, Math.min(1, v));
    return floor;
  });
}
