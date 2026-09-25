// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { describe, it, expect } from "vitest";
import { parseLine, parseRunLine } from "./runStepParser";

describe("parseRunLine", () => {
  it("parses the flow header", () => {
    expect(parseRunLine(" > Flow settings-check")).toEqual({
      type: "flow",
      name: "settings-check",
    });
  });

  it("ignores On Flow Start/Complete hook headers", () => {
    expect(parseRunLine("  > On Flow Start")).toBeNull();
    expect(parseRunLine("  > On Flow Complete")).toBeNull();
  });

  it("measures depth from indentation (2 spaces per level)", () => {
    expect(parseLine("Press back... COMPLETED")).toMatchObject({ depth: 0, command: "back" });
    expect(parseLine("  Press back... COMPLETED")).toMatchObject({ depth: 1, command: "back" });
    expect(parseLine("    Press back... COMPLETED")).toMatchObject({ depth: 2, command: "back" });
  });

  it("parses container started lines (trailing ... without status)", () => {
    expect(parseLine("Run flow...")).toEqual({
      kind: "started",
      depth: 0,
      command: "runFlow",
      arg: null,
    });
    expect(parseLine("  Run flow...")).toMatchObject({ kind: "started", depth: 1 });
    expect(parseLine("Repeat 2 times...")).toMatchObject({ kind: "started", command: "repeat" });
    expect(parseLine("Retry 1 times...")).toMatchObject({ kind: "started", command: "retry" });
  });

  it("emits command:null for unrecognized descriptions (label:, unknown commands)", () => {
    expect(parseLine('Doing something weird "X"... COMPLETED')).toEqual({
      kind: "completed",
      depth: 0,
      command: null,
      arg: null,
    });
    expect(parseLine("Mon étape à moi... COMPLETED")).toMatchObject({
      kind: "completed",
      command: null,
    });
  });
});

