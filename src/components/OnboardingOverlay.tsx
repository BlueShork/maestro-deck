// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { Cloud, Loader2, Smartphone, X } from "lucide-react";
import { useEffect, useState } from "react";

import { LoginCard } from "@/components/LoginCard";
import { Button } from "@/components/ui/Button";
import { ipc } from "@/lib/ipc";
import { cn } from "@/lib/utils";
import { useCloudAuthStore } from "@/stores/cloudAuthStore";
import { useCloudTargetStore } from "@/stores/cloudTargetStore";
import { useDeviceStore } from "@/stores/deviceStore";
import { useFlowStore } from "@/stores/flowStore";
import { ONBOARDING_FLOW, useOnboardingStore } from "@/stores/onboardingStore";
import { useRunStore } from "@/stores/runStore";
import { toast } from "@/stores/toastStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";

/**
 * The hands-on half of onboarding: pick where to run, install the sample app,
 * write a real flow, run it.
 *
 * It drives the product rather than reimplementing it — the run goes through
 * the same Run button, the same store, the same cloud path as any other. What
 * it adds is the order and the explanation.
 */
export function OnboardingOverlay() {
  const active = useOnboardingStore((s) => s.active);
  const step = useOnboardingStore((s) => s.step);

  if (!active) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 backdrop-blur-sm">
      <div className="relative w-[min(560px,calc(100vw-48px))] rounded-xl border border-border bg-card p-5 shadow-2xl">
        {/* Quitting is available at every step, as promised on the way in. */}
        <button
          type="button"
          aria-label="Leave the walkthrough"
          onClick={() => useOnboardingStore.getState().quit()}
          className="absolute right-3 top-3 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>

        {step === "choose-target" ? <ChooseTarget /> : null}
        {step === "sign-in" ? <SignInStep /> : null}
        {step === "install" ? <InstallStep /> : null}
        {step === "write" ? <WriteStep /> : null}
        {step === "run" ? <RunStep /> : null}
      </div>
    </div>
  );
}

function Title({ children, sub }: { children: string; sub: string }) {
  return (
    <div className="mb-4 pr-6">
      <h2 className="text-base font-semibold tracking-tight">{children}</h2>
      <p className="mt-1 text-[13px] leading-snug text-muted-foreground">{sub}</p>
    </div>
  );
}

function ChooseTarget() {
  const signedIn = useCloudAuthStore((s) => s.user !== null);

  return (
    <>
      <Title sub="Both work. They differ in what you get to watch, and what it costs.">
        Where should your first test run?
      </Title>

      <div className="grid gap-2 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => useOnboardingStore.getState().chooseTarget("device")}
          className="rounded-lg border border-border p-3 text-left transition-colors hover:border-foreground/30 hover:bg-accent/40"
        >
          <Smartphone className="mb-2 h-4 w-4 text-muted-foreground" />
          <div className="text-xs font-semibold">On your phone</div>
          <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
            Plug it in with USB debugging on. You watch it happen in the mirror, and it costs
            nothing.
          </p>
        </button>

        <button
          type="button"
          onClick={() => useOnboardingStore.getState().chooseTarget("cloud", { signedIn })}
          className="rounded-lg border border-border p-3 text-left transition-colors hover:border-foreground/30 hover:bg-accent/40"
        >
          <Cloud className="mb-2 h-4 w-4 text-muted-foreground" />
          <div className="text-xs font-semibold">In the cloud</div>
          {/* Said here, not discovered later: no live view, and it is billed. */}
          <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
            No phone needed. There is no live view of a cloud run yet, it needs an account, and it
            spends one of your runs.
          </p>
        </button>
      </div>
    </>
  );
}

function SignInStep() {
  const user = useCloudAuthStore((s) => s.user);

  // The dialog exists so the onboarding never navigates away; the moment the
  // account is live we carry on from the same step.
  useEffect(() => {
    if (user) useOnboardingStore.getState().signedIn();
  }, [user]);

  return (
    <>
      <Title sub="Cloud runs need an account. This takes a minute, and you come straight back here.">
        Create your account
      </Title>
      <LoginCard />
    </>
  );
}

