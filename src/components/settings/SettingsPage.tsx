// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { ArrowLeft } from "lucide-react";
import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { resolveSection, SETTINGS_SECTIONS } from "@/components/settings/sections";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";

function groupSections() {
  const out: Array<{ group: string | null; sections: typeof SETTINGS_SECTIONS }> = [];
  for (const s of SETTINGS_SECTIONS) {
    const last = out.at(-1);
    if (last && last.group === s.group) last.sections.push(s);
    else out.push({ group: s.group, sections: [s] });
  }
  return out;
}

/**
 * Full-screen settings page. Replaces the old modal: a left nav lists the
 * sections, the right pane shows the active one (driven by the `:section`
 * URL segment), and `← Back` / Escape return to the workspace.
 */
export function SettingsPage() {
  const { section } = useParams();
  const navigate = useNavigate();
  const active = resolveSection(section);
  const groups = groupSections();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") navigate("/");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
        <Button
          size="icon"
          variant="ghost"
          onClick={() => navigate("/")}
          aria-label="Back to workspace"
          title="Back to workspace (Esc)"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <span className="text-sm font-semibold">Settings</span>
      </header>

      <div className="flex min-h-0 flex-1">
        <nav className="w-56 shrink-0 overflow-y-auto border-r border-border p-3">
          {groups.map(({ group, sections }) => (
            <div key={group ?? "ungrouped"} className="mb-4 flex flex-col gap-0.5">
              {group ? (
                <div className="px-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
                  {group}
                </div>
              ) : null}
              {sections.map((s) => {
                const Icon = s.icon;
                const current = active.id === s.id;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => navigate(`/settings/${s.id}`)}
                    aria-current={current ? "page" : undefined}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      current
                        ? "bg-muted font-medium text-foreground"
                        : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    {s.label}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-2xl px-8 py-8 text-sm">{active.render()}</div>
        </div>
      </div>
    </div>
  );
}
