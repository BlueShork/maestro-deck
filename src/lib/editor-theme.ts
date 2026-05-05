import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";

// Soft-pro palette — pastels on a deep navy base for dark, warm paper tones for
// light. Tuned for YAML where the visual signal is key/value pairs and indent.

interface Palette {
  bg: string;
  surface: string;
  fg: string;
  fgMuted: string;
  selection: string;
  selectionMatch: string;
  caret: string;
  activeLine: string;
  activeLineGutter: string;
  border: string;
  key: string;
  string: string;
  number: string;
  bool: string;
  punct: string;
  comment: string;
  activeRunBg: string;
  activeRunBorder: string;
  completionSelected: string;
}

const DARK: Palette = {
  bg: "hsl(224 30% 8%)",
  surface: "hsl(224 30% 6%)",
  fg: "hsl(220 15% 82%)",
  fgMuted: "hsl(220 12% 55%)",
  selection: "hsl(210 70% 55% / 0.22)",
  selectionMatch: "hsl(210 70% 55% / 0.10)",
  caret: "hsl(210 100% 72%)",
  activeLine: "hsl(220 30% 11%)",
  activeLineGutter: "hsl(220 30% 13%)",
  border: "hsl(220 25% 14%)",
  key: "hsl(282 70% 78%)",
  string: "hsl(34 80% 73%)",
  number: "hsl(150 55% 68%)",
  bool: "hsl(15 80% 70%)",
  punct: "hsl(220 15% 50%)",
  comment: "hsl(220 15% 38%)",
  activeRunBg: "hsl(210 100% 60% / 0.10)",
  activeRunBorder: "hsl(210 100% 65%)",
  completionSelected: "hsl(210 70% 55% / 0.18)",
};

const LIGHT: Palette = {
  bg: "hsl(40 30% 99%)",
  surface: "hsl(0 0% 100%)",
  fg: "hsl(222 30% 20%)",
  fgMuted: "hsl(222 15% 45%)",
  selection: "hsl(210 80% 55% / 0.18)",
  selectionMatch: "hsl(210 80% 55% / 0.10)",
  caret: "hsl(222 80% 45%)",
  activeLine: "hsl(220 40% 96%)",
  activeLineGutter: "hsl(220 35% 93%)",
  border: "hsl(220 20% 88%)",
  key: "hsl(282 55% 42%)",
  string: "hsl(20 70% 42%)",
  number: "hsl(160 55% 32%)",
  bool: "hsl(15 75% 48%)",
  punct: "hsl(222 15% 45%)",
  comment: "hsl(222 12% 55%)",
  activeRunBg: "hsl(210 100% 50% / 0.10)",
  activeRunBorder: "hsl(210 90% 50%)",
  completionSelected: "hsl(210 80% 55% / 0.15)",
};

