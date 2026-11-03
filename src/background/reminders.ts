import { toLocalISO } from "../lib/dates";
import { topUp } from "../lib/recurrence";
import {
  dueReminders,
  MAX_AT_ONCE,
  nextReminder,
  REMINDER_DONE_KEY,
  REMINDER_DONE_SEEN_KEY,
  REMINDER_STATE_KEY,
  reminderMessage,
  SNOOZE_MS,
  snoozedDue,
  summaryMessage,
  type ReminderData,
} from "../lib/reminders";
import { parseItems, parsePrefs, parseSeries } from "../lib/storage";
import { FORMAT_VERSION, merge, skipSet, VERSION_KEY, type LocalState, type Meta, type Rec } from "../lib/sync/merge";
import type { Item } from "../lib/types";

// Reminders, from the service worker, so they come with every Countdown page
// closed. The worker never changes the list: "Mark done" is recorded under
// its own key and applied by the next page that opens (see state/reminders.ts).
// Reminders are on while Chrome lets Countdown show notifications, an
// optional permission a page asks for when they're switched on.

export const REMINDER_ALARM = "reminders";
const PERMISSION: chrome.permissions.Permissions = { permissions: ["notifications"] };
const NOTE = "reminder:";
const MORE = "reminder-more";
const ICON = "icons/icon-128.png";

interface State {
  /** Reminders up to this moment have been shown. */
  lastCheck: number;
  /** Item id → when its snooze ends. */
  snoozed: Record<string, number>;
}

type Stamps = Record<string, string>;

const stamps = (v: unknown): Stamps =>
  typeof v === "object" && v !== null ? Object.fromEntries(Object.entries(v).filter(([, t]) => typeof t === "string")) : {};

function parseState(v: unknown, now: number): State {
  const o = (typeof v === "object" && v !== null ? v : {}) as Partial<State>;
  const snoozed = typeof o.snoozed === "object" && o.snoozed !== null ? o.snoozed : {};
  return {
    lastCheck: typeof o.lastCheck === "number" && o.lastCheck <= now ? o.lastCheck : now,
    snoozed: Object.fromEntries(Object.entries(snoozed).filter(([, t]) => typeof t === "number")),
  };
}

/** Other computers' changes from Chrome sync, merged in memory only (the page that runs sync stores them). */
async function withSynced(meta: Meta, state: LocalState, now: number): Promise<LocalState> {
  try {
    const all = await chrome.storage.sync.get(null);
    if (typeof all[VERSION_KEY] === "number" && all[VERSION_KEY] > FORMAT_VERSION) return state;
    const remote = new Map<string, Rec | undefined>(Object.entries(all) as [string, Rec][]);
    for (const key of Object.keys(meta.regs)) if (!remote.has(key)) remote.set(key, undefined);
    return merge(meta, state, remote, now).state;
  } catch (error) {
    console.error("Countdown: reminders couldn't read sync", error);
    return state;
  }
}

/**
 * The list as Countdown will have it when it next opens: this computer's,
 * plus what other computers have synced, plus the occurrences series go on
 * to generate. So a deadline completed or moved elsewhere doesn't remind you
 * here, and a weekly lecture keeps reminding while Countdown stays closed.
 */
async function load(now: number) {
  const local = await chrome.storage.local.get(["items", "series", "prefs", "syncMeta", "syncEnabled", REMINDER_STATE_KEY, REMINDER_DONE_KEY, REMINDER_DONE_SEEN_KEY]);
  let list: LocalState = { items: parseItems(local.items), series: parseSeries(local.series), categories: [], prefs: parsePrefs(local.prefs) };
  const meta = local.syncMeta as Meta | undefined;
  if (local.syncEnabled !== false && meta?.joined) list = await withSynced(meta, list, now);
  const items = [...list.items];
  const skip = meta?.regs ? skipSet(meta) : new Set<string>();
  for (const s of list.series) {
    // Not made or changed by anyone, so their reminders all count.
    for (const added of topUp(s, items, now, skip).added) items.push({ ...added, updatedAt: s.start });
  }
  const done = stamps(local[REMINDER_DONE_KEY]);
  return {
    items,
    data: { items, series: list.series, defaults: list.prefs.reminders, done: new Set(Object.keys(done)) } satisfies ReminderData,
    state: parseState(local[REMINDER_STATE_KEY], now),
    done,
    seen: stamps(local[REMINDER_DONE_SEEN_KEY]),
  };
}

async function notify(due: Item[], now: number) {
  const iconUrl = chrome.runtime.getURL(ICON);
  for (const item of due.slice(0, MAX_AT_ONCE)) {
    await chrome.notifications.create(NOTE + item.id, {
      type: "basic",
      iconUrl,
      title: item.title,
      message: reminderMessage(item, now),
      buttons: [{ title: "Mark done" }, { title: "Snooze 10 min" }],
      priority: 1,
    });
  }
  const rest = due.slice(MAX_AT_ONCE);
  if (rest.length) {
    await chrome.notifications.create(MORE, {
      type: "basic",
      iconUrl,
      title: `${rest.length} more reminder${rest.length === 1 ? "" : "s"}`,
      message: summaryMessage(rest),
      priority: 0,
    });
  }
}

