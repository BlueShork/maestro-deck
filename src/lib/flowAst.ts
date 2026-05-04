import yaml from "js-yaml";

export interface Step {
  index: number;
  line: number;
  command: string;
  arg: string | null;
}

export interface FlowAst {
  steps: Step[];
  byKey: Map<string, number[]>;
}

const EMPTY: FlowAst = { steps: [], byKey: new Map() };

export function parseFlow(source: string): FlowAst {
  const docs = splitDocs(source);
  const flowDoc = docs[docs.length - 1];
  if (!flowDoc) return EMPTY;

  let parsed: unknown;
  try {
    parsed = yaml.load(flowDoc.body);
  } catch {
    return EMPTY;
  }
  if (!Array.isArray(parsed)) return EMPTY;

  const steps: Step[] = [];
  for (let i = 0; i < parsed.length; i++) {
    const raw = parsed[i];
    const step = normalize(raw);
    if (!step) continue;
    const lineInDoc = findItemLine(flowDoc.body, i);
    steps.push({
      index: steps.length,
      line: flowDoc.startLine + lineInDoc,
      command: step.command,
      arg: step.arg,
    });
  }

  const byKey = new Map<string, number[]>();
  for (const s of steps) {
    const k = `${s.command}|${s.arg ?? ""}`;
    const arr = byKey.get(k);
    if (arr) arr.push(s.index);
    else byKey.set(k, [s.index]);
  }
  return { steps, byKey };
}

interface DocSlice {
  body: string;
  startLine: number;
}

function splitDocs(source: string): DocSlice[] {
  const lines = source.split("\n");
  const slices: DocSlice[] = [];
  let bodyStart = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      if (i > bodyStart) {
        slices.push({
          body: lines.slice(bodyStart, i).join("\n"),
          startLine: bodyStart + 1,
        });
      }
      bodyStart = i + 1;
    }
  }
  if (bodyStart < lines.length) {
    slices.push({
      body: lines.slice(bodyStart).join("\n"),
      startLine: bodyStart + 1,
    });
  }
  return slices;
}

function findItemLine(body: string, itemIndex: number): number {
  const lines = body.split("\n");
  let count = 0;
  for (let i = 0; i < lines.length; i++) {
    if (/^- /.test(lines[i]) || /^-$/.test(lines[i].trimEnd())) {
      if (count === itemIndex) return i;
      count++;
    }
  }
  return 0;
}

function normalize(raw: unknown): { command: string; arg: string | null } | null {
  if (typeof raw === "string") {
    return { command: raw, arg: null };
  }
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const entries = Object.entries(raw as Record<string, unknown>);
    if (entries.length === 0) return null;
    const [command, value] = entries[0];
    return { command, arg: extractArg(command, value) };
  }
  return null;
}

function extractArg(command: string, value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    if (command === "launchApp" && typeof obj.appId === "string") return obj.appId;
    if (typeof obj.id === "string") return obj.id;
    if (typeof obj.text === "string") return obj.text;
  }
  return null;
}
