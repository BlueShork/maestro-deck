import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";

// Soft pro palette — pastels saturated on a deep navy base. Tuned for YAML
// where the visual signal is mostly key/value pairs and indentation.
const c = {
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
  // Syntax
  key: "hsl(282 70% 78%)", // soft lavender
  string: "hsl(34 80% 73%)", // warm peach
  number: "hsl(150 55% 68%)", // mint
  bool: "hsl(15 80% 70%)", // coral
  punct: "hsl(220 15% 50%)",
  comment: "hsl(220 15% 38%)",
};

export const softProTheme = EditorView.theme(
  {
    "&": {
      height: "100%",
      color: c.fg,
      backgroundColor: c.bg,
      fontSize: "13px",
      fontFamily:
        '"JetBrains Mono", "SF Mono", ui-monospace, Menlo, Consolas, monospace',
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
    ".cm-line": {
      padding: "0 14px",
    },
    "&.cm-focused": {
      outline: "none",
    },
    // Caret with smooth pulse instead of the default hard blink.
    ".cm-cursor, .cm-dropCursor": {
      borderLeft: `2px solid ${c.caret}`,
      borderRadius: "1px",
    },
    "&.cm-focused .cm-cursor": {
      animation: "cm-caret-pulse 1.1s ease-in-out infinite",
    },
    // Selection: rounded translucent rectangles.
    "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, ::selection":
      {
        background: c.selection,
        borderRadius: "3px",
      },
    ".cm-selectionMatch": {
      background: c.selectionMatch,
      borderRadius: "3px",
    },
    // Active line: very subtle highlight, no border.
    ".cm-activeLine": {
      backgroundColor: c.activeLine,
    },
    ".cm-activeLineGutter": {
      backgroundColor: c.activeLineGutter,
      color: c.fg,
    },
    // Gutter: same bg as editor, subtle separator on the right.
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
    // Active-run line highlight (driven by setActiveLine effect).
    ".cm-active-run-line": {
      backgroundColor: "hsl(210 100% 60% / 0.10)",
      boxShadow: "inset 2px 0 0 hsl(210 100% 65%)",
    },
    // Autocomplete tooltip — match the editor card surface.
    ".cm-tooltip": {
      backgroundColor: c.surface,
      color: c.fg,
      border: `1px solid ${c.border}`,
      borderRadius: "8px",
      boxShadow: "0 8px 24px -8px rgba(0,0,0,0.4)",
      overflow: "hidden",
    },
    ".cm-tooltip.cm-tooltip-autocomplete > ul": {
      fontFamily: "inherit",
      maxHeight: "260px",
    },
    ".cm-tooltip.cm-tooltip-autocomplete > ul > li": {
      padding: "4px 10px",
    },
    ".cm-tooltip-autocomplete ul li[aria-selected]": {
      backgroundColor: "hsl(210 70% 55% / 0.18)",
      color: c.fg,
    },
    ".cm-completionLabel": {
      color: c.fg,
    },
    ".cm-completionDetail": {
      color: c.fgMuted,
      fontStyle: "normal",
    },
    // Match brackets: faint underline rather than a heavy box.
    ".cm-matchingBracket, .cm-nonmatchingBracket": {
      backgroundColor: "transparent",
      borderBottom: `1px solid ${c.fgMuted}`,
    },
  },
  { dark: true },
);

export const softProHighlight = HighlightStyle.define([
  { tag: [t.keyword, t.atom], color: c.key, fontWeight: "500" },
  { tag: [t.propertyName, t.attributeName], color: c.key },
  { tag: [t.string, t.special(t.string)], color: c.string },
  { tag: [t.number, t.bool], color: c.number },
  { tag: t.bool, color: c.bool },
  { tag: t.null, color: c.bool },
  { tag: [t.punctuation, t.separator, t.bracket], color: c.punct },
  { tag: [t.comment, t.lineComment, t.blockComment], color: c.comment, fontStyle: "italic" },
  { tag: t.invalid, color: "hsl(0 70% 70%)" },
]);

export const softProExtensions = [softProTheme, syntaxHighlighting(softProHighlight)];
