import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { snapshotOf } from "@/test/snapshot";
import type { Selector, UINode } from "@/types";

const h = vi.hoisted(() => ({ generateCommand: vi.fn() }));
vi.mock("@/lib/ipc", () => ({ ipc: { generateCommand: h.generateCommand } }));

import { useFlowStore } from "@/stores/flowStore";
import { toast } from "@/stores/toastStore";

import { InspectActionMenu } from "./InspectActionMenu";

const NODE: UINode = {
  id: "1",
  resource_id: "com.app:id/login_button",
  text: "Log in",
  content_desc: null,
  class_name: "android.widget.Button",
  package: "com.app",
  bounds: { left: 0, top: 0, right: 100, bottom: 40 },
  clickable: true,
  enabled: true,
  focused: false,
  children: [],
};
const SELECTORS: Selector[] = [
  { kind: "resourceId", value: "com.app:id/login_button" },
  { kind: "text", value: "Log in" },
  { kind: "point", x_pct: 50, y_pct: 12.4 },
];

const onClose = vi.fn();
const toastError = vi.spyOn(toast, "error");

function mount(selectors = SELECTORS) {
  return render(
    <InspectActionMenu x={20} y={30} node={NODE} selectors={selectors} onClose={onClose} />,
  );
}

const item = (name: RegExp) => screen.getByRole("menuitem", { name });

beforeEach(() => {
  vi.useRealTimers();
  onClose.mockClear();
  toastError.mockClear();
  h.generateCommand
    .mockReset()
    .mockImplementation(async (a: { kind: string; selector: Selector }) => {
      const v = "value" in a.selector ? a.selector.value : `${a.selector.x_pct}%`;
      return `- ${a.kind}:\n    id: "${v}"\n`;
    });
  useFlowStore.setState({
    content: "appId: com.app\n---\n- launchApp\n",
    cursorLine: 1,
    dirty: false,
  });
});
afterEach(cleanup);

describe("InspectActionMenu", () => {
  it("names the element and previews the recommended selector", () => {
    mount();
    expect(screen.getByText('"Log in"')).toBeTruthy();
    expect(screen.getByText("id login_button")).toBeTruthy();
  });

  it("a click inserts the action with the best selector and closes", async () => {
    mount();
    await act(async () => fireEvent.click(item(/^Tap/)));
    expect(h.generateCommand).toHaveBeenCalledWith({ kind: "tapOn", selector: SELECTORS[0] });
    expect(useFlowStore.getState().content).toContain(
      '- tapOn:\n    id: "com.app:id/login_button"',
    );
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("a double click inserts the action only once", async () => {
    let release!: (t: string) => void;
    h.generateCommand.mockReturnValue(new Promise((r) => (release = r)));
    mount();
    fireEvent.click(item(/^Assert visible/));
    fireEvent.click(item(/^Assert visible/));
    await act(async () => release("- assertVisible: x\n"));
    expect(h.generateCommand).toHaveBeenCalledTimes(1);
    expect(useFlowStore.getState().content.match(/assertVisible/g)).toHaveLength(1);
  });

  it("hovering an action opens every selector, and picking one uses it", async () => {
    vi.useFakeTimers();
    mount();
    fireEvent.mouseEnter(item(/^Assert not visible/).closest("li")!);
    act(() => vi.advanceTimersByTime(150));
    expect(screen.getByText("recommended")).toBeTruthy();
    vi.useRealTimers();
    await act(async () => fireEvent.click(screen.getByRole("menuitem", { name: /text "Log in"/ })));
    expect(h.generateCommand).toHaveBeenCalledWith({
      kind: "assertNotVisible",
      selector: SELECTORS[1],
    });
  });

  it("leaving before the hover delay opens nothing", () => {
    vi.useFakeTimers();
    mount();
    const li = item(/^Tap/).closest("li")!;
    fireEvent.mouseEnter(li);
    act(() => vi.advanceTimersByTime(100));
    fireEvent.mouseLeave(li);
    act(() => vi.advanceTimersByTime(500));
    expect(screen.queryByText("recommended")).toBeNull();
  });

  it("ArrowRight opens the flyout, ArrowLeft closes it", () => {
    mount();
    fireEvent.keyDown(item(/^Tap/), { key: "ArrowRight" });
    expect(screen.getByText("recommended")).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("menuitem", { name: /recommended/ }), { key: "ArrowLeft" });
    expect(screen.queryByText("recommended")).toBeNull();
  });

  it("Escape closes the flyout first, then the menu — once", () => {
    mount();
    fireEvent.keyDown(item(/^Tap/), { key: "ArrowRight" });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByText("recommended")).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("closes on a click outside, not inside", () => {
    mount();
    fireEvent.pointerDown(item(/^Tap/));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.pointerDown(document.body);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("without selectors every action is disabled", () => {
    mount([]);
    expect((item(/^Tap/) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("—")).toBeTruthy();
  });

  it("a single selector inserts directly with no flyout", () => {
    mount([SELECTORS[1]]);
    expect(item(/^Tap/).getAttribute("aria-haspopup")).toBeNull();
    fireEvent.keyDown(item(/^Tap/), { key: "ArrowRight" });
    expect(screen.queryByText("recommended")).toBeNull();
  });

  it("reports a generation failure and still closes", async () => {
    h.generateCommand.mockRejectedValue(new Error("unsupported selector"));
    mount();
    await act(async () => fireEvent.click(item(/^Tap/)));
    expect(toastError).toHaveBeenCalledWith("Generation failed", "unsupported selector");
    expect(useFlowStore.getState().dirty).toBe(false);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("snapshot", () => {
    const { container } = mount();
    expect(snapshotOf(container.firstElementChild)).toMatchSnapshot();
  });
});
