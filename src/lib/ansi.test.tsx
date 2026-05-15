// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { renderAnsi } from "./ansi";

const ESC = String.fromCharCode(27);
const render = (line: string) => renderToStaticMarkup(renderAnsi(line) as never);

describe("renderAnsi", () => {
  it("renders plain text without ANSI as a single tail span", () => {
    const html = render("hello world");
    expect(html).toBe('<span class="">hello world</span>');
  });

  it("returns empty fragment for empty input", () => {
    expect(render("")).toBe("");
  });

  it("applies foreground color class for known SGR code", () => {
    const html = render(`${ESC}[31mred${ESC}[0m`);
    expect(html).toContain('class="text-red-400"');
    expect(html).toContain("red");
  });

  it("resets style on code 0", () => {
    const html = render(`${ESC}[31mred${ESC}[0mplain`);
    expect(html).toContain('class="text-red-400"');
    expect(html).toContain('class=""');
    expect(html).toContain("plain");
  });

  it("ignores unknown SGR codes (keeps current style)", () => {
    const html = render(`${ESC}[31m${ESC}[99mstill-red`);
    expect(html).toContain('class="text-red-400"');
    expect(html).toContain("still-red");
  });

  it("handles compound codes separated by ;", () => {
    const html = render(`${ESC}[1;32mok`);
    expect(html).toContain('class="text-emerald-400"');
  });

  it("emits text before the first escape with no class", () => {
    const html = render(`prefix${ESC}[31mred`);
    expect(html).toContain('<span class="">prefix</span>');
    expect(html).toContain('class="text-red-400"');
  });

  it("is reentrant — repeated calls don't share regex state", () => {
    const a = render(`${ESC}[31mA`);
    const b = render(`${ESC}[32mB`);
    expect(a).toContain("text-red-400");
    expect(a).toContain("A");
    expect(b).toContain("text-emerald-400");
    expect(b).toContain("B");
  });
});
