// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { describe, it, expect } from "vitest";
import { parseLine } from "./runStepParser";

describe("parseLine", () => {
  it("parses launchApp completed", () => {
    expect(parseLine(`Launch app "com.example"... COMPLETED`)).toEqual({
      kind: "completed",
      command: "launchApp",
      arg: "com.example",
    });
  });

  it("parses launchApp started (no suffix)", () => {
    expect(parseLine(`Launch app "com.example"...`)).toEqual({
      kind: "started",
      command: "launchApp",
      arg: "com.example",
    });
  });

  it("parses tapOn", () => {
    expect(parseLine(`Tap on "Login"... COMPLETED`)).toEqual({
      kind: "completed",
      command: "tapOn",
      arg: "Login",
    });
  });

  it("parses assertVisible failed", () => {
    expect(parseLine(`Assert that "Welcome" is visible... FAILED`)).toMatchObject({
      kind: "failed",
      command: "assertVisible",
      arg: "Welcome",
    });
  });

  it("parses inputText", () => {
    expect(parseLine(`Input text "user@example.com"... COMPLETED`)).toEqual({
      kind: "completed",
      command: "inputText",
      arg: "user@example.com",
    });
  });

  // Maestro's ElementSelector.description() renders a `text:` selector quoted
  // (`"Welcome"`) but an `id:` selector unquoted (`id: welcomeMessage`). The
  // parser must capture the id value for both `assertVisible` and `tapOn`, else
  // id-based steps never get a status (gutter stays uncolored).
  it("parses assertVisible with an id selector (unquoted)", () => {
    expect(parseLine(`Assert that id: welcomeMessage is visible... COMPLETED`)).toEqual({
      kind: "completed",
      command: "assertVisible",
      arg: "welcomeMessage",
    });
  });

  it("parses assertNotVisible with an id selector", () => {
    expect(parseLine(`Assert that id: spinner is not visible... COMPLETED`)).toMatchObject({
      command: "assertNotVisible",
      arg: "spinner",
    });
  });

  it("parses tapOn with an id selector (unquoted)", () => {
    expect(parseLine(`Tap on id: bellNotification-pressable... COMPLETED`)).toEqual({
      kind: "completed",
      command: "tapOn",
      arg: "bellNotification-pressable",
    });
  });

  it("parses inputText unquoted (Maestro description form)", () => {
    expect(parseLine(`Input text Alice... COMPLETED`)).toEqual({
      kind: "completed",
      command: "inputText",
      arg: "Alice",
    });
  });

  it("returns null for system lines", () => {
    expect(parseLine(`[runner started pid 21975 · /tmp/foo.yaml]`)).toBeNull();
    expect(parseLine(`Running on R3CX30GR07Y`)).toBeNull();
    expect(parseLine(` > Flow Untitled`)).toBeNull();
    expect(parseLine(``)).toBeNull();
  });

  it("returns null for unknown commands", () => {
    expect(parseLine(`Doing something weird "X"... COMPLETED`)).toBeNull();
  });

  it("trims ANSI escape codes before matching", () => {
    expect(parseLine(`[32mLaunch app "x"... COMPLETED[0m`)).toEqual({
      kind: "completed",
      command: "launchApp",
      arg: "x",
    });
  });

  it("parses scrollUntilVisible Maestro 2.x verbose form (Scrolling DOWN until ...)", () => {
    expect(
      parseLine(
        `Scrolling DOWN until "Pour ma Box et ma TV" is visible with speed 40, visibility percentage 100%, timeout 15000 ms, with centering disabled... COMPLETED`,
      ),
    ).toEqual({
      kind: "completed",
      command: "scrollUntilVisible",
      arg: "Pour ma Box et ma TV",
    });
  });

  it("parses scrollUntilVisible UP / LEFT / RIGHT directions", () => {
    expect(parseLine(`Scrolling UP until "Top" is visible... COMPLETED`)).toMatchObject({
      command: "scrollUntilVisible",
      arg: "Top",
    });
    expect(parseLine(`Scrolling LEFT until "Prev" is visible... COMPLETED`)).toMatchObject({
      command: "scrollUntilVisible",
      arg: "Prev",
    });
  });

  it("parses scrollUntilVisible Maestro 1.x form (Scroll until ...)", () => {
    expect(parseLine(`Scroll until "Login" is visible... COMPLETED`)).toEqual({
      kind: "completed",
      command: "scrollUntilVisible",
      arg: "Login",
    });
  });

  it("parses tapOn with (Optional) prefix as a regular tapOn", () => {
    expect(parseLine(`Tap on (Optional) "Accepter"... COMPLETED`)).toEqual({
      kind: "completed",
      command: "tapOn",
      arg: "Accepter",
    });
  });

  it("treats WARNED as completed (optional step that didn't find target)", () => {
    expect(parseLine(`Tap on (Optional) "Autoriser"... WARNED`)).toEqual({
      kind: "completed",
      command: "tapOn",
      arg: "Autoriser",
    });
  });
});
