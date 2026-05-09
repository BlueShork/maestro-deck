import { parseFlow } from "./flowAst";

export interface PartialFlow {
  content: string;
  lineMap: Map<number, number>;
  firstStepOriginalLine: number;
}

export function buildPartialFlow(source: string, fromLine: number): PartialFlow | null {
  const ast = parseFlow(source);
  if (ast.steps.length === 0) return null;

  const target = ast.steps.find((s) => s.line >= fromLine);
  if (!target) return null;

  const sourceLines = source.split("\n");
  const lastSeparatorIdx = findLastSeparator(sourceLines, target.line);

  const preambleLines: string[] =
    lastSeparatorIdx >= 0 ? sourceLines.slice(0, lastSeparatorIdx + 1) : [];

  const bodyStartIdx = target.line - 1;
  const bodyLines = sourceLines.slice(bodyStartIdx);

  const contentLines = [...preambleLines, ...bodyLines];
  const content = contentLines.join("\n");

  const lineMap = new Map<number, number>();
  for (let i = 0; i < preambleLines.length; i++) {
    lineMap.set(i + 1, i + 1);
  }
  for (let i = 0; i < bodyLines.length; i++) {
    lineMap.set(preambleLines.length + i + 1, bodyStartIdx + i + 1);
  }

  return {
    content,
    lineMap,
    firstStepOriginalLine: target.line,
  };
}

function findLastSeparator(sourceLines: string[], targetLine: number): number {
  for (let i = targetLine - 2; i >= 0; i--) {
    if (sourceLines[i].trim() === "---") return i;
  }
  return -1;
}
