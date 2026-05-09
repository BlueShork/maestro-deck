export interface LabelInput {
  command: string;
  arg: string | null;
}

const TEMPLATES: Record<string, (arg: string | null) => string> = {
  launchApp: (a) => `Open ${a ?? "app"} app`,
  stopApp: (a) => `Stop ${a ?? "app"}`,
  tapOn: (a) => (a ? `Tap "${a}"` : "Tap"),
  longPressOn: (a) => (a ? `Long press "${a}"` : "Long press"),
  doubleTapOn: (a) => (a ? `Double tap "${a}"` : "Double tap"),
  assertVisible: (a) => (a ? `Check that "${a}" is visible` : "Check visibility"),
  assertNotVisible: (a) => (a ? `Check that "${a}" is NOT visible` : "Check absence"),
  inputText: (a) => (a ? `Type "${a}"` : "Type text"),
  openLink: (a) => (a ? `Open link ${a}` : "Open link"),
  scrollUntilVisible: (a) => (a ? `Scroll until "${a}" is visible` : "Scroll"),
  pressKey: (a) => (a ? `Press ${a} key` : "Press key"),
  scroll: () => "Scroll",
  back: () => "Press back",
  hideKeyboard: () => "Hide keyboard",
  takeScreenshot: () => "Take screenshot",
  clearState: () => "Clear app state",
  waitForAnimationToEnd: () => "Wait for animations",
};

export function humanLabel({ command, arg }: LabelInput): string {
  const t = TEMPLATES[command];
  if (t) return t(arg);
  return arg ? `${command} "${arg}"` : command;
}

export function formatDuration(ms: number | null): string {
  if (ms === null) return "";
  if (ms < 100) return "<0.1s";
  return `${(ms / 1000).toFixed(1)}s`;
}
