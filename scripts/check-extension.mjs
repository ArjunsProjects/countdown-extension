// End-to-end check of the built extension before an upload: loads dist/ into
// headless Chrome (over a DevTools pipe, since Chrome ignores --load-extension)
// and drives the service worker, the offscreen page and the toolbar icon.
// Run with `npm run check:extension` after a build. Exits non-zero on failure.
import { spawn } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = new URL("../", import.meta.url).pathname;
const DIST = join(ROOT, "dist");
const expected = JSON.parse(readFileSync(join(ROOT, "public/manifest.json"), "utf8"));
const profile = mkdtempSync(join(tmpdir(), "countdown-check-"));
const granted = mkdtempSync(join(tmpdir(), "countdown-granted-"));
const chrome = spawn(process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ["--headless=new", "--disable-gpu", `--user-data-dir=${profile}`, "--remote-debugging-pipe", "--enable-unsafe-extension-debugging", "about:blank"],
  { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] });

let id = 0, buf = "";
const waiting = new Map(), events = [];
chrome.stdio[4].on("data", (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf("\0")) >= 0) {
    const msg = JSON.parse(buf.slice(0, i));
    buf = buf.slice(i + 1);
    if (msg.id && waiting.has(msg.id)) { waiting.get(msg.id)(msg); waiting.delete(msg.id); } else events.push(msg);
  }
});
const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
  const m = { id: ++id, method, params, ...(sessionId && { sessionId }) };
  waiting.set(m.id, (r) => (r.error ? rej(new Error(`${method}: ${r.error.message}`)) : res(r.result)));
  chrome.stdio[3].write(JSON.stringify(m) + "\0");
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = "") => results.push({ ok, line: `${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}` });

