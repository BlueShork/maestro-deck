// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import type { StateCommand } from "@codemirror/state";

/**
 * Enter on a whitespace-only line clears the indentation and parks the
 * cursor at column 0 instead of inserting another indented line.
 *
 * Maestro flows are mostly flat lists of `- command` entries, so after
 * finishing an indented block (e.g. `    text: "..."`) the default
 * Enter behavior (copy previous indentation) strands the cursor mid-line.
 * With this command, a second Enter drops straight back to column 0.
 */
export const clearIndentOnBlankLine: StateCommand = ({ state, dispatch }) => {
  const sel = state.selection.main;
  if (!sel.empty) return false;
  const line = state.doc.lineAt(sel.head);
  if (line.length === 0 || !/^[ \t]+$/.test(line.text)) return false;
  dispatch(
    state.update({
      changes: { from: line.from, to: line.to, insert: "" },
      selection: { anchor: line.from },
      userEvent: "delete.dedent",
    }),
  );
  return true;
};
