// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { PixelExternal } from "@/components/brand/Pixel";
import { Logo } from "@/components/Logo";

export function AboutSettings() {
  return (
    <section className="flex min-h-[70vh] flex-col justify-center gap-10">
      {/* The landing footer: the pixel wordmark set large over warm bands. */}
      <div className="flex flex-col">
        <Logo className="w-full" />
        <div aria-hidden className="mt-8 flex flex-col">
          <span className="h-3 bg-warm-tangerine" />
          <span className="h-3 bg-warm-orange" />
          <span className="h-3 bg-[#e51300]" />
          <span className="h-3 bg-warm-crimson" />
        </div>
      </div>

      <div className="grid border-l border-t border-border sm:grid-cols-2">
        <div className="flex flex-col gap-1.5 border-b border-r border-border p-4">
          <span className="mono-label">Version</span>
          <span className="font-display text-2xl font-medium tracking-[-0.03em]">
            v{__APP_VERSION__}
          </span>
          <span className="text-[11px] text-muted-foreground">© 2026 Ethan Morisset</span>
        </div>
        <div className="flex flex-col gap-1.5 border-b border-r border-border p-4">
          <span className="mono-label">License</span>
          <a
            href="https://github.com/BlueShork/maestro-deck/blob/main/LICENSE"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 font-display text-2xl font-medium tracking-[-0.03em] transition-colors hover:text-brand"
          >
            BUSL 1.1
            <PixelExternal />
          </a>
          <span className="text-[11px] text-muted-foreground">Business Source License</span>
        </div>
      </div>

      <p className="text-[10px] leading-relaxed text-muted-foreground">
        Independent community project. Not affiliated with, endorsed by, or sponsored by mobile.dev
        Inc. &quot;Maestro&quot; is used nominatively to describe interoperability with the Maestro
        framework and remains the property of its respective owner.
      </p>
    </section>
  );
}
