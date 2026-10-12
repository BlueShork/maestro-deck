// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

export type DiffOp = "same" | "add" | "del";

export interface DiffLine {
  op: DiffOp;
  /** 1-based line in the old text, null for an added line. */
  oldNo: number | null;
  /** 1-based line in the new text, null for a removed line. */
  newNo: number | null;
  text: string;
}

/**
 * Line diff for human-sized YAML flows. Lines shared at both ends are matched
 * up front, so the LCS table only covers the region that actually changed —
 * a one-line edit in a long flow costs next to nothing.
 */
export function lineDiff(a: string[], b: string[]): DiffLine[] {
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    a[a.length - 1 - tail] === b[b.length - 1 - tail]
  ) {
    tail++;
  }

  const out: DiffLine[] = [];
  for (let k = 0; k < head; k++) out.push({ op: "same", oldNo: k + 1, newNo: k + 1, text: a[k] });

  const midA = a.slice(head, a.length - tail);
  const midB = b.slice(head, b.length - tail);
  const n = midA.length;
  const m = midB.length;
  // dp[i * (m + 1) + j] = LCS length of midA[i..] and midB[j..]
  const dp = new Uint32Array((n + 1) * (m + 1));
  const at = (i: number, j: number) => i * (m + 1) + j;
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[at(i, j)] =
        midA[i] === midB[j]
          ? dp[at(i + 1, j + 1)] + 1
          : Math.max(dp[at(i + 1, j)], dp[at(i, j + 1)]);
    }
  }
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (midA[i] === midB[j]) {
      out.push({ op: "same", oldNo: head + i + 1, newNo: head + j + 1, text: midA[i] });
      i++;
      j++;
    } else if (dp[at(i + 1, j)] >= dp[at(i, j + 1)]) {
      out.push({ op: "del", oldNo: head + i + 1, newNo: null, text: midA[i] });
      i++;
    } else {
      out.push({ op: "add", oldNo: null, newNo: head + j + 1, text: midB[j] });
      j++;
    }
  }
  for (; i < n; i++) out.push({ op: "del", oldNo: head + i + 1, newNo: null, text: midA[i] });
  for (; j < m; j++) out.push({ op: "add", oldNo: null, newNo: head + j + 1, text: midB[j] });

  for (let k = 0; k < tail; k++) {
    out.push({
      op: "same",
      oldNo: a.length - tail + k + 1,
      newNo: b.length - tail + k + 1,
      text: a[a.length - tail + k],
    });
  }
  return out;
}
