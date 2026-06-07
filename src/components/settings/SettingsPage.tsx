// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { ArrowLeft } from "lucide-react";
import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { resolveSection, SETTINGS_SECTIONS } from "@/components/settings/sections";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";

/**
 * Full-screen settings page. Replaces the old modal: a left nav lists the
 * sections, the right pane shows the active one (driven by the `:section`
 * URL segment), and `← Back` / Escape return to the workspace.
 */
export function SettingsPage() {
  const { section } = useParams();
  const navigate = useNavigate();
  const active = resolveSection(section);

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
        <nav className="w-52 shrink-0 overflow-y-auto border-r border-border p-2">
          {SETTINGS_SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => navigate(`/settings/${s.id}`)}
              aria-current={active.id === s.id ? "page" : undefined}
              className={cn(
                "w-full rounded px-3 py-1.5 text-left text-sm transition-colors",
                active.id === s.id
                  ? "bg-muted font-medium text-foreground"
                  : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
              )}
            >
              {s.label}
            </button>
          ))}
        </nav>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-2xl px-6 py-6 text-sm">{active.render()}</div>
        </div>
      </div>
    </div>
  );
}
