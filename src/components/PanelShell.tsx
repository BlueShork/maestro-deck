// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import type { ReactNode } from "react";

import { PanelCloseContext } from "@/components/panelClose";
import { cn } from "@/lib/utils";
import { usePanelsStore, type PanelId } from "@/stores/panelsStore";

/**
 * Wraps a resizable panel's content. The panel's own `PanelHeader` picks the
 * close action up from context and shows it as a hover-only cell at the end
 * of the header row; hidden panels come back from the Toolbar's View menu.
 */
export function PanelShell({
  id,
  children,
  className,
}: {
  id: PanelId;
  children: ReactNode;
  className?: string;
}) {
  const hide = usePanelsStore((s) => s.hide);
  return (
    <PanelCloseContext.Provider value={() => hide(id)}>
      <div
        data-tour={id}
        className={cn(
          "group/panel relative flex h-full min-h-0 w-full min-w-0 flex-col",
          className,
        )}
      >
        {children}
      </div>
    </PanelCloseContext.Provider>
  );
}
