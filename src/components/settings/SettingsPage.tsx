// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { PageHeader } from "@/components/PageHeader";
import { resolveSection, SETTINGS_SECTIONS } from "@/components/settings/sections";
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
      <PageHeader title="Settings" />

      <div className="flex min-h-0 flex-1">
        <nav className="w-56 shrink-0 overflow-y-auto border-r border-border py-3">
          {groups.map(({ group, sections }) => (
            <div key={group ?? "ungrouped"} className="mb-4 flex flex-col">
              {group ? <div className="mono-label px-4 pb-1.5 text-[10px]">{group}</div> : null}
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
                      // Landing nav cell, turned vertical: ghost fill and an
                      // orange rule on the active entry.
                      "flex w-full items-center gap-2.5 px-4 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring",
                      current
                        ? "bg-accent font-medium text-foreground shadow-[inset_2px_0_0_hsl(var(--brand))]"
                        : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
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
