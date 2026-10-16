import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { IS_MAC, setShortcutsSuppressed, useShortcuts, type ShortcutBinding } from "./keyboard";

function Bind({ bindings }: { bindings: ShortcutBinding[] }) {
  useShortcuts(bindings);
  return (
    <div>
      <input aria-label="field" />
      <div contentEditable suppressContentEditableWarning aria-label="editor" />
    </div>
  );
}

const mod = IS_MAC ? { metaKey: true } : { ctrlKey: true };

function press(init: ConstructorParameters<typeof KeyboardEvent>[1], target: EventTarget = window) {
  const e = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(e);
  return e;
}

afterEach(() => {
  setShortcutsSuppressed(false);
  cleanup();
});

describe("useShortcuts", () => {
  it("fires the binding matching key and modifiers, case-insensitively, and prevents the default", () => {
    const run = vi.fn();
    const save = vi.fn();
    render(
      <Bind
        bindings={[
          { key: "r", mod: true, handler: run },
          { key: "s", mod: true, shift: true, handler: save },
        ]}
      />,
    );
    const e = press({ key: "R", ...mod });
    expect(run).toHaveBeenCalledOnce();
    expect(e.defaultPrevented).toBe(true);
    press({ key: "s", shiftKey: true, ...mod });
    expect(save).toHaveBeenCalledOnce();
  });

  it("requires the exact modifier set", () => {
    const run = vi.fn();
    render(<Bind bindings={[{ key: "r", mod: true, handler: run }]} />);
    press({ key: "r" });
    press({ key: "r", shiftKey: true, ...mod });
    press({ key: "r", altKey: true, ...mod });
    expect(run).not.toHaveBeenCalled();
  });

  it("does not fire while typing in a field unless allowed", () => {
    const inspect = vi.fn();
    const save = vi.fn();
    const { getByLabelText } = render(
      <Bind
        bindings={[
          { key: "i", handler: inspect },
          { key: "s", mod: true, handler: save, allowInInput: true },
        ]}
      />,
    );
    press({ key: "i" }, getByLabelText("field"));
    press({ key: "i" }, getByLabelText("editor"));
    expect(inspect).not.toHaveBeenCalled();
    press({ key: "s", ...mod }, getByLabelText("editor"));
    expect(save).toHaveBeenCalledOnce();
  });

  it("a held key fires once, not on every auto-repeat", () => {
    const inspect = vi.fn();
    render(<Bind bindings={[{ key: "i", handler: inspect }]} />);
    press({ key: "i" });
    press({ key: "i", repeat: true });
    press({ key: "i", repeat: true });
    expect(inspect).toHaveBeenCalledOnce();
  });

  it("ignores keys that are part of an IME composition", () => {
    const inspect = vi.fn();
    render(<Bind bindings={[{ key: "i", handler: inspect }]} />);
    press({ key: "i", isComposing: true });
    expect(inspect).not.toHaveBeenCalled();
  });

  it("is silenced while a full page covers the workspace", () => {
    const run = vi.fn();
    render(<Bind bindings={[{ key: "r", mod: true, handler: run }]} />);
    setShortcutsSuppressed(true);
    press({ key: "r", ...mod });
    expect(run).not.toHaveBeenCalled();
    setShortcutsSuppressed(false);
    press({ key: "r", ...mod });
    expect(run).toHaveBeenCalledOnce();
  });

  it("only the first matching binding fires", () => {
    const a = vi.fn();
    const b = vi.fn();
    render(
      <Bind
        bindings={[
          { key: "x", handler: a },
          { key: "x", handler: b },
        ]}
      />,
    );
    press({ key: "x" });
    expect(a).toHaveBeenCalledOnce();
    expect(b).not.toHaveBeenCalled();
  });

  it("stops listening on unmount", () => {
    const run = vi.fn();
    const { unmount } = render(<Bind bindings={[{ key: "r", mod: true, handler: run }]} />);
    unmount();
    press({ key: "r", ...mod });
    expect(run).not.toHaveBeenCalled();
  });
});