function buildTheme(c: Palette, dark: boolean): Extension {
  return EditorView.theme(
    {
      "&": {
        height: "100%",
        color: c.fg,
        backgroundColor: c.bg,
        fontSize: "13px",
        fontFamily: '"JetBrains Mono", "SF Mono", ui-monospace, Menlo, Consolas, monospace',
        fontVariantLigatures: "common-ligatures contextual",
      },
      ".cm-scroller": {
        fontFamily: "inherit",
        lineHeight: "1.7",
        padding: "10px 0",
      },
      ".cm-content": {
        caretColor: c.caret,
        padding: "0",
      },
      ".cm-line": { padding: "0 14px" },
      "&.cm-focused": { outline: "none" },
      ".cm-cursor, .cm-dropCursor": {
        borderLeft: `2px solid ${c.caret}`,
        borderRadius: "1px",
      },
      "&.cm-focused .cm-cursor": {
        animation: "cm-caret-pulse 1.1s ease-in-out infinite",
      },
      "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, ::selection": {
        background: c.selection,
        borderRadius: "3px",
      },
      ".cm-selectionMatch": {
        background: c.selectionMatch,
        borderRadius: "3px",
      },
      ".cm-activeLine": { backgroundColor: c.activeLine },
      ".cm-activeLineGutter": {
        backgroundColor: c.activeLineGutter,
        color: c.fg,
      },
      ".cm-gutters": {
        backgroundColor: c.bg,
        color: c.fgMuted,
        border: "none",
        borderRight: `1px solid ${c.border}`,
        paddingRight: "4px",
      },
      ".cm-lineNumbers .cm-gutterElement": {
        padding: "0 10px 0 14px",
        minWidth: "28px",
        textAlign: "right",
        fontVariantNumeric: "tabular-nums",
      },
      ".cm-active-run-line": {
        backgroundColor: c.activeRunBg,
        boxShadow: `inset 2px 0 0 ${c.activeRunBorder}`,
      },
      ".cm-gutterElement.cm-step-line-done": {
        backgroundColor: "rgba(16,185,129,0.22)",
        color: dark ? "rgb(110 231 183)" : "rgb(6 95 70)",
        fontWeight: "600",
      },
      ".cm-gutterElement.cm-step-line-failed": {
        backgroundColor: "rgba(239,68,68,0.22)",
        color: dark ? "rgb(252 165 165)" : "rgb(127 29 29)",
        fontWeight: "600",
      },
      ".cm-gutterElement.cm-step-line-running": {
        backgroundColor: "rgba(59,130,246,0.22)",
        color: dark ? "rgb(147 197 253)" : "rgb(30 64 175)",
        fontWeight: "600",
        animation: "cm-step-pulse 1.2s ease-in-out infinite",
      },
      "@keyframes cm-step-pulse": {
        "0%, 100%": { backgroundColor: "rgba(59,130,246,0.18)" },
        "50%": { backgroundColor: "rgba(59,130,246,0.36)" },
      },
      ".cm-tooltip": {
        backgroundColor: c.surface,
        color: c.fg,
        border: `1px solid ${c.border}`,
        borderRadius: "8px",
        boxShadow: dark ? "0 8px 24px -8px rgba(0,0,0,0.4)" : "0 8px 24px -8px rgba(0,0,0,0.15)",
        overflow: "hidden",
      },
      ".cm-tooltip.cm-tooltip-autocomplete > ul": {
        fontFamily: "inherit",
        maxHeight: "260px",
      },
      ".cm-tooltip.cm-tooltip-autocomplete > ul > li": { padding: "4px 10px" },
      ".cm-tooltip-autocomplete ul li[aria-selected]": {
        backgroundColor: c.completionSelected,
        color: c.fg,
      },
      ".cm-completionLabel": { color: c.fg },
      ".cm-completionDetail": { color: c.fgMuted, fontStyle: "normal" },
      ".cm-matchingBracket, .cm-nonmatchingBracket": {
        backgroundColor: "transparent",
        borderBottom: `1px solid ${c.fgMuted}`,
      },
    },
    { dark },
  );
}

function buildHighlight(c: Palette): Extension {
  return syntaxHighlighting(
    HighlightStyle.define([
      { tag: [t.keyword, t.atom], color: c.key, fontWeight: "500" },
      { tag: [t.propertyName, t.attributeName], color: c.key },
      { tag: [t.string, t.special(t.string)], color: c.string },
      { tag: [t.number, t.bool], color: c.number },
      { tag: t.bool, color: c.bool },
      { tag: t.null, color: c.bool },
      { tag: [t.punctuation, t.separator, t.bracket], color: c.punct },
      {
        tag: [t.comment, t.lineComment, t.blockComment],
        color: c.comment,
        fontStyle: "italic",
      },
      { tag: t.invalid, color: "hsl(0 70% 55%)" },
    ]),
  );
}

export const softProDarkExtensions: Extension[] = [buildTheme(DARK, true), buildHighlight(DARK)];

export const softProLightExtensions: Extension[] = [
  buildTheme(LIGHT, false),
  buildHighlight(LIGHT),
];

export function themeExtensions(mode: "light" | "dark"): Extension[] {
  return mode === "dark" ? softProDarkExtensions : softProLightExtensions;
}

// Back-compat re-export for existing imports.
export const softProExtensions = softProDarkExtensions;
