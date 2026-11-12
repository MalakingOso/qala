// End-to-end check of the desktop program editor's LS++ checks, Format and dry run,
// in a real Chromium. Run `bun run build:wasm` first, then:
//
//   node apps/web/e2e/program_editor.mjs
//
// It starts its own Vite dev server on a free port and stops it at the end. Set
// QALA_WEB_URL to test a server that is already running instead (no server is started).
// SHOT=/path/to/file.png saves the screenshot of an editor with a diagnostic showing.
// PLAYWRIGHT_CORE and CHROME_PATH override where playwright-core and Chromium are found;
// by default it looks in ~/.npm/_npx and ~/.cache/ms-playwright, where they already live.

import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const webDir = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(import.meta.url);

function findPlaywright() {
  if (process.env.PLAYWRIGHT_CORE) return process.env.PLAYWRIGHT_CORE;
  const npx = join(homedir(), ".npm/_npx");
  for (const d of existsSync(npx) ? readdirSync(npx) : []) {
    const p = join(npx, d, "node_modules/playwright-core");
    if (existsSync(p)) return p;
  }
  throw new Error("playwright-core not found; set PLAYWRIGHT_CORE");
}

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const root = join(homedir(), ".cache/ms-playwright");
  const dirs = (existsSync(root) ? readdirSync(root) : [])
    .filter((d) => /^chromium-\d+$/.test(d))
    .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
  for (const d of dirs) {
    const p = join(root, d, "chrome-linux64/chrome");
    if (existsSync(p)) return p;
  }
  throw new Error("Chromium not found; set CHROME_PATH");
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

async function startVite() {
  const port = await freePort();
  const proc = spawn(
    "npx",
    ["vite", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
    { cwd: webDir, stdio: "ignore", detached: true },
  );
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(url)).ok) return { url, stop: () => process.kill(-proc.pid) };
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  process.kill(-proc.pid);
  throw new Error("vite did not start");
}

const { chromium } = require(findPlaywright());

let failures = 0;
function ok(name) {
  console.log(`ok   ${name}`);
}
function check(cond, name, detail = "") {
  if (cond) return ok(name);
  failures++;
  console.log(`FAIL ${name} ${detail}`);
}

const server = process.env.QALA_WEB_URL
  ? { url: process.env.QALA_WEB_URL, stop() {} }
  : await startVite();
const base = `${server.url}/#/desktop/programs`;
const shot = process.env.SHOT ?? join(tmpdir(), "program-editor-diagnostic.png");

