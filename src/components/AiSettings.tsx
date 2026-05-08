import { useEffect, useState } from "react";

import { Button } from "@/components/ui/Button";
import { credentials } from "@/lib/chat/credentials";
import { invalidateProvider } from "@/lib/chat/registry";
import { cn } from "@/lib/utils";
import type { ProviderId } from "@/types/chat";

const REGIONS = ["us-east5", "us-central1", "europe-west1", "europe-west4", "asia-southeast1"];

export function AiSettings() {
  const [provider, setProvider] = useState<ProviderId>("anthropic");

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

  const clearProvider = async (id: ProviderId) => {
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
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium text-muted-foreground">AI assistant</span>
        <p className="text-[11px] text-muted-foreground">
          Bring your own key. Credentials are stored encrypted in a local Stronghold vault and never
          leave this machine except when calling the provider you configure.
        </p>
      </div>

      <div className="inline-flex rounded-md border border-border bg-muted/30 p-0.5 self-start">
        {(["anthropic", "vertex"] as ProviderId[]).map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setProvider(p)}
            className={cn(
              "rounded px-3 py-1 text-xs font-medium transition-colors",
              provider === p
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {p === "anthropic" ? "Anthropic" : "Vertex AI"}
          </button>
        ))}
      </div>

      {provider === "anthropic" ? (
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-muted-foreground">
              API key {anthropicSaved && <em className="text-emerald-500">(saved)</em>}
            </span>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => {
                setApiKey(e.target.value);
                setAnthropicSaved(false);
              }}
              placeholder="sk-ant-…"
              className="rounded border border-border bg-background px-2 py-1.5 font-mono text-xs"
            />
          </label>
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
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-muted-foreground">GCP project ID</span>
            <input
              type="text"
              value={projectId}
              onChange={(e) => {
                setProjectId(e.target.value);
                setVertexSaved(false);
              }}
              placeholder="my-gcp-project"
              className="rounded border border-border bg-background px-2 py-1.5 font-mono text-xs"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-muted-foreground">Region</span>
            <select
              value={region}
              onChange={(e) => {
                setRegion(e.target.value);
                setVertexSaved(false);
              }}
              className="rounded border border-border bg-background px-2 py-1.5 text-xs"
            >
              {REGIONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-muted-foreground">
              Service account JSON {vertexSaved && <em className="text-emerald-500">(saved)</em>}
            </span>
            <textarea
              value={serviceAccountJson}
              onChange={(e) => {
                setServiceAccountJson(e.target.value);
                setVertexSaved(false);
              }}
              rows={4}
              placeholder='{"type":"service_account",…}'
              className="resize-none rounded border border-border bg-background px-2 py-1.5 font-mono text-[10px]"
            />
          </label>
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
            "rounded-md border px-2 py-1 text-[11px]",
            status.kind === "ok"
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-500"
              : "border-destructive/40 bg-destructive/10 text-destructive",
          )}
        >
          {status.msg}
        </div>
      )}
    </div>
  );
}
