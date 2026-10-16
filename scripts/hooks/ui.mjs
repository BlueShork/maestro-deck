// Terminal UI for the git hooks: the Maestro Deck banner and a live
// checklist. Everything goes to stderr because git redirects hook stdout
// there anyway.

const out = process.stderr;
const color = out.isTTY && !process.env.NO_COLOR;
const live = out.isTTY && !process.env.CI;

const esc = (code) => (color ? `\x1b[${code}m` : "");
const RESET = esc(0);
const BOLD = esc(1);
const DIM = esc(2);
const GREEN = esc(32);
const RED = esc(31);
const YELLOW = esc(33);
const CYAN = esc(36);

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const fg = ([r, g, b]) => esc(`38;2;${r};${g};${b}`);
const bg = ([r, g, b]) => esc(`48;2;${r};${g};${b}`);

// Same five bands as public/icon.svg, top to bottom.
const BANDS = [
  [0, "#FFD800"],
  [4, "#FFAF00"],
  [7, "#FF8205"],
  [10, "#FA500F"],
  [13, "#E10500"],
].map(([from, h]) => [from, hex(h)]);
const bandColor = (row) => BANDS.filter(([from]) => row >= from).pop()[1];

// public/icon.svg without its dark tile: a 16x16 ring with a 6x6 core.
const ICON = [
  "..############..",
  ".##############.",
  "################",
  "###..........###",
  "###..........###",
  "###..######..###",
  "###..######..###",
  "###..######..###",
  "###..######..###",
  "###..######..###",
  "###..######..###",
  "###..........###",
  "###..........###",
  "################",
  ".##############.",
  "..############..",
];

const GLYPHS = {
  M: ["#...#", "##.##", "#.#.#", "#.#.#", "#...#", "#...#", "#...#"],
  A: [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  E: ["#####", "#....", "#....", "####.", "#....", "#....", "#####"],
  S: [".####", "#....", "#....", ".###.", "....#", "....#", "####."],
  T: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."],
  R: ["####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#"],
  O: [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  D: ["####.", "#...#", "#...#", "#...#", "#...#", "#...#", "####."],
  C: [".####", "#....", "#....", "#....", "#....", "#....", ".####"],
  K: ["#...#", "#..#.", "#.#..", "##...", "#.#..", "#..#.", "#...#"],
};

const word = (text) =>
  GLYPHS.M.map((_, row) => [...text].map((ch) => GLYPHS[ch][row]).join("."));

// 16 pixel rows, like the icon: MAESTRO, a 2-row gap, DECK.
const blank = (w) => ".".repeat(w);
const TITLE = [...word("MAESTRO"), blank(1), blank(1), ...word("DECK")];

// Two pixel rows per terminal line with half blocks.
function halfBlocks(bitmap) {
  const lines = [];
  for (let y = 0; y < bitmap.length; y += 2) {
    const top = bitmap[y];
    const bottom = bitmap[y + 1] ?? "";
    const width = Math.max(top.length, bottom.length);
    let line = "";
    for (let x = 0; x < width; x++) {
      const t = top[x] === "#";
      const b = bottom[x] === "#";
      const ct = bandColor(y);
      const cb = bandColor(y + 1);
      if (t && b) line += ct === cb || !color ? `${fg(ct)}█` : `${fg(ct)}${bg(cb)}▀`;
      else if (t) line += `${fg(ct)}▀`;
      else if (b) line += `${fg(cb)}▄`;
      else line += " ";
      line += RESET;
    }
    lines.push(line);
  }
  return lines;
}

export function printBanner(hook, count) {
  const icon = halfBlocks(ICON);
  const title = halfBlocks(TITLE);
  out.write("\n");
  icon.forEach((line, i) => out.write(`  ${line}   ${title[i]}\n`));
  out.write(`\n  ${DIM}${hook} · ${count} check${count > 1 ? "s" : ""}${RESET}\n\n`);
}

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const LABEL_WIDTH = 18;

const seconds = (ms) => `${(ms / 1000).toFixed(1)}s`;

function formatRow(check, frame) {
  const label = check.label.padEnd(LABEL_WIDTH);
  switch (check.status) {
    case "pending":
      return `  ${DIM}·  ${label}waiting${RESET}`;
    case "running":
      return `  ${CYAN}${SPINNER[frame % SPINNER.length]}${RESET}  ${label}${DIM}${check.hint ?? ""}${RESET}`;
    case "passed":
      return `  ${GREEN}✔${RESET}  ${label}${DIM}${[check.detail, seconds(check.ms)].filter(Boolean).join(" · ")}${RESET}`;
    case "failed":
      return `  ${RED}✖${RESET}  ${BOLD}${label}${RESET}${RED}${[check.detail ?? "failed", seconds(check.ms)].join(" · ")}${RESET}`;
    case "skipped":
      return `  ${DIM}○  ${label}skipped · ${check.reason}${RESET}`;
  }
}

// Draws the list in place on a TTY, or prints each row once settled elsewhere.
export function createChecklist(checks) {
  let frame = 0;
  let drawn = false;
  let timer = null;

  const draw = () => {
    if (!live) return;
    if (drawn) out.write(`\x1b[${checks.length}A`);
    for (const c of checks) out.write(`\r\x1b[2K${formatRow(c, frame)}\n`);
    drawn = true;
  };

  const restoreCursor = () => live && out.write("\x1b[?25h");

  return {
    start() {
      if (live) {
        out.write("\x1b[?25l");
        process.once("exit", restoreCursor);
        timer = setInterval(() => {
          frame++;
          draw();
        }, 80);
      }
      draw();
    },
    update: draw,
    stop() {
      clearInterval(timer);
      if (live) draw();
      else for (const c of checks) out.write(`${formatRow(c, 0)}\n`);
      restoreCursor();
    },
  };
}

export function printSummary(checks, ms) {
  const failed = checks.filter((c) => c.status === "failed");
  for (const c of failed) {
    out.write(`\n${RED}${BOLD}── ${c.label} ${"─".repeat(Math.max(0, 50 - c.label.length))}${RESET}\n`);
    out.write(`${c.output.trimEnd() || "(no output)"}\n`);
  }
  out.write("\n");
  if (failed.length === 0) {
    out.write(`  ${GREEN}${BOLD}✔ All checks passed${RESET} ${DIM}in ${seconds(ms)}${RESET}\n\n`);
  } else {
    const n = failed.length;
    out.write(`  ${RED}${BOLD}✖ ${n} check${n > 1 ? "s" : ""} failed${RESET} ${DIM}in ${seconds(ms)}${RESET}\n`);
    out.write(`  ${YELLOW}Fix the issues above, or bypass once with --no-verify.${RESET}\n\n`);
  }
}
