import { Check, Copy, Wand2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";
import { useFlowStore } from "@/stores/flowStore";

import { ApplyDiffDialog } from "./ApplyDiffDialog";

interface CodeBlockProps {
  language: string | null;
  code: string;
  className?: string;
}

export function CodeBlock({ language, code, className }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const [diffOpen, setDiffOpen] = useState(false);

  const isYaml = language === "yaml" || language === "yml";
  const filePath = useFlowStore((s) => s.filePath);

  const onCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <>
      <div className="group relative my-3">
        <div className="flex items-center justify-between rounded-t-lg border border-b-0 border-border bg-muted/80 px-3 py-1.5 text-[11px] text-muted-foreground">
          <span className="font-mono">{language ?? "text"}</span>
          <div className="flex items-center gap-1">
            {isYaml && (
              <Button
                size="xs"
                variant="ghost"
                onClick={() => setDiffOpen(true)}
                className="h-6 gap-1 px-2 text-[11px]"
                title={filePath ? `Apply to ${filePath}` : "Apply to current file"}
              >
                <Wand2 className="h-3 w-3" />
                Apply
              </Button>
            )}
            <Button
              size="xs"
              variant="ghost"
              onClick={onCopy}
              className="h-6 gap-1 px-2 text-[11px]"
              title="Copy"
            >
              {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        </div>
        <pre
          className={cn(
            "max-w-full overflow-x-auto rounded-b-lg border border-border bg-muted/60 p-3 font-mono text-[12px] leading-relaxed",
            className,
          )}
        >
          <code className={language ? `language-${language}` : undefined}>{code}</code>
        </pre>
      </div>
      {isYaml && <ApplyDiffDialog open={diffOpen} onOpenChange={setDiffOpen} proposed={code} />}
    </>
  );
}
