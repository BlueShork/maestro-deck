// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { Fragment, type ReactNode } from "react";

const ESC = String.fromCharCode(27);
const ANSI_RE = new RegExp(`${ESC}\\[([\\d;]*)m`, "g");

const FG: Record<number, string> = {
  30: "text-zinc-500",
  31: "text-red-400",
  32: "text-emerald-400",
  33: "text-amber-300",
  34: "text-blue-400",
  35: "text-fuchsia-400",
  36: "text-cyan-300",
  37: "text-zinc-200",
  90: "text-zinc-500",
  91: "text-red-300",
  92: "text-emerald-300",
  93: "text-amber-200",
  94: "text-blue-300",
  95: "text-fuchsia-300",
  96: "text-cyan-200",
  97: "text-white",
};

export function renderAnsi(line: string): ReactNode {
  const out: ReactNode[] = [];
  let lastIndex = 0;
  let currentClass = "";
  let key = 0;
  let match: RegExpExecArray | null;
  ANSI_RE.lastIndex = 0;
  while ((match = ANSI_RE.exec(line)) !== null) {
    if (match.index > lastIndex) {
      const text = line.slice(lastIndex, match.index);
      out.push(
        <span key={key++} className={currentClass}>
          {text}
        </span>,
      );
    }
    const codes = match[1].split(";").map((c) => Number(c) || 0);
    for (const code of codes) {
      if (code === 0) currentClass = "";
      else if (FG[code]) currentClass = FG[code];
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < line.length) {
    out.push(
      <span key={`tail-${key}`} className={currentClass}>
        {line.slice(lastIndex)}
      </span>,
    );
  }
  return <Fragment>{out}</Fragment>;
}