/** Shows what's due since the last check, takes away notifications for things done or gone, and sets the next alarm. */
async function check() {
  if (!(await chrome.permissions.contains(PERMISSION))) {
    await chrome.alarms.clear(REMINDER_ALARM);
    return;
  }
  if (!chrome.notifications) {
    // Just allowed, and this worker started without the API: come back once it has restarted with it.
    await chrome.alarms.create(REMINDER_ALARM, { when: Date.now() + 60_000 });
    return;
  }
  const now = Date.now();
  const { items, data, state, done, seen } = await load(now);
  const byId = new Map(items.map((i) => [i.id, i]));
  const back = snoozedDue(data, state.snoozed, now);
  const due = [...new Map([...dueReminders(data, state.lastCheck, now), ...back].map((i) => [i.id, i])).values()];
  await notify(due, now);

  for (const id of Object.keys(await chrome.notifications.getAll())) {
    if (!id.startsWith(NOTE)) continue;
    const item = byId.get(id.slice(NOTE.length));
    if (!item || item.completedAt || data.done.has(item.id)) await chrome.notifications.clear(id);
  }

  const snoozed = Object.fromEntries(Object.entries(state.snoozed).filter(([id, until]) => until > now && byId.has(id)));
  const next = nextReminder(data, now, snoozed);
  if (next === null) await chrome.alarms.clear(REMINDER_ALARM);
  else await chrome.alarms.create(REMINDER_ALARM, { when: next });

  // A "Mark done" the page has applied (or whose item is gone) is finished with.
  const pending = Object.fromEntries(Object.entries(done).filter(([id, at]) => seen[id] !== at && byId.has(id)));
  await chrome.storage.local.set({
    [REMINDER_STATE_KEY]: { lastCheck: now, snoozed } satisfies State,
    ...(Object.keys(pending).length !== Object.keys(done).length ? { [REMINDER_DONE_KEY]: pending } : {}),
  });
}

// Checks and button presses read and write the same keys, so they run one at a time.
let queue = Promise.resolve();
function serially(task: () => Promise<void>) {
  queue = queue.then(task).catch((error: unknown) => console.error("Countdown: reminders", error));
  return queue;
}

/** Runs a check soon; a burst of changes (a sync, a quick run of edits) shares one. */
let queued = false;
export function checkReminders() {
  if (queued) return queue;
  queued = true;
  return serially(() => {
    queued = false;
    return check();
  });
}

/** Reminders were just switched on: start from now, rather than everything that came before. */
export function remindersAllowed() {
  listen();
  return serially(async () => {
    const stored = await chrome.storage.local.get(REMINDER_STATE_KEY);
    await chrome.storage.local.set({ [REMINDER_STATE_KEY]: { ...parseState(stored[REMINDER_STATE_KEY], Date.now()), lastCheck: Date.now() } });
    await check();
  });
}

export const remindersRemoved = () => serially(() => chrome.alarms.clear(REMINDER_ALARM).then(() => undefined));

function pressed(id: string, button: number) {
  if (!id.startsWith(NOTE)) return;
  const itemId = id.slice(NOTE.length);
  void serially(async () => {
    await chrome.notifications.clear(id);
    if (button === 0) {
      const stored = await chrome.storage.local.get(REMINDER_DONE_KEY);
      await chrome.storage.local.set({ [REMINDER_DONE_KEY]: { ...stamps(stored[REMINDER_DONE_KEY]), [itemId]: toLocalISO(new Date()) } });
    } else {
      const stored = await chrome.storage.local.get(REMINDER_STATE_KEY);
      const state = parseState(stored[REMINDER_STATE_KEY], Date.now());
      state.snoozed[itemId] = Date.now() + SNOOZE_MS;
      await chrome.storage.local.set({ [REMINDER_STATE_KEY]: state });
    }
    await check();
  });
}

function clicked(id: string) {
  if (!id.startsWith(NOTE) && id !== MORE) return;
  // The side panel only opens in answer to a user action, so this comes before anything else.
  // If Chrome doesn't count the click as one, the calendar opens in a tab instead.
  chrome.sidePanel
    .open({ windowId: chrome.windows.WINDOW_ID_CURRENT })
    .catch(() => chrome.tabs.create({ url: chrome.runtime.getURL("sidepanel/index.html?tab") }));
  void chrome.notifications.clear(id);
}

let listening = false;
/**
 * Notification events. chrome.notifications only exists while the
 * permission is granted, so this runs at startup and again when it's given.
 */
export function listen() {
  if (listening || !chrome.notifications) return;
  listening = true;
  chrome.notifications.onButtonClicked.addListener(pressed);
  chrome.notifications.onClicked.addListener(clicked);
}
