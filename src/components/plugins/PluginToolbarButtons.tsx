// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { Puzzle } from "lucide-react";
import type { ButtonHTMLAttributes, ForwardRefExoticComponent, RefAttributes } from "react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/Tooltip";
import { pluginUrl } from "@/lib/plugins/url";
import { usePluginsStore } from "@/stores/pluginsStore";

type Cell = ForwardRefExoticComponent<
  ButtonHTMLAttributes<HTMLButtonElement> & {
    active?: boolean;
    icon?: boolean;
  } & RefAttributes<HTMLButtonElement>
>;

/** One toolbar cell per installed plugin that has a panel. `Cell` is the
 *  toolbar's own `ToolbarCell`, passed in so the styling stays in one place. */
export function PluginToolbarButtons({ Cell }: { Cell: Cell }) {
  const installed = usePluginsStore((s) => s.installed);
  const openPanel = usePluginsStore((s) => s.openPanel);
  const toggle = usePluginsStore((s) => s.togglePluginPanel);

  return (
    <>
      {installed.map((p) =>
        p.manifest?.panel ? (
          <Tooltip key={p.id}>
            <TooltipTrigger asChild>
              <Cell
                icon
                active={openPanel === p.id}
                onClick={() => toggle(p.id)}
                aria-label={`Toggle ${p.manifest.name}`}
              >
                {p.manifest.icon ? (
                  <img src={pluginUrl(p.id, p.manifest.icon)} alt="" className="h-4 w-4" />
                ) : (
                  <Puzzle className="h-4 w-4" />
                )}
              </Cell>
            </TooltipTrigger>
            <TooltipContent>{p.manifest.panel.title}</TooltipContent>
          </Tooltip>
        ) : null,
      )}
    </>
  );
}