describe("parseLine (step events)", () => {
  it("parses launchApp completed", () => {
    expect(parseLine(`Launch app "com.example"... COMPLETED`)).toEqual({
      kind: "completed",
      depth: 0,
      command: "launchApp",
      arg: "com.example",
    });
  });

  it("parses launchApp with clear-state suffix", () => {
    expect(parseLine(`Launch app "com.example" with clear state... COMPLETED`)).toMatchObject({
      command: "launchApp",
      arg: "com.example",
    });
  });

  it("parses tapOn", () => {
    expect(parseLine(`Tap on "Login"... COMPLETED`)).toMatchObject({
      kind: "completed",
      command: "tapOn",
      arg: "Login",
    });
  });

  it("parses assertVisible failed with same-line trailer (legacy format)", () => {
    expect(parseLine(`Assert that "Welcome" is visible... FAILED Element not found`)).toMatchObject(
      {
        kind: "failed",
        command: "assertVisible",
        arg: "Welcome",
        error: "Element not found",
      },
    );
  });

  it("parses assertVisible failed without trailer (2.5.x plain format)", () => {
    const ev = parseLine(`Assert that "NopeNotHere999" is visible... FAILED`);
    expect(ev).toMatchObject({ kind: "failed", command: "assertVisible", arg: "NopeNotHere999" });
    expect(ev?.error).toBeUndefined();
  });

  it("parses SKIPPED as its own kind (when: condition not met)", () => {
    expect(parseLine(`Run flow when true... SKIPPED`)).toMatchObject({
      kind: "skipped",
      command: "runFlow",
    });
  });

  it("parses inputText quoted and unquoted", () => {
    expect(parseLine(`Input text "user@example.com"... COMPLETED`)).toMatchObject({
      command: "inputText",
      arg: "user@example.com",
    });
    expect(parseLine(`Input text Alice... COMPLETED`)).toMatchObject({
      command: "inputText",
      arg: "Alice",
    });
  });

  it("parses id selectors (unquoted) for assert/tap", () => {
    expect(parseLine(`Assert that id: welcomeMessage is visible... COMPLETED`)).toMatchObject({
      command: "assertVisible",
      arg: "welcomeMessage",
    });
    expect(parseLine(`Assert that id: spinner is not visible... COMPLETED`)).toMatchObject({
      command: "assertNotVisible",
      arg: "spinner",
    });
    expect(parseLine(`Tap on id: bellNotification-pressable... COMPLETED`)).toMatchObject({
      command: "tapOn",
      arg: "bellNotification-pressable",
    });
  });

  // Real maestro 2.5.1 formats that the old pattern table never matched —
  // their gutter lines stayed uncolored forever.
  it("parses takeScreenshot with its path arg", () => {
    expect(parseLine(`Take screenshot settings_home... COMPLETED`)).toMatchObject({
      command: "takeScreenshot",
      arg: "settings_home",
    });
  });

  it("parses swipe variants", () => {
    expect(parseLine(`Swiping in LEFT direction in 400 ms... COMPLETED`)).toMatchObject({
      command: "swipe",
    });
    expect(parseLine(`Swiping in DOWN direction on "Card"... COMPLETED`)).toMatchObject({
      command: "swipe",
      arg: "Card",
    });
    expect(parseLine(`Swipe from (10%,20%) to (90%,20%) in 400 ms... COMPLETED`)).toMatchObject({
      command: "swipe",
    });
  });

  // maestro 2.8+ appends the element-relative start point (`point:`).
  it("parses swipe on an element with a relative point", () => {
    expect(parseLine(`Swiping in UP direction on "Card" at 50%,90%... COMPLETED`)).toMatchObject({
      command: "swipe",
      arg: "Card",
    });
    expect(parseLine(`Swiping in UP direction on id: card at 50%, 90%... COMPLETED`)).toMatchObject(
      {
        command: "swipe",
        arg: "card",
      },
    );
    // A quoted text that merely contains " at " is not a point suffix.
    expect(parseLine(`Swiping in UP direction on "Look at me"... COMPLETED`)).toMatchObject({
      command: "swipe",
      arg: "Look at me",
    });
  });

  // maestro 2.9 dark-mode commands.
  it("parses setDarkMode, toggleDarkMode, assertDarkMode and assertLightMode", () => {
    expect(parseLine(`Enable dark mode... COMPLETED`)).toMatchObject({ command: "setDarkMode" });
    expect(parseLine(`Disable dark mode... COMPLETED`)).toMatchObject({ command: "setDarkMode" });
    expect(parseLine(`Toggle dark mode... COMPLETED`)).toMatchObject({
      command: "toggleDarkMode",
    });
    expect(parseLine(`Assert dark mode is enabled... FAILED`)).toMatchObject({
      command: "assertDarkMode",
      kind: "failed",
    });
    expect(parseLine(`Assert dark mode is disabled... COMPLETED`)).toMatchObject({
      command: "assertLightMode",
    });
  });

  it("parses pressKey (Press {Key} key) and back (Press back)", () => {
    expect(parseLine(`Press Enter key... COMPLETED`)).toMatchObject({
      command: "pressKey",
      arg: "Enter",
    });
    expect(parseLine(`Press back... COMPLETED`)).toMatchObject({ command: "back" });
  });

  it("parses hideKeyboard's actual capitalization (Hide Keyboard)", () => {
    expect(parseLine(`Hide Keyboard... COMPLETED`)).toMatchObject({ command: "hideKeyboard" });
  });

  it("parses stopApp/killApp (unquoted) and stopRecording precedence", () => {
    expect(parseLine(`Stop com.example... COMPLETED`)).toMatchObject({
      command: "stopApp",
      arg: "com.example",
    });
    expect(parseLine(`Kill com.example... COMPLETED`)).toMatchObject({ command: "killApp" });
    expect(parseLine(`Stop recording... COMPLETED`)).toMatchObject({ command: "stopRecording" });
  });

  it("parses openLink (Open {link}, no quotes)", () => {
    expect(parseLine(`Open https://example.com... COMPLETED`)).toMatchObject({
      command: "openLink",
      arg: "https://example.com",
    });
    expect(parseLine(`Open https://example.com in browser... COMPLETED`)).toMatchObject({
      command: "openLink",
    });
  });

  it("parses eraseText, assertTrue, copyTextFrom, evalScript, runFlow file", () => {
    expect(parseLine(`Erase 5 characters... COMPLETED`)).toMatchObject({ command: "eraseText" });
    expect(parseLine(`Assert that \${output.ok} is true... COMPLETED`)).toMatchObject({
      command: "assertTrue",
    });
    expect(parseLine(`Copy text from element with "Total"... COMPLETED`)).toMatchObject({
      command: "copyTextFrom",
      arg: "Total",
    });
    expect(parseLine(`Run \${1 + 1}... COMPLETED`)).toMatchObject({ command: "evalScript" });
    expect(parseLine(`Run subflow.yaml... COMPLETED`)).toMatchObject({
      command: "runFlow",
      arg: "subflow.yaml",
    });
  });

  it("returns null for system/noise lines", () => {
    expect(parseLine(`[runner started pid 21975 · /tmp/foo.yaml]`)).toBeNull();
    expect(parseLine(`Running on iPhone 16 Pro - iOS 18.2 - 1D5972C2`)).toBeNull();
    expect(parseLine(`Assertion is false: "X" is visible`)).toBeNull();
    expect(parseLine(` Warning: Element not found: Text matching regex: X`)).toBeNull();
    expect(parseLine(`==== Debug output (logs & screenshots) ====`)).toBeNull();
    expect(parseLine(``)).toBeNull();
  });

  it("trims ANSI escape codes before matching", () => {
    expect(parseLine(`[32mLaunch app "x"... COMPLETED[0m`)).toMatchObject({
      kind: "completed",
      command: "launchApp",
      arg: "x",
    });
  });

  it("parses scrollUntilVisible Maestro 2.x verbose form", () => {
    expect(
      parseLine(
        `Scrolling DOWN until "Pour ma Box et ma TV" is visible with speed 40, visibility percentage 100%, timeout 15000 ms, with centering disabled... COMPLETED`,
      ),
    ).toMatchObject({
      kind: "completed",
      command: "scrollUntilVisible",
      arg: "Pour ma Box et ma TV",
    });
  });

  it("parses scrollUntilVisible 1.x form and plain scroll", () => {
    expect(parseLine(`Scroll until "Login" is visible... COMPLETED`)).toMatchObject({
      command: "scrollUntilVisible",
      arg: "Login",
    });
    expect(parseLine(`Scroll vertically... COMPLETED`)).toMatchObject({ command: "scroll" });
  });

  it("parses tapOn with (Optional) prefix as a regular tapOn", () => {
    expect(parseLine(`Tap on (Optional) "Accepter"... COMPLETED`)).toMatchObject({
      kind: "completed",
      command: "tapOn",
      arg: "Accepter",
    });
  });

  it("treats WARNED as completed (optional step that didn't find target)", () => {
    expect(parseLine(`Tap on (Optional) "Autoriser"... WARNED`)).toMatchObject({
      kind: "completed",
      command: "tapOn",
      arg: "Autoriser",
    });
  });
});
