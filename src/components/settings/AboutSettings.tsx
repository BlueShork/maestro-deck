// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { Logo } from "@/components/Logo";

export function AboutSettings() {
  return (
    <section className="flex min-h-[70vh] flex-col items-center justify-center gap-4">
      <Logo className="mx-auto h-20 w-auto text-foreground" />
      <div className="flex flex-col gap-1 text-center text-[11px] text-muted-foreground">
        <span>Maestro Deck v{__APP_VERSION__} — © 2026 Ethan Morisset</span>
        <span>
          Licensed under the{" "}
          <a
            href="https://github.com/BlueShork/maestro-deck/blob/main/LICENSE"
            target="_blank"
            rel="noreferrer"
            className="underline hover:text-foreground"
          >
            Business Source License 1.1
          </a>
          .
        </span>
        <span className="text-[10px] leading-relaxed">
          Independent community project. Not affiliated with, endorsed by, or sponsored by
          mobile.dev Inc. &quot;Maestro&quot; is used nominatively to describe interoperability with
          the Maestro framework and remains the property of its respective owner.
        </span>
      </div>
    </section>
  );
}
