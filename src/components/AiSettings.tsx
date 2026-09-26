// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import {
  SettingsField,
  SettingsSubgroup,
  settingsInputClass,
} from "@/components/settings/SettingsPrimitives";
import { Button } from "@/components/ui/Button";
import { credentials } from "@/lib/chat/credentials";
import { MAESTRODECK_MODEL } from "@/lib/chat/models";
import { invalidateProvider } from "@/lib/chat/registry";
import { cn } from "@/lib/utils";
import { useChatStore } from "@/stores/chatStore";
import { useCloudAuthStore } from "@/stores/cloudAuthStore";
import type { ByokProviderId, ProviderId } from "@/types/chat";

const PROVIDER_TABS: { id: ProviderId; label: string }[] = [
  { id: "maestrodeck", label: "Maestro Deck" },
  { id: "anthropic", label: "Anthropic" },
  { id: "vertex", label: "Vertex AI" },
];

const REGIONS = ["us-east5", "us-central1", "europe-west1", "europe-west4", "asia-southeast1"];

export function AiSettings() {
  // Open on the provider the chat is using, so its settings are what shows.
  const [provider, setProvider] = useState<ProviderId>(
    () => useChatStore.getState().currentProvider,
  );

  // Anthropic
  const [apiKey, setApiKey] = useState("");
  const [anthropicSaved, setAnthropicSaved] = useState(false);

  // Vertex
  const [projectId, setProjectId] = useState("");
  const [region, setRegion] = useState("us-east5");
  const [serviceAccountJson, setServiceAccountJson] = useState("");
  const [vertexSaved, setVertexSaved] = useState(false);

  const [status, setStatus] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      const a = await credentials.getAnthropic().catch(() => null);
      if (a?.apiKey) {
        setAnthropicSaved(true);
        setApiKey("•".repeat(12));
      }
      const v = await credentials.getVertex().catch(() => null);
      if (v?.serviceAccountJson) {
        setVertexSaved(true);
        setProjectId(v.projectId);
        setRegion(v.region);
        setServiceAccountJson("•".repeat(20));
      }
    })();
  }, []);

  const saveAnthropic = async () => {
    setBusy(true);
    setStatus(null);
    try {
      await credentials.saveAnthropic({ apiKey });
      invalidateProvider("anthropic");
      setAnthropicSaved(true);
      setApiKey("•".repeat(12));
      setStatus({ kind: "ok", msg: "Anthropic credentials saved." });
    } catch (e) {
      setStatus({ kind: "err", msg: String(e) });
    } finally {
      setBusy(false);
    }
  };

  const saveVertex = async () => {
    setBusy(true);
    setStatus(null);
    try {
      await credentials.saveVertex({ projectId, region, serviceAccountJson });
      invalidateProvider("vertex");
      setVertexSaved(true);
      setServiceAccountJson("•".repeat(20));
      setStatus({ kind: "ok", msg: "Vertex credentials saved." });
    } catch (e) {
      setStatus({ kind: "err", msg: String(e) });
    } finally {
      setBusy(false);
    }
  };

  const clearProvider = async (id: ByokProviderId) => {
    setBusy(true);
    try {
      await credentials.clear(id);
      invalidateProvider(id);
      if (id === "anthropic") {
        setAnthropicSaved(false);
        setApiKey("");
      } else {
        setVertexSaved(false);
        setProjectId("");
        setServiceAccountJson("");
      }
      setStatus({ kind: "ok", msg: "Credentials cleared." });
    } catch (e) {
      setStatus({ kind: "err", msg: String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsSubgroup
      title="Provider"
      description="Where Billy's answers come from. Use Billy through your Maestro Deck account, or bring your own key — keys are stored encrypted in a local vault and only ever sent to the provider you pick."
    >
      <div className="flex">
        <div className="inline-flex rounded-md border border-border bg-muted/30 p-0.5">
          {PROVIDER_TABS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setProvider(p.id)}
              aria-pressed={provider === p.id}
              className={cn(
                "rounded px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                provider === p.id
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {provider === "maestrodeck" ? (
        <MaestroDeckSettings />
      ) : provider === "anthropic" ? (
        <div className="flex flex-col gap-3">
          <SettingsField
            label={<>API key {anthropicSaved && <SavedTag />}</>}
            htmlFor="ai-anthropic-key"
            description="Create one at console.anthropic.com → API keys."
          >
            <input
              id="ai-anthropic-key"
              type="password"
              value={apiKey}
              onChange={(e) => {
                setApiKey(e.target.value);
                setAnthropicSaved(false);
              }}
              placeholder="sk-ant-…"
              className={settingsInputClass}
            />
          </SettingsField>
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={saveAnthropic}
              disabled={busy || !apiKey || apiKey.startsWith("•")}
            >
              Save
            </Button>
            {anthropicSaved && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => void clearProvider("anthropic")}
                disabled={busy}
              >
                Clear
              </Button>
            )}
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <SettingsField label="GCP project ID" htmlFor="ai-vertex-project">
            <input
              id="ai-vertex-project"
              type="text"
              value={projectId}
              onChange={(e) => {
                setProjectId(e.target.value);
                setVertexSaved(false);
              }}
              placeholder="my-gcp-project"
              className={settingsInputClass}
            />
          </SettingsField>
          <SettingsField label="Region" htmlFor="ai-vertex-region">
            <select
              id="ai-vertex-region"
              value={region}
              onChange={(e) => {
                setRegion(e.target.value);
                setVertexSaved(false);
              }}
              className={settingsInputClass}
            >
              {REGIONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </SettingsField>
          <SettingsField
            label={<>Service account JSON {vertexSaved && <SavedTag />}</>}
            htmlFor="ai-vertex-sa"
            description="A key for a service account with the Vertex AI User role."
          >
            <textarea
              id="ai-vertex-sa"
              value={serviceAccountJson}
              onChange={(e) => {
                setServiceAccountJson(e.target.value);
                setVertexSaved(false);
              }}
              rows={4}
              placeholder='{"type":"service_account",…}'
              className={cn(settingsInputClass, "resize-none text-[10px]")}
            />
          </SettingsField>
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={saveVertex}
              disabled={
                busy || !projectId || !serviceAccountJson || serviceAccountJson.startsWith("•")
              }
            >
              Save
            </Button>
            {vertexSaved && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => void clearProvider("vertex")}
                disabled={busy}
              >
                Clear
              </Button>
            )}
          </div>
        </div>
      )}

      {status && (
        <div
          className={cn(
            "text-xs",
            status.kind === "ok"
              ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
              : "bg-destructive/10 text-destructive",
          )}
        >
          {status.msg}
        </div>
      )}
    </SettingsSubgroup>
  );
}

function SavedTag() {
  return (
    <span className="ml-1 text-xs font-normal text-emerald-600 dark:text-emerald-400">saved</span>
  );
}

/** Billy hosted by Maestro Deck: nothing to configure, only an account. */
function MaestroDeckSettings() {
  const navigate = useNavigate();
  const user = useCloudAuthStore((s) => s.user);
  const ready = useCloudAuthStore((s) => s.ready);
  const inUse = useChatStore((s) => s.currentProvider === "maestrodeck");
  const setChatProvider = useChatStore((s) => s.setProvider);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs leading-relaxed text-muted-foreground">
        The same Billy as in the Maestro Deck iPhone app, with every desktop tool: he sees the
        device, taps, and writes and runs your flows. No key needed, free with a Maestro Deck
        account. Your conversation is sent to Maestro Deck Cloud to be answered.
      </p>
      {!ready ? null : user ? (
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground">
            Signed in as <span className="text-foreground">{user.email}</span>
          </span>
          <Button
            size="sm"
            onClick={() => setChatProvider("maestrodeck", MAESTRODECK_MODEL.id)}
            disabled={inUse}
          >
            {inUse ? "Used by the chat" : "Use in the chat"}
          </Button>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground">
            Sign in to your Maestro Deck account to use it.
          </span>
          <Button size="sm" onClick={() => navigate("/account")}>
            Sign in
          </Button>
        </div>
      )}
    </div>
  );
}
