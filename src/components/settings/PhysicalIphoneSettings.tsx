// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { useEffect, useState } from "react";

import { PhysicalIosSetup } from "@/components/settings/PhysicalIosSetup";
import {
  SettingsField,
  SettingsSection,
  SettingsSubgroup,
  settingsInputClass,
} from "@/components/settings/SettingsPrimitives";
import { ToolPathField, ToolPathsSaveBar } from "@/components/settings/ToolPathFields";
import { useToolPaths } from "@/components/settings/useToolPaths";
import { ipc } from "@/lib/ipc";

export function PhysicalIphoneSettings() {
  const paths = useToolPaths();
  const [bridgeInstalled, setBridgeInstalled] = useState<boolean | null>(null);
  const [installing, setInstalling] = useState(false);
  // Bump to make the checklist re-fetch its status.
  const [setupRefresh, setSetupRefresh] = useState(0);

  async function refreshBridge() {
    try {
      setBridgeInstalled(await ipc.iosDeviceBridgeInstalled());
    } catch {
      setBridgeInstalled(null);
    }
  }

  useEffect(() => {
    void refreshBridge();
  }, []);

  async function installBridge() {
    setInstalling(true);
    paths.setError(null);
    try {
      await ipc.installIosDeviceBridge();
      await Promise.all([paths.reload(), refreshBridge()]);
      setSetupRefresh((n) => n + 1);
    } catch (e) {
      paths.setError(e instanceof Error ? e.message : String(e));
    } finally {
      setInstalling(false);
    }
  }

  // The checklist reflects the saved Team ID, so refresh it after each save.
  const { saved } = paths;
  useEffect(() => {
    if (saved) setSetupRefresh((n) => n + 1);
  }, [saved]);

  return (
    <SettingsSection
      title="Physical iPhone"
      description="Running flows on a real iPhone over USB needs a few extra pieces that simulators, Android and the web don't: Xcode, a patched Maestro 2.5.1, a driver bridge, and your Apple Team ID to sign the test driver. Skip this page if you only use simulators."
    >
      <PhysicalIosSetup
        bridgeInstalled={bridgeInstalled}
        teamIdSet={(paths.view?.overrides.apple_team_id ?? "").trim() !== ""}
        onInstall={() => void installBridge()}
        installing={installing}
        refreshKey={setupRefresh}
      />

      <SettingsSubgroup
        title="Signing & tool paths"
        description="The tool paths can stay empty: the checklist installs what's needed, and anything on your PATH is found automatically."
      >
        <SettingsField
          label="Apple Team ID"
          htmlFor="tool-apple-team-id"
          description="Used to sign the test driver installed on the iPhone. Find it in your Apple Developer account under Membership → Team ID. Leave empty if Maestro is already set up with it."
        >
          <input
            id="tool-apple-team-id"
            type="text"
            value={paths.draft.appleTeamId}
            onChange={(e) => {
              const value = e.target.value;
              paths.setDraft((d) => ({ ...d, appleTeamId: value }));
            }}
            placeholder="ABCDE12345"
            spellCheck={false}
            className={settingsInputClass}
          />
        </SettingsField>
        <ToolPathField
          paths={paths}
          tool="maestro_ios_device"
          label="maestro-ios-device"
          placeholder="~/.maestro/bin/maestro-ios-device"
          hint="The bridge that runs the XCTest driver on the iPhone. Installed by the checklist above."
        />
        <ToolPathField
          paths={paths}
          tool="iproxy"
          label="iproxy"
          placeholder="/opt/homebrew/bin/iproxy"
          hint={
            <>
              Forwards ports to the iPhone over USB — from libusbmuxd (
              <code className="font-mono">brew install libusbmuxd</code>).
            </>
          }
        />
        <ToolPathsSaveBar paths={paths} />
      </SettingsSubgroup>
    </SettingsSection>
  );
}
