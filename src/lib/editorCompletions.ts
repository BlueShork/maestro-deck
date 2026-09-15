// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import type { CompletionContext, CompletionResult } from "@codemirror/autocomplete";

import maestroCommands from "@/lib/maestro-commands.json";

/**
 * Built once at module load. Returning the same array (with a `validFor`
 * below) lets CodeMirror filter the open completion list incrementally as
 * the user types, instead of re-running the source and rebuilding the
 * tooltip DOM on every keystroke — which showed up as typing lag in the
 * editor.
 */
const MAESTRO_OPTIONS = maestroCommands.map(({ label, info }) => ({
  label,
  type: "keyword",
  detail: "maestro",
  description: info,
})) as unknown as CompletionResult["options"];

/** Matches the same word characters as the `matchBefore` pattern: as long
 *  as the user keeps typing/deleting within a `[\w-]*` word, the previous
 *  result stays valid and CodeMirror filters it client-side. */
const WORD = /^[\w-]*$/;

export function maestroCompletions(ctx: CompletionContext): CompletionResult | null {
  const word = ctx.matchBefore(/[\w-]*/);
  if (!word || (word.from === word.to && !ctx.explicit)) return null;
  return {
    from: word.from,
    options: MAESTRO_OPTIONS,
    validFor: WORD,
  };
}
