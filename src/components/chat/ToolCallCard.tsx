// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { type ReactElement, useState } from "react";

import { cn } from "@/lib/utils";
import type { ContentBlock } from "@/types/chat";

type ToolUse = Extract<ContentBlock, { type: "tool_use" }>;
type ToolResult = Extract<ContentBlock, { type: "tool_result" }>;

// ── human labels ─────────────────────────────────────────────────────────────

function toolLabel(use: ToolUse, result?: ToolResult): string {
  const input = use.input as Record<string, unknown>;

  switch (use.name) {
    case "get_screen":
      return "Lecture de l'écran";

    case "take_screenshot":
      return "Capture d'écran";

    case "tap": {
      const x = input.x ?? "?";
      const y = input.y ?? "?";
      return `Tap (${x}, ${y})`;
    }

    case "input_text": {
      const raw = typeof input.text === "string" ? input.text : "";
      const truncated = raw.length > 30 ? raw.slice(0, 30) + "…" : raw;
      return `Saisie "${truncated}"`;
    }

    case "press_key": {
      const key = input.key ?? "?";
      return `Touche ${key}`;
    }

    case "list_flows":
      return "Liste des flows";

    case "read_flow": {
      const path = input.path ?? input.name ?? "?";
      return `Lit ${path}`;
    }

    case "write_flow": {
      const path = input.path ?? input.name ?? "?";
      return `Écrit ${path}`;
    }

    case "run_flow": {
      const path = input.path ?? input.name ?? "?";
      let suffix = "";
      if (result && !result.isError && typeof result.content === "string") {
        try {
          const parsed = JSON.parse(result.content) as { exitCode?: number };
          if (typeof parsed.exitCode === "number") {
            suffix = parsed.exitCode === 0 ? " · ✓ exit 0" : ` · ✗ exit ${parsed.exitCode}`;
          }
        } catch {
          // ignore parse errors
        }
      }
      return `Run ${path}${suffix}`;
    }

    default:
      return use.name;
  }
}

// ── status glyph ─────────────────────────────────────────────────────────────

type StatusGlyph = { kind: "running" } | { kind: "error" } | { kind: "success" };

function statusGlyph(result?: ToolResult): StatusGlyph {
  if (!result) return { kind: "running" };
  if (result.isError) return { kind: "error" };
  return { kind: "success" };
}

function GlyphEl({ glyph }: { glyph: StatusGlyph }): ReactElement {
  if (glyph.kind === "running") {
    return (
      <span
        className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-current text-muted-foreground"
        aria-label="En cours"
      />
    );
  }
  if (glyph.kind === "error") {
    return (
      <span
        className="text-red-600 motion-safe:animate-in motion-safe:zoom-in-75 motion-safe:duration-200 dark:text-red-400"
        aria-label="Erreur"
      >
        ✗
      </span>
    );
  }
  return (
    <span
      className="text-emerald-600 motion-safe:animate-in motion-safe:zoom-in-75 motion-safe:duration-200 dark:text-emerald-400"
      aria-label="Succès"
    >
      ✓
    </span>
  );
}

// ── result body ──────────────────────────────────────────────────────────────

function ResultBody({ result }: { result: ToolResult }): ReactElement {
  const { content } = result;
  if (typeof content === "string") {
    const display = content.length > 4000 ? content.slice(0, 4000) + "…" : content;
    return (
      <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words text-[11px] text-muted-foreground">
        {display}
      </pre>
    );
  }
  // image
  return (
    <img
      src={`data:${content.mediaType};base64,${content.base64}`}
      className="max-h-48 rounded border border-border"
      alt="screenshot"
    />
  );
}

// ── main component ────────────────────────────────────────────────────────────

export interface ToolCallCardProps {
  use: ToolUse;
  result?: ToolResult;
}

/** Human rendering of the tool input. Multiline string fields (write_flow's
 *  YAML `content`, input_text's `text`) display as plain text — JSON escaping
 *  (`\n`, `\"`) makes YAML unreadable in the card. */
function formatInput(use: ToolUse): string {
  const input = use.input as Record<string, unknown>;
  if (use.name === "write_flow" && typeof input.content === "string") {
    return `path: ${String(input.path ?? "?")}\n\n${input.content}`;
  }
  if (use.name === "input_text" && typeof input.text === "string") {
    return input.text;
  }
  return JSON.stringify(use.input, null, 2);
}

export function ToolCallCard({ use, result }: ToolCallCardProps): ReactElement {
  const [open, setOpen] = useState(false);
  const glyph = statusGlyph(result);
  const label = toolLabel(use, result);
  const inputJson = formatInput(use);

  return (
    <div className="my-1 rounded-lg border border-border bg-muted/40 text-xs motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-200">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <GlyphEl glyph={glyph} />
        <span className="text-muted-foreground">{label}</span>
      </button>

      {/* aria-hidden: the 0fr grid hides the body visually but NOT from
          screen readers — without this, collapsed YAML/result payloads are
          announced in the AT reading flow (the old <details> hid them). */}
      <div
        aria-hidden={!open}
        className={cn(
          "grid motion-safe:transition-[grid-template-rows] motion-safe:duration-200",
          open ? "[grid-template-rows:1fr]" : "[grid-template-rows:0fr]",
        )}
      >
        <div className="overflow-hidden">
          <div className="border-t border-border px-3 py-2">
            <div className="mb-1 font-mono text-[10px] uppercase tracking-wide text-muted-foreground/60">
              Input
            </div>
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words text-[11px] text-foreground">
              {inputJson}
            </pre>

            {result && (
              <>
                <div className="mb-1 mt-2 font-mono text-[10px] uppercase tracking-wide text-muted-foreground/60">
                  Result
                </div>
                <ResultBody result={result} />
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
