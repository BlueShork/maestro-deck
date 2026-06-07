// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import type { ReactNode } from "react";

import { Switch } from "@/components/ui/Switch";

/** A titled group of related settings, with optional intro copy. */
export function SettingsSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-base font-semibold">{title}</h2>
        {description ? <p className="text-[11px] text-muted-foreground">{description}</p> : null}
      </div>
      <div className="flex flex-col gap-4">{children}</div>
    </section>
  );
}

/** A boolean setting: label + description on the left, a Switch on the right. */
export function ToggleRow({
  label,
  description,
  checked,
  onCheckedChange,
}: {
  label: ReactNode;
  description?: ReactNode;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
}) {
  const ariaLabel = typeof label === "string" ? label : undefined;
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex flex-col">
        <span>{label}</span>
        {description ? (
          <span className="text-[11px] text-muted-foreground">{description}</span>
        ) : null}
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} aria-label={ariaLabel} />
    </div>
  );
}
