import { signal } from "@preact/signals";
import { REMINDER_DONE_KEY, REMINDER_DONE_SEEN_KEY } from "../lib/reminders";
import { completeFromReminder, items } from "./store";

// Reminders are on, on this computer, while Chrome lets Countdown show
// notifications: an optional permission asked for when they're switched on.
// The service worker schedules and shows them (src/background/reminders.ts),
// so they arrive with every page closed. A page switches them on and off,
// and applies "Mark done" from a notification, since only pages change the
// list.

const PERMISSION: chrome.permissions.Permissions = { permissions: ["notifications"] };
const api = typeof chrome !== "undefined" ? chrome.permissions : undefined;

export const remindersOn = signal(false);
/** Chrome said no when they were last switched on. */
export const remindersDenied = signal(false);

const isNotifications = (p: chrome.permissions.Permissions) => p.permissions?.includes("notifications") === true;

/** Reads whether reminders are on, follows changes, and applies "Mark done" from notifications in one page. */
export async function startReminders() {
  if (!api) return;
  remindersOn.value = await api.contains(PERMISSION);
  api.onAdded.addListener((p) => {
    if (!isNotifications(p)) return;
    remindersOn.value = true;
    remindersDenied.value = false;
  });
  api.onRemoved.addListener((p) => {
    if (isNotifications(p)) remindersOn.value = false;
  });
  // Held until this page closes, like sync's; the others would only repeat the work.
  void navigator.locks.request("countdown-reminders", () => new Promise<void>(() => void applyDone()));
}

/**
 * Turns reminders on or off on this computer. Call it straight from the
 * click: Chrome only asks for a permission during a user gesture.
 */
export function setRemindersOn(on: boolean) {
  if (!api) {
    // Local preview outside the extension.
    remindersOn.value = on;
    return;
  }
  if (on) {
    api.request(PERMISSION).then(
      (granted) => {
        remindersOn.value = granted;
        remindersDenied.value = !granted;
      },
      () => (remindersDenied.value = true),
    );
  } else {
    void api.remove(PERMISSION).then((removed) => {
      if (removed) remindersOn.value = false;
    });
  }
}

type Stamps = Record<string, string>;
const stamps = (v: unknown): Stamps => (typeof v === "object" && v !== null ? (v as Stamps) : {});

/**
 * Completes what was marked done from a notification, and says which ones
 * here (the worker then forgets them). An occurrence can be marked done
 * before this page has generated it; it waits until it's in the list.
 */
async function applyDone() {
  const run = async () => {
    const stored = await chrome.storage.local.get([REMINDER_DONE_KEY, REMINDER_DONE_SEEN_KEY]);
    const done = stamps(stored[REMINDER_DONE_KEY]);
    const seen = stamps(stored[REMINDER_DONE_SEEN_KEY]);
    const next: Stamps = {};
    for (const [id, at] of Object.entries(done)) {
      if (seen[id] !== at) {
        if (!items.value.some((i) => i.id === id)) continue;
        completeFromReminder(id, new Date(at));
      }
      next[id] = at;
    }
    if (JSON.stringify(next) !== JSON.stringify(seen)) await chrome.storage.local.set({ [REMINDER_DONE_SEEN_KEY]: next });
  };
  await run();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && (REMINDER_DONE_KEY in changes || "items" in changes)) void run();
  });
}