const browser = await chromium.launch({
  executablePath: findChrome(),
  args: ["--no-sandbox"],
});
try {
  const newPage = async (context) => {
    const page = await context.newPage();
    page.pageErrors = [];
    page.on("pageerror", (e) => page.pageErrors.push(e.message));
    await page.goto(base);
    await page.locator(".cm-content").waitFor({ timeout: 15000 });
    return page;
  };
  const docText = (page) =>
    page.locator(".cm-line").allInnerTexts().then((l) => l.join("\n"));
  const status = (page) => page.locator(".editor-status .pill");
  const replaceText = async (page, text) => {
    await page.locator(".cm-content").click();
    await page.keyboard.press("Control+A");
    await page.keyboard.type(text);
  };

  const context = await browser.newContext({
    viewport: { width: 1440, height: 1100 },
  });

  // 1. The sample opens clean, and the dry run plays it forward.
  let page = await newPage(context);
  await status(page).filter({ hasText: "No errors" }).waitFor({ timeout: 15000 });
  ok("sample program opens with no errors");
  check(
    await page.locator(".issue-list").count() === 0,
    "no problem list for a clean program",
  );
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await page.locator(".dry-summary").waitFor();
  const summary = await page.locator(".dry-summary").innerText();
  check(
    summary.includes("2 sessions") && summary.includes("2 sets waiting for a weight"),
    "dry run summary counts sessions and blank sets",
    summary,
  );
  const dryText = await page.locator(".dry-sessions").innerText();
  check(
    dryText.includes("Week 1 · Day 1: Lower A") &&
      dryText.includes("3x5 @ 245 lb") && dryText.includes("2x10, weight to set"),
    "dry run lists the sessions, sets and the blank weight",
    dryText,
  );
  await page.locator(".dry-final summary").click();
  check(
    (await page.locator(".dry-final pre").innerText()).includes("250lb"),
    "dry run shows the progressed program",
  );
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("\n");
  await page.getByText("The program changed since this run").waitFor();
  ok("dry run marks itself stale after an edit");
  check(page.pageErrors.length === 0, "no page errors on the clean path", page.pageErrors.join("; "));
  await page.close();

  // 1b. Text that parses but looks wrong gets a lint warning, not an error.
  page = await newPage(context);
  await status(page).filter({ hasText: "No errors" }).waitFor({ timeout: 15000 });
  await replaceText(page, "# Week 1\n## Day 1\nSquat / 31x5 100lb");
  await page.locator(".cm-lintRange-warning").first().waitFor({ timeout: 10000 });
  ok("a lint warning gets an inline mark");
  check(
    (await status(page).first().innerText()).includes("1 warning"),
    "status pill counts the warning",
    await status(page).first().innerText(),
  );
  check(
    (await page.locator(".cm-lintRange-error").count()) === 0 &&
      (await page.locator(".issue-list .issue.warning").count()) === 1,
    "the warning is listed once and nothing is called an error",
  );
  await page.close();

  // 2. A broken program gets an inline mark, a list entry with position and fix idea.
  page = await newPage(context);
  await status(page).filter({ hasText: "No errors" }).waitFor({ timeout: 15000 });
  await replaceText(page, "Squat / 3x");
  await page.locator(".cm-lintRange-error").first().waitFor({ timeout: 10000 });
  ok("a broken line gets an inline error mark");
  const entry = page.locator(".issue-list .issue").first();
  await entry.waitFor();
  const entryText = await entry.innerText();
  check(entryText.includes("1:10"), "list entry gives line and column", entryText);
  check(entryText.includes("rep count"), "list entry gives the fix suggestion", entryText);
  check(
    (await status(page).first().innerText()).includes("error"),
    "status pill counts the errors",
  );
  await page.locator(".cm-lintRange-error").first().hover();
  await page.locator(".cm-tooltip-lint").waitFor({ timeout: 5000 });
  check(
    (await page.locator(".cm-tooltip-lint").innerText()).includes("Fix:"),
    "the tooltip carries the fix suggestion too",
  );
  const panel = await page.locator(".editor-split > .card").first().boundingBox();
  await page.screenshot({
    path: shot,
    clip: {
      x: Math.max(0, panel.x - 12),
      y: Math.max(0, panel.y - 12),
      width: panel.width + 24,
      height: Math.min(panel.height + 24, 900),
    },
  });
  ok(`screenshot saved to ${shot}`);

  // 3. Format refuses text with syntax errors and leaves it alone.
  await page.mouse.move(0, 0);
  await page.getByRole("button", { name: "Format", exact: true }).click();
  await page.getByText("Can't format yet").waitFor();
  check((await docText(page)) === "Squat / 3x", "Format leaves a program with syntax errors alone");
  check(page.pageErrors.length === 0, "no page errors on the error path", page.pageErrors.join("; "));
  await page.close();

  // 4. Format tidies a messy but valid program, and says so once it is tidy.
  page = await newPage(context);
  await status(page).filter({ hasText: "No errors" }).waitFor({ timeout: 15000 });
  await replaceText(page, "Squat/3x5   100lb");
  await status(page).filter({ hasText: "No errors" }).waitFor({ timeout: 10000 });
  await page.getByRole("button", { name: "Format", exact: true }).click();
  await page.getByText("Formatted.").waitFor();
  const formatted = await docText(page);
  check(formatted.startsWith("Squat / 3x5 100lb"), "Format normalizes spacing", JSON.stringify(formatted));
  await page.getByRole("button", { name: "Format", exact: true }).click();
  await page.getByText("Already formatted.").waitFor();
  ok("a second Format reports it is already formatted");
  await page.keyboard.press("Control+Z");
  check(
    (await docText(page)).startsWith("Squat/3x5   100lb"),
    "Format is one undo step",
    JSON.stringify(await docText(page)),
  );
  await page.close();

  // 5. With the wasm unreachable the editor still edits and says the checks are off.
  const offline = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  await offline.route("**/wasm/**", (route) => route.abort());
  page = await newPage(offline);
  await status(page).filter({ hasText: "LS++ checks unavailable" }).waitFor({ timeout: 15000 });
  ok("a wasm that fails to load turns the checks off quietly");
  await replaceText(page, "Squat / 3x");
  check((await docText(page)) === "Squat / 3x", "the editor still takes text");
  check(
    await page.getByRole("button", { name: "Format", exact: true }).isDisabled(),
    "Format is disabled without the wasm",
  );
  check(page.pageErrors.length === 0, "no page errors when the wasm fails to load", page.pageErrors.join("; "));
  await offline.close();
  await context.close();
} finally {
  await browser.close();
  server.stop();
}

if (failures > 0) {
  console.log(`${failures} check(s) failed`);
  process.exit(1);
}
console.log("program editor e2e passed");
