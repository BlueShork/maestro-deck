// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

export type ComparisonStatus = "seeded" | "match" | "changed" | "missing" | "dimension_mismatch";

export interface Comparison {
  name: string;
  /** Flow file stem (Run All comparisons only). */
  flow?: string;
  status: ComparisonStatus;
  changed_ratio: number;
  bbox: [number, number, number, number] | null;
  bank_b64?: string;
  new_b64?: string;
  diff_b64?: string;
}

export interface RunReport {
  run_id: string;
  device_key: string;
  comparisons: Comparison[];
  /** Per-flow comparison failures (Run All only; absent when clean). */
  flow_errors?: string[];
}

export interface BankImage {
  name: string;
  width: number;
  height: number;
  size_bytes: number;
  modified_ms: number;
}

export interface BankGroup {
  device_key: string;
  images: BankImage[];
}
