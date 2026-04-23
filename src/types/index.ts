export interface Device {
  serial: string;
  model: string;
  android_version: string;
  screen_width: number;
  screen_height: number;
}

export interface Bounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface UINode {
  id: string;
  resource_id: string | null;
  text: string | null;
  content_desc: string | null;
  class_name: string;
  package: string;
  bounds: Bounds;
  clickable: boolean;
  enabled: boolean;
  focused: boolean;
  children: UINode[];
}

export interface HierarchyTree {
  root: UINode | null;
  xml_raw: string;
}

export type Selector =
  | { kind: "resourceId"; value: string }
  | { kind: "text"; value: string }
  | { kind: "contentDesc"; value: string }
  | { kind: "point"; x_pct: number; y_pct: number };

export type InputEvent =
  | { kind: "tap"; x: number; y: number }
  | {
      kind: "swipe";
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      duration_ms: number;
    }
  | { kind: "text"; text: string }
  | { kind: "key"; keycode: number };

export type MaestroAction =
  | { kind: "launchApp"; app_id: string }
  | { kind: "tapOn"; selector: Selector }
  | { kind: "inputText"; text: string }
  | { kind: "assertVisible"; selector: Selector }
  | { kind: "assertNotVisible"; selector: Selector }
  | { kind: "scroll" }
  | { kind: "scrollUntilVisible"; selector: Selector }
  | { kind: "back" }
  | { kind: "hideKeyboard" }
  | { kind: "pressKey"; key: string }
  | { kind: "waitForAnimationToEnd" };

export interface RunnerExitPayload {
  code: number;
}
