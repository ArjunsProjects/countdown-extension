import { drawSweepIcon } from "../lib/drawIcon";
import { paletteById } from "../lib/palettes";
import { parseItems, parsePrefs } from "../lib/storage";
import { REMINDER_DONE_KEY, REMINDER_DONE_SEEN_KEY } from "../lib/reminders";
import { iconState } from "../lib/toolbarIcon";
import { checkReminders, listen, REMINDER_ALARM, remindersAllowed, remindersRemoved } from "./reminders";

// Service workers stop when idle, so nothing lives in variables: every event
// reads what it needs from storage, and the redraw time is an alarm.
// Listeners are registered at the top level so Chrome can replay them.

const ALARM = "toolbar-icon";
const OFFSCREEN_URL = "offscreen/index.html";
/** chrome.storage.session key: is the toolbar in dark mode? Set by the offscreen page. */
const TOOLBAR_DARK = "toolbarDark";

// Clicking the toolbar icon opens the side panel instead of a popup.
async function openOnClick() {
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch (error) {
    console.error("Countdown: could not set panel behavior", error);
  }
}

/**
 * Background scripts can't read prefers-color-scheme, so a tiny hidden page
 * (allowed for exactly this, reason MATCH_MEDIA) watches it and reports back.
 * It needs the "offscreen" permission, which shows no install warning.
 */
async function ensureSchemeWatcher() {
  try {
    if (await chrome.offscreen.hasDocument()) return;
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_URL,
      reasons: [chrome.offscreen.Reason.MATCH_MEDIA],
      justification: "Match the toolbar icon to Chrome's light or dark mode.",
    });
  } catch (error) {
    // Racing creates throw "Only a single offscreen document may be created"; that's fine.
    if (!String(error).includes("single offscreen")) console.error("Countdown: could not watch the color scheme", error);
  }
}

/** Redraws the toolbar icon from what's stored, and schedules the next redraw. */
async function refreshIcon() {
  const [local, session] = await Promise.all([
    chrome.storage.local.get(["items", "prefs", REMINDER_DONE_KEY]),
    chrome.storage.session.get(TOOLBAR_DARK),
  ]);
  // Marked done from a reminder: done, even before a page applies it.
  const done = new Set(Object.keys((local[REMINDER_DONE_KEY] as object | undefined) ?? {}));
  const prefs = parsePrefs(local.prefs);
  const palette = paletteById(prefs.palette);
  const dark = session[TOOLBAR_DARK] === true;
  const mode = dark ? palette.dark : palette.light;
  const now = Date.now();
  const items = parseItems(local.items).map((i) => (done.has(i.id) && !i.completedAt ? { ...i, completedAt: new Date(now).toISOString() } : i));
  const state = iconState(items, now, prefs.liveIcon);

  const imageData: Record<string, ImageData> = {};
  for (const size of [16, 32]) {
    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext("2d")!;
    drawSweepIcon(ctx, size, { mode, dark, solid: palette.solid, sweep: state.sweep });
    imageData[size] = ctx.getImageData(0, 0, size, size);
  }
  await chrome.action.setIcon({ imageData });
  await chrome.action.setTitle({ title: state.title });
  await chrome.action.setBadgeText({ text: state.badge });
  if (state.badge) {
    // The palette's accent, readable on the toolbar it sits on.
    await chrome.action.setBadgeBackgroundColor({ color: mode.accent });
    await chrome.action.setBadgeTextColor({ color: dark ? "#0d0f1a" : "#ffffff" });
  }

  if (state.refreshAt === null) await chrome.alarms.clear(ALARM);
  else await chrome.alarms.create(ALARM, { when: state.refreshAt });
}

// Overlapping triggers (several storage writes at once) collapse into one
// redraw, plus one more if something changed while it ran. These flags only
// coordinate an in-flight redraw; nothing here needs to survive a restart.
let running = false;
let again = false;
async function scheduleRefresh() {
  if (running) {
    again = true;
    return;
  }
  running = true;
  try {
    do {
      again = false;
      await refreshIcon();
    } while (again);
  } catch (error) {
    console.error("Countdown: could not update the toolbar icon", error);
  } finally {
    running = false;
  }
}

const start = () => {
  openOnClick();
  ensureSchemeWatcher();
  scheduleRefresh();
  // Includes reminders missed while Chrome was closed, for things still to come.
  checkReminders();
};

listen();

chrome.runtime.onInstalled.addListener(start);
chrome.runtime.onStartup.addListener(start);

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) scheduleRefresh();
  if (alarm.name === REMINDER_ALARM) checkReminders();
});

// Reminders are switched on and off by granting or removing the notifications permission.
chrome.permissions.onAdded.addListener((p) => {
  if (p.permissions?.includes("notifications")) remindersAllowed();
});
chrome.permissions.onRemoved.addListener((p) => {
  if (p.permissions?.includes("notifications")) remindersRemoved();
});

// Items, theme or the live-icon setting changed (from any panel), or the toolbar's scheme did.
// Reminders also follow series and other computers' changes as they arrive.
chrome.storage.onChanged.addListener((changes, area) => {
  const local = area === "local";
  if ((local && ("items" in changes || "prefs" in changes || REMINDER_DONE_KEY in changes)) || (area === "session" && TOOLBAR_DARK in changes)) {
    scheduleRefresh();
  }
  const listChanged = ["items", "series", "prefs", "syncEnabled", REMINDER_DONE_KEY, REMINDER_DONE_SEEN_KEY].some((k) => k in changes);
  if ((local && listChanged) || area === "sync") checkReminders();
});

chrome.runtime.onMessage.addListener((message: unknown) => {
  if (typeof message === "object" && message !== null && (message as { type?: unknown }).type === "toolbar-scheme") {
    const dark = (message as { dark?: unknown }).dark === true;
    chrome.storage.session.set({ [TOOLBAR_DARK]: dark });
  }
});