function InstallStep() {
  const target = useOnboardingStore((s) => s.target);
  const current = useDeviceStore((s) => s.current);
  const [busy, setBusy] = useState(false);

  if (target === "cloud") {
    return (
      <>
        <Title sub="The sample app ships with Maestro Deck and is uploaded with your run, so there is nothing to install here.">
          Nothing to install
        </Title>
        <StepButton onClick={() => useOnboardingStore.getState().next()}>Continue</StepButton>
      </>
    );
  }

  if (!current) {
    return (
      <>
        <Title sub="Plug it in over USB with developer mode and USB debugging enabled, then pick it in the device panel. This screen notices on its own.">
          Connect your phone
        </Title>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Waiting for a device…
        </div>
      </>
    );
  }

  const install = async () => {
    setBusy(true);
    try {
      await ipc.installSampleApp(current.serial);
      useOnboardingStore.getState().next();
    } catch (err) {
      toast.error("Install failed", err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Title
        sub={`A tiny sign-in screen, built for this walkthrough. It goes on ${current.model}.`}
      >
        Install the sample app
      </Title>
      <StepButton onClick={() => void install()} busy={busy}>
        Install it
      </StepButton>
    </>
  );
}

function WriteStep() {
  const folder = useWorkspaceStore((s) => s.folderPath);
  const [busy, setBusy] = useState(false);

  const write = async () => {
    if (!folder) return;
    setBusy(true);
    try {
      await ipc.writeWorkspaceFile(folder, "onboarding.yaml", ONBOARDING_FLOW);
      // Straight into the editor: the point is to read it, not to find it.
      useFlowStore.getState().loaded(ONBOARDING_FLOW, `${folder}/onboarding.yaml`);
      useOnboardingStore.getState().next();
    } catch (err) {
      toast.error("Could not write the flow", err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (!folder) {
    return (
      <>
        <Title sub="Open a folder first, from the workspace panel. Your flow belongs somewhere you can find it again — that is how you will work day to day.">
          Choose where your flows live
        </Title>
      </>
    );
  }

  return (
    <>
      <Title sub="Six steps: launch the app, check the screen, fill the field, submit, check it worked. Each line is one step, and the comments explain them.">
        Write your first flow
      </Title>
      <StepButton onClick={() => void write()} busy={busy}>
        Create onboarding.yaml
      </StepButton>
    </>
  );
}

function RunStep() {
  const target = useOnboardingStore((s) => s.target);
  const running = useRunStore((s) => s.running || s.starting);
  const exitCode = useRunStore((s) => s.exitCode);

  // Selecting the cloud target here means Run sends it there, exactly as it
  // would any other day — no special path for the walkthrough.
  useEffect(() => {
    if (target === "cloud") useCloudTargetStore.getState().select("android");
  }, [target]);

  const passed = exitCode === 0;

  return (
    <>
      <Title
        sub={
          target === "cloud"
            ? "Press Run in cloud. There is no live view, so watch the console: it reports each status, then the log when the run ends."
            : "Press Run in the toolbar. Watch the mirror, and the steps light up in the editor as they pass."
        }
      >
        {passed ? "That was it." : "Run it"}
      </Title>

      {running ? (
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Running…
        </div>
      ) : passed ? (
        <>
          <p className="mb-3 text-[13px] leading-snug text-muted-foreground">
            You wrote a test and ran it on a real device. Everything else in Maestro Deck is that
            loop, with more commands.
          </p>
          <StepButton onClick={() => useOnboardingStore.getState().quit()}>Done</StepButton>
        </>
      ) : (
        <p className="text-[11px] text-muted-foreground">Waiting for you to press Run.</p>
      )}
    </>
  );
}

function StepButton({
  children,
  onClick,
  busy,
}: {
  children: string;
  onClick: () => void;
  busy?: boolean;
}) {
  return (
    <Button size="sm" onClick={onClick} disabled={busy} className={cn("mt-1")}>
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
      {children}
    </Button>
  );
}
