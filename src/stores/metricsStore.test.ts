// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { describe, it, expect, beforeEach } from "vitest";
import { useMetricsStore, type Sample } from "./metricsStore";

const mkSample = (ts: number): Sample => ({
  ts,
  cpuPct: 0,
  memMb: 0,
  fps: null,
  jankPct: null,
  frameP50: null,
  frameP90: null,
  frameP95: null,
  frameP99: null,
  thermalStatus: null,
  netRxKbps: 0,
  netTxKbps: 0,
});

const sample = (over: Partial<Sample> = {}): Sample => ({
  ts: 1,
  cpuPct: 10,
  memMb: 100,
  fps: null,
  jankPct: null,
  frameP50: null,
  frameP90: null,
  frameP95: null,
  frameP99: null,
  thermalStatus: null,
  netRxKbps: 0,
  netTxKbps: 0,
  ...over,
});

beforeEach(() => {
  useMetricsStore.getState().reset();
});

describe("metricsStore.togglePanel / setPanelOpen", () => {
  it("toggle flips panelOpen", () => {
    const { togglePanel } = useMetricsStore.getState();
    togglePanel();
    expect(useMetricsStore.getState().panelOpen).toBe(true);
    togglePanel();
    expect(useMetricsStore.getState().panelOpen).toBe(false);
  });

  it("setPanelOpen sets the value explicitly", () => {
    useMetricsStore.getState().setPanelOpen(true);
    expect(useMetricsStore.getState().panelOpen).toBe(true);
    useMetricsStore.getState().setPanelOpen(false);
    expect(useMetricsStore.getState().panelOpen).toBe(false);
  });
});

describe("metricsStore.appendSample", () => {
  it("appends samples in order", () => {
    const { appendSample } = useMetricsStore.getState();
    appendSample(mkSample(1));
    appendSample(mkSample(2));
    expect(useMetricsStore.getState().samples.map((s) => s.ts)).toEqual([1, 2]);
  });

  it("caps the buffer at 60 samples (FIFO)", () => {
    const { appendSample } = useMetricsStore.getState();
    for (let i = 0; i < 65; i++) appendSample(mkSample(i));
    const samples = useMetricsStore.getState().samples;
    expect(samples).toHaveLength(60);
    expect(samples[0].ts).toBe(5);
    expect(samples[59].ts).toBe(64);
  });
});

describe("metricsStore.onTargetChanged", () => {
  it("updates package and clears samples + stoppedReason", () => {
    const { appendSample, setStoppedReason, onTargetChanged } = useMetricsStore.getState();
    appendSample(mkSample(1));
    setStoppedReason("crash");
    onTargetChanged("com.example");
    const s = useMetricsStore.getState();
    expect(s.currentPackage).toBe("com.example");
    expect(s.samples).toEqual([]);
    expect(s.stoppedReason).toBeNull();
  });
});

describe("metricsStore.reset", () => {
  it("returns store to initial values", () => {
    const s0 = useMetricsStore.getState();
    s0.setPanelOpen(true);
    s0.appendSample(mkSample(1));
    s0.onTargetChanged("com.x");
    s0.setStoppedReason("oom");
    s0.reset();
    const s = useMetricsStore.getState();
    expect(s.panelOpen).toBe(false);
    expect(s.currentPackage).toBeNull();
    expect(s.samples).toEqual([]);
    expect(s.stoppedReason).toBeNull();
  });
});

describe("metricsStore", () => {
  it("keeps appended samples", () => {
    useMetricsStore.getState().appendSample(sample({ cpuPct: 42 }));
    const s = useMetricsStore.getState().samples;
    expect(s).toHaveLength(1);
    expect(s[0].cpuPct).toBe(42);
  });

  it("caps history at 60 samples", () => {
    for (let i = 0; i < 70; i++) useMetricsStore.getState().appendSample(sample({ ts: i }));
    expect(useMetricsStore.getState().samples).toHaveLength(60);
    expect(useMetricsStore.getState().samples[0].ts).toBe(10);
  });
});
