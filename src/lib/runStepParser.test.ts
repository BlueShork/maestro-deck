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
});
