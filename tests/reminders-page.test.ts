import { beforeAll, describe, expect, it, vi } from "vitest";
import { toLocalISO } from "../src/lib/dates";
import type { StorageBackend } from "../src/lib/storage";
import type { Item } from "../src/lib/types";

// The page side of reminders (src/state/reminders.ts): the switch is the
// notifications permission, and "Mark done" from a notification, recorded
// by the worker, is applied to the real store once and acknowledged.

type Listener = (changes: Record<string, { newValue?: unknown }>, area: string) => void;
const listeners = new Set<Listener>();
const data = new Map<string, unknown>();
const local = {
  async get(keys?: string | string[] | null) {
    const wanted = keys == null ? [...data.keys()] : Array.isArray(keys) ? keys : [keys];
    return Object.fromEntries(wanted.filter((k) => data.has(k)).map((k) => [k, structuredClone(data.get(k))]));
  },
  async set(values: Record<string, unknown>) {
    const changes: Record<string, { newValue?: unknown }> = {};
    for (const [k, v] of Object.entries(values)) {
      data.set(k, structuredClone(v));
      changes[k] = { newValue: structuredClone(v) };
    }
    for (const l of listeners) queueMicrotask(() => l(changes, "local"));
  },
};
let granted = false;
const request = vi.fn(async () => (granted = true));

beforeAll(() => {
  vi.stubGlobal("chrome", {
    storage: { local, onChanged: { addListener: (l: Listener) => listeners.add(l) } },
    permissions: {
      contains: async () => granted,
      request,
      remove: async () => !(granted = false),
      onAdded: { addListener: () => {} },
      onRemoved: { addListener: () => {} },
    },
  });
  vi.stubGlobal("navigator", { locks: { request: (_name: string, run: () => Promise<void>) => run() } });
});

const memory = (): StorageBackend => {
  const stored: Record<string, unknown> = {};
  return { get: async () => ({ ...stored }), set: async (v) => void Object.assign(stored, v), subscribe: () => () => {} };
};
const settle = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
};

describe("reminders in the page", () => {
  it("switches on through Chrome's permission, and applies Mark done once", async () => {
    const store = await import("../src/state/store");
    const reminders = await import("../src/state/reminders");
    await store.initStore(memory());
    const stamp = toLocalISO(new Date(2026, 9, 1));
    const lab: Item = { id: "lab", title: "Lab report", type: "due", dateTime: toLocalISO(new Date(Date.now() + 86_400_000)), createdAt: stamp, updatedAt: stamp, source: "manual" };
    store.addItem(lab);

    await reminders.startReminders();
    expect(reminders.remindersOn.value).toBe(false);
    reminders.setRemindersOn(true);
    expect(request).toHaveBeenCalledWith({ permissions: ["notifications"] });
    await settle();
    expect(reminders.remindersOn.value).toBe(true);

    // The worker records "Mark done"; this page completes the item and says so.
    const at = toLocalISO(new Date());
    await local.set({ reminderDone: { lab: at } });
    await settle();
    expect(store.items.value[0]!.completedAt).toBe(at);
    expect(store.completions.value).toHaveLength(1);
    expect(data.get("reminderDoneSeen")).toEqual({ lab: at });

    // Undone afterwards: it stays undone, even while the worker still has the entry.
    store.uncompleteItem("lab");
    await settle();
    expect(store.items.value[0]!.completedAt).toBeUndefined();
    // Not done drops its completion record, and nothing completes it again.
    expect(store.completions.value).toHaveLength(0);
  });
});
