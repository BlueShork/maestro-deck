// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { open as openDialog } from "@tauri-apps/plugin-dialog";

import type { CloudJobPlatform } from "@/lib/cloudJobs";
import { CLOUD_ARTIFACTS } from "@/lib/cloudRunner";
import { toast } from "@/stores/toastStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";

/**
 * Ask for the build a cloud fleet installs (.apk for Android, a zipped .app
 * for iOS) and remember it. Returns false when nothing usable was picked.
 */
export async function pickCloudArtifact(platform: CloudJobPlatform): Promise<boolean> {
  const artifact = CLOUD_ARTIFACTS[platform];
  const isIos = platform === "ios";
  const picked = await openDialog({
    multiple: false,
    filters: [
      { name: isIos ? "Simulator build" : "Android app", extensions: [artifact.extension] },
    ],
  });
  if (typeof picked !== "string") return false;
  if (!picked.toLowerCase().endsWith(`.${artifact.extension}`)) {
    // Rejected here rather than in the cloud: the wrong artefact fails at
    // install, after the run has already been charged.
    toast.error("Wrong file", artifact.rejection);
    return false;
  }
  const ws = useWorkspaceStore.getState();
  (isIos ? ws.setCloudIosAppPath : ws.setCloudApkPath)(picked);
  return true;
}

/** The chosen build for a fleet, as a file name, or null. */
export function useCloudArtifactName(platform: CloudJobPlatform | null): string | null {
  const path = useWorkspaceStore((s) =>
    platform === null ? null : platform === "ios" ? s.cloudIosAppPath : s.cloudApkPath,
  );
  return path ? (path.split(/[\\/]/).pop() ?? path) : null;
}
