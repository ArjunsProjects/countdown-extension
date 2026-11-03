import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { toLocalISO } from "../src/lib/dates";
import { encodeItem } from "../src/lib/sync/records";
import type { Item } from "../src/lib/types";

// The service worker's reminders (src/background/reminders.ts) against a
// stubbed Chrome: storage, alarms, notifications and the permission, with
// the clock moved by hand.

const store = () => {
  const data = new Map<string, unknown>();
  return {
    data,
    async get(keys?: string | string[] | null) {
      const wanted = keys == null ? [...data.keys()] : Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(wanted.filter((k) => data.has(k)).map((k) => [k, structuredClone(data.get(k))]));
    },
    async set(values: Record<string, unknown>) {
      for (const [k, v] of Object.entries(values)) data.set(k, structuredClone(v));
    },
  };
};
const local = store();
const sync = store();
const alarms = new Map<string, number>();
const shown = new Map<string, chrome.notifications.NotificationOptions>();
const pressed: ((id: string, button: number) => void)[] = [];
const clicked: ((id: string) => void)[] = [];
let granted = false;
const sidePanel = { open: vi.fn(async (_: { windowId: number }) => {}) };
const tabs = { create: vi.fn(async (_: { url: string }) => ({})) };

beforeAll(() => {
  vi.stubGlobal("chrome", {
    storage: { local, sync },
    alarms: {
      create: async (name: string, info: { when: number }) => void alarms.set(name, info.when),
      clear: async (name: string) => alarms.delete(name),
    },
    permissions: { contains: async () => granted },
    runtime: { getURL: (path: string) => `chrome-extension://countdown/${path}` },
    notifications: {
      create: async (id: string, options: chrome.notifications.NotificationOptions) => void shown.set(id, options),
      clear: async (id: string) => shown.delete(id),
      getAll: async () => Object.fromEntries([...shown.keys()].map((id) => [id, true])),
      onButtonClicked: { addListener: (f: (id: string, button: number) => void) => pressed.push(f) },
      onClicked: { addListener: (f: (id: string) => void) => clicked.push(f) },
    },
    sidePanel,
    tabs,
    windows: { WINDOW_ID_CURRENT: -2 },
  });
  vi.useFakeTimers({ toFake: ["Date"] });
});
afterAll(() => vi.useRealTimers());

const at = (m: number, d: number, h = 0, min = 0) => new Date(2026, m - 1, d, h, min).getTime();
const MIN = 60_000;
const made = toLocalISO(new Date(2026, 9, 1));
const deadline = (id: string, title: string, due: number): Item => ({
  id,
  title,
  type: "due",
  dateTime: toLocalISO(new Date(due)),
  createdAt: made,
  updatedAt: made,
  source: "manual",
});

describe("reminders in the service worker", () => {
  it("stays quiet without the permission, then reminds, snoozes and marks done", async () => {
    const r = await import("../src/background/reminders");
    r.listen();
    await local.set({ items: [deadline("a", "Assignment 3", at(11, 10, 23, 59))] });

    vi.setSystemTime(at(11, 9, 12));
    await r.checkReminders();
    expect(alarms.has(r.REMINDER_ALARM)).toBe(false);
    expect(shown.size).toBe(0);

    // Switched on: nothing from before now, the next one scheduled (defaults: 1 day and 1 hour before).
    granted = true;
    await r.remindersAllowed();
    expect(alarms.get(r.REMINDER_ALARM)).toBe(at(11, 9, 23, 59));

    vi.setSystemTime(at(11, 9, 23, 59) + 20_000);
    await r.checkReminders();
    const note = shown.get("reminder:a")!;
    expect(note.title).toBe("Assignment 3");
    expect(note.message).toBe("Due in 1 day · Tue 10 Nov, 11:59 PM");
    expect(note.buttons?.map((b) => b.title)).toEqual(["Mark done", "Snooze 10 min"]);
    expect(alarms.get(r.REMINDER_ALARM)).toBe(at(11, 10, 22, 59));

    // Snooze: it goes, and comes back in 10 minutes.
    pressed[0]!("reminder:a", 1);
    await r.checkReminders();
    expect(shown.has("reminder:a")).toBe(false);
    expect(alarms.get(r.REMINDER_ALARM)).toBe(at(11, 9, 23, 59) + 20_000 + 10 * MIN);
    vi.setSystemTime(at(11, 10, 0, 10) + 20_000);
    await r.checkReminders();
    expect(shown.has("reminder:a")).toBe(true);

    // Mark done: recorded for a page to apply; no more reminders for it.
    pressed[0]!("reminder:a", 0);
    await r.checkReminders();
    const done = local.data.get("reminderDone") as Record<string, string>;
    expect(Object.keys(done)).toEqual(["a"]);
    expect(shown.has("reminder:a")).toBe(false);
    expect(alarms.has(r.REMINDER_ALARM)).toBe(false);

    // A page applied it and said so: the worker lets it go.
    await local.set({ items: [{ ...deadline("a", "Assignment 3", at(11, 10, 23, 59)), completedAt: done.a }], reminderDoneSeen: done });
    await r.checkReminders();
    expect(local.data.get("reminderDone")).toEqual({});
  });

  it("leaves out what another computer completed, even before a page has merged it", async () => {
    const r = await import("../src/background/reminders");
    const quiz = deadline("q", "Quiz 2", at(11, 20, 10));
    await local.set({ items: [quiz], syncMeta: { v: 1, clock: 0, joined: true, regs: {}, derived: [] } });

    vi.setSystemTime(at(11, 19, 10) + 20_000);
    await r.checkReminders();
    expect(shown.has("reminder:q")).toBe(true);
    await shown.delete("reminder:q");

    const elsewhere = Date.now();
    await sync.set({ v: 1, "i:q": { t: elsewhere, v: encodeItem(quiz), ct: elsewhere, c: toLocalISO(new Date(elsewhere)) } });
    vi.setSystemTime(at(11, 20, 9) + 20_000);
    await r.checkReminders();
    expect(shown.has("reminder:q")).toBe(false);
  });

  it("tries again in a minute if the API isn't there yet, just after it was allowed", async () => {
    const r = await import("../src/background/reminders");
    const api = (chrome as unknown as Record<string, unknown>).notifications;
    delete (chrome as unknown as Record<string, unknown>).notifications;
    await r.checkReminders();
    expect(alarms.get(r.REMINDER_ALARM)).toBe(Date.now() + 60_000);
    (chrome as unknown as Record<string, unknown>).notifications = api;
  });

  it("opens Countdown from a click, in a tab if the side panel can't open", async () => {
    clicked[0]!("reminder:a");
    expect(sidePanel.open).toHaveBeenCalledWith({ windowId: -2 });
    sidePanel.open.mockRejectedValueOnce(new Error("needs a user gesture"));
    clicked[0]!("reminder:a");
    await vi.waitFor(() => expect(tabs.create).toHaveBeenCalledWith({ url: "chrome-extension://countdown/sidepanel/index.html?tab" }));
  });
});