try {
  const { id: extId } = await send("Extensions.loadUnpacked", { path: DIST });
  await sleep(1500);
  const find = async (part) => (await send("Target.getTargets")).targetInfos.find((t) => t.url.includes(extId) && t.url.includes(part));
  const attach = async (t) => (await send("Target.attachToTarget", { targetId: t.targetId, flatten: true })).sessionId;
  const run = async (session, expr) => {
    const r = await send("Runtime.evaluate", { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true }, session);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  };

  const sw = await find("service-worker.js");
  check("service worker running", !!sw);
  const swS = await attach(sw);
  await send("Runtime.enable", {}, swS);
  const manifest = await run(swS, `return chrome.runtime.getManifest()`);
  check("version and permissions match public/manifest.json",
    manifest.version === expected.version && JSON.stringify(manifest.permissions) === JSON.stringify(expected.permissions),
    `${manifest.version}, ${manifest.permissions.join(" ")}`);

  const offscreen = await find("offscreen/index.html");
  check("dark-mode watcher created on install", !!offscreen);
  const offS = await attach(offscreen);
  const scheme = async (value) => {
    await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value }] }, offS);
    await sleep(5500); // the hidden page re-checks every 5 s
    return run(swS, `return (await chrome.storage.session.get("toolbarDark")).toolbarDark`);
  };
  check("light toolbar reaches the worker", (await scheme("light")) === false);

  const state = () => run(swS, `return { badge: await chrome.action.getBadgeText({}), title: await chrome.action.getTitle({}),
    alarm: (await chrome.alarms.get("toolbar-icon"))?.scheduledTime ?? null, bg: await chrome.action.getBadgeBackgroundColor({}) }`);
  let s = await state();
  check("no items: resting icon, no badge, no alarm", s.badge === "" && s.title === "Open Countdown" && s.alarm === null, s.title);

  const now = Date.now(), D = 864e5;
  await run(swS, `await chrome.storage.local.set({ items: [
    { id: "a", title: "Assignment 3", type: "due", dateTime: new Date(${now + 2 * D + 3600e3}).toISOString(), createdAt: new Date(${now - 2 * D}).toISOString(), updatedAt: "x", source: "manual" },
    { id: "b", title: "Done", type: "due", dateTime: new Date(${now + D}).toISOString(), createdAt: "x", updatedAt: "x", source: "manual", completedAt: "x" } ] })`);
  await sleep(700);
  s = await state();
  check("next item: badge and title", s.badge === "2d" && s.title === "Countdown: Assignment 3 due in 2 days", `${s.badge} · ${s.title}`);
  check("redraw alarm scheduled", s.alarm !== null && s.alarm > now);
  check("badge in Indigo's light accent", JSON.stringify(s.bg) === "[52,81,209,255]", JSON.stringify(s.bg));

  await run(swS, `await chrome.storage.local.set({ prefs: { unit: "days", theme: "system", palette: "lagoon", liveIcon: true } })`);
  await sleep(700);
  check("theme change recolours the badge", JSON.stringify((await state()).bg) === "[10,99,120,255]");

  check("dark toolbar reaches the worker", (await scheme("dark")) === true);
  check("badge switches to the dark-mode accent", JSON.stringify((await state()).bg) === "[127,211,230,255]");

  await run(swS, `await chrome.storage.local.set({ prefs: { unit: "days", theme: "system", palette: "lagoon", liveIcon: false } })`);
  await sleep(700);
  s = await state();
  check("live icon off: no badge, no alarm", s.badge === "" && s.alarm === null);

  // Reminders: off until Chrome allows notifications, which is optional, so never at install.
  const off = await run(swS, `return { allowed: await chrome.permissions.contains({ permissions: ["notifications"] }),
    optional: chrome.runtime.getManifest().optional_permissions ?? [], alarm: (await chrome.alarms.get("reminders")) ?? null }`);
  check("reminders off until notifications are allowed", !off.allowed && off.optional.includes("notifications") && off.alarm === null, off.optional.join(" "));

  // A copy with the permission already given (headless Chrome can't click Allow) shows a real reminder.
  cpSync(DIST, granted, { recursive: true });
  const m = JSON.parse(readFileSync(join(granted, "manifest.json"), "utf8"));
  m.permissions.push("notifications");
  delete m.optional_permissions;
  writeFileSync(join(granted, "manifest.json"), JSON.stringify(m));
  const { id: grantedId } = await send("Extensions.loadUnpacked", { path: granted });
  await sleep(1500);
  const sw2 = (await send("Target.getTargets")).targetInfos.find((t) => t.url.includes(grantedId) && t.url.includes("service-worker.js"));
  const sw2S = await attach(sw2);
  await send("Runtime.enable", {}, sw2S);
  const goesOff = Date.now() + 4000;
  await run(sw2S, `await chrome.storage.local.set({ items: [{ id: "r", title: "Lab report", type: "due", dateTime: new Date(${goesOff + 3600e3}).toISOString(),
    reminders: [60], createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", source: "manual" }] })`);
  await sleep(700);
  const alarmAt = await run(sw2S, `return (await chrome.alarms.get("reminders"))?.scheduledTime ?? null`);
  check("reminder alarm set for an hour before", alarmAt !== null && Math.abs(alarmAt - goesOff) < 1500, alarmAt && `in ${Math.round((alarmAt - Date.now()) / 1000)} s`);
  let notes = [];
  for (let waited = 0; waited < 45_000 && !notes.includes("reminder:r"); waited += 1000) {
    await sleep(1000);
    notes = await run(sw2S, `return Object.keys(await chrome.notifications.getAll())`);
  }
  check("reminder shows as a notification", notes.includes("reminder:r"), notes.join(" ") || "none");

  const errors = events.filter((e) => e.method === "Runtime.exceptionThrown" || (e.method === "Runtime.consoleAPICalled" && e.params.type === "error"));
  check("no errors in the workers", errors.length === 0, errors.map((e) => JSON.stringify(e.params).slice(0, 160)).join(" | "));
} catch (error) {
  results.push({ ok: false, line: `ERROR  ${error.message}` });
} finally {
  console.log(results.map((r) => r.line).join("\n"));
  const exited = new Promise((r) => chrome.once("exit", r));
  chrome.kill();
  await exited;
  rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
  rmSync(granted, { recursive: true, force: true, maxRetries: 3 });
  if (results.some((r) => !r.ok)) process.exitCode = 1;
}
