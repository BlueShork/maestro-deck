import { describe, expect, it } from "vitest";

import { lineDiff, type DiffLine } from "./lineDiff";

const oldSide = (d: DiffLine[]) => d.filter((l) => l.op !== "add").map((l) => l.text);
const newSide = (d: DiffLine[]) => d.filter((l) => l.op !== "del").map((l) => l.text);
const ops = (d: DiffLine[]) =>
  d.map((l) => `${l.op === "same" ? " " : l.op === "add" ? "+" : "-"}${l.text}`);

/** Reference LCS length, straightforward recursion with memo. */
function lcs(a: string[], b: string[]): number {
  const memo = new Map<string, number>();
  const go = (i: number, j: number): number => {
    if (i === a.length || j === b.length) return 0;
    const k = `${i},${j}`;
    const hit = memo.get(k);
    if (hit !== undefined) return hit;
    const v = a[i] === b[j] ? 1 + go(i + 1, j + 1) : Math.max(go(i + 1, j), go(i, j + 1));
    memo.set(k, v);
    return v;
  };
  return go(0, 0);
}

function rng(seed: number) {
  return () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
}

describe("lineDiff", () => {
  it("identical texts are all unchanged lines", () => {
    const d = lineDiff(["a", "b"], ["a", "b"]);
    expect(ops(d)).toEqual([" a", " b"]);
    expect(d.map((l) => [l.oldNo, l.newNo])).toEqual([
      [1, 1],
      [2, 2],
    ]);
  });

  it("a one-line change in the middle", () => {
    const d = lineDiff(
      ["appId: x", "---", "- tapOn: A", "- back"],
      ["appId: x", "---", "- tapOn: B", "- back"],
    );
    expect(ops(d)).toEqual([" appId: x", " ---", "-- tapOn: A", "+- tapOn: B", " - back"]);
    expect(d[2]).toMatchObject({ oldNo: 3, newNo: null });
    expect(d[3]).toMatchObject({ oldNo: null, newNo: 3 });
    expect(d[4]).toMatchObject({ oldNo: 4, newNo: 4 });
  });

  it("pure insertions and deletions keep the surrounding numbering", () => {
    expect(ops(lineDiff(["a", "c"], ["a", "b", "c"]))).toEqual([" a", "+b", " c"]);
    const del = lineDiff(["a", "b", "c"], ["a", "c"]);
    expect(ops(del)).toEqual([" a", "-b", " c"]);
    expect(del[2]).toMatchObject({ oldNo: 3, newNo: 2 });
  });

  it("handles empty sides", () => {
    expect(ops(lineDiff([], ["x"]))).toEqual(["+x"]);
    expect(ops(lineDiff(["x"], []))).toEqual(["-x"]);
    expect(lineDiff([], [])).toEqual([]);
  });

  it("repeated lines at both ends are not double-counted", () => {
    const d = lineDiff(["x", "x"], ["x"]);
    expect(oldSide(d)).toEqual(["x", "x"]);
    expect(newSide(d)).toEqual(["x"]);
  });

  it("on random inputs: rebuilds both sides and keeps a longest common subsequence", () => {
    const next = rng(42);
    const alphabet = ["- launchApp", "- back", "- tapOn: A", "- tapOn: B", "---", ""];
    for (let round = 0; round < 300; round++) {
      const a = Array.from(
        { length: Math.floor(next() * 12) },
        () => alphabet[Math.floor(next() * 6)],
      );
      const b = Array.from(
        { length: Math.floor(next() * 12) },
        () => alphabet[Math.floor(next() * 6)],
      );
      const d = lineDiff(a, b);
      expect(oldSide(d)).toEqual(a);
      expect(newSide(d)).toEqual(b);
      expect(d.filter((l) => l.op === "same")).toHaveLength(lcs(a, b));
      const olds = d.map((l) => l.oldNo).filter((n): n is number => n !== null);
      const news = d.map((l) => l.newNo).filter((n): n is number => n !== null);
      expect(olds).toEqual(a.map((_, i) => i + 1));
      expect(news).toEqual(b.map((_, i) => i + 1));
    }
  });

  it("stays fast on a long flow with a small edit", () => {
    const a = Array.from({ length: 20_000 }, (_, i) => `- tapOn: "item ${i}"`);
    const b = a.slice();
    b[10_000] = "- back";
    const t0 = performance.now();
    const d = lineDiff(a, b);
    expect(performance.now() - t0).toBeLessThan(200);
    expect(d.filter((l) => l.op !== "same")).toHaveLength(2);
  });
});
