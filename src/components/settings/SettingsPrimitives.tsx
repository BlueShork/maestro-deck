// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import type { ReactNode } from "react";

import { Switch } from "@/components/ui/Switch";
import { cn } from "@/lib/utils";

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
    <section className="flex flex-col gap-7">
      <header className="flex flex-col gap-1.5">
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        {description ? (
          <p className="text-[13px] leading-relaxed text-muted-foreground">{description}</p>
        ) : null}
      </header>
      {children}
    </section>
  );
}

export function SettingsSubgroup({
  title,
  description,
  children,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-0.5 px-1">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </h3>
        {description ? (
          <p className="text-xs leading-relaxed text-muted-foreground">{description}</p>
        ) : null}
      </div>
      <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card/40 [&>*]:px-4 [&>*]:py-3">
        {children}
      </div>
    </div>
  );
}

export function SettingsBadge({ children }: { children: ReactNode }) {
  return (
    <span className="ml-1.5 rounded border border-border bg-muted px-1 py-0.5 align-middle font-mono text-[9px] uppercase tracking-wide text-muted-foreground">
      {children}
    </span>
  );
}

export function SettingsRow({
  label,
  description,
  children,
}: {
  label: ReactNode;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-6">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm">{label}</span>
        {description ? (
          <span className="text-xs leading-relaxed text-muted-foreground">{description}</span>
        ) : null}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

export function SettingsField({
  label,
  htmlFor,
  description,
  children,
  className,
}: {
  label: ReactNode;
  htmlFor?: string;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={htmlFor} className="text-sm">
        {label}
      </label>
      {children}
      {description ? (
        <div className="text-xs leading-relaxed text-muted-foreground">{description}</div>
      ) : null}
    </div>
  );
}

export const settingsInputClass =
  "w-full rounded-md border border-border bg-background px-2.5 py-1.5 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

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
    <SettingsRow label={label} description={description}>
      <Switch checked={checked} onCheckedChange={onCheckedChange} aria-label={ariaLabel} />
    </SettingsRow>
  );
}
