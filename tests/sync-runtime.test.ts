import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { toLocalISO } from "../src/lib/dates";
import type { StorageBackend } from "../src/lib/storage";
import type { Item } from "../src/lib/types";

// The page side of sync (src/state/sync.ts) against a stubbed Chrome: the
// real store and the real engine, with chrome.storage.local/sync in memory.

type Listener = (changes: Record<string, { newValue?: unknown }>, area: string) => void;
const listeners = new Set<Listener>();
const emit = (changes: Record<string, { newValue?: unknown }>, area: string) => {
  for (const l of listeners) queueMicrotask(() => l(structuredClone(changes), area));
};
function area(name: "local" | "sync") {
  const data = new Map<string, unknown>();
  return {
    data,
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
      emit(changes, name);
    },
    async remove(keys: string | string[]) {
      const changes: Record<string, { newValue?: unknown }> = {};
      for (const k of Array.isArray(keys) ? keys : [keys]) if (data.delete(k)) changes[k] = {};
      emit(changes, name);
    },
  };
}
const local = area("local");
const sync = area("sync");

beforeAll(() => {
  vi.stubGlobal("chrome", {
    storage: { local, sync, onChanged: { addListener: (l: Listener) => listeners.add(l), removeListener: (l: Listener) => listeners.delete(l) } },
  });
  vi.stubGlobal("navigator", { locks: { request: (_name: string, run: () => Promise<void>) => run() } });
  vi.stubGlobal("document", { addEventListener: () => {}, hidden: false });
});
afterEach(() => vi.useRealTimers());

const memory = (): StorageBackend => {
  const data: Record<string, unknown> = {};
  return { get: async () => ({ ...data }), set: async (v) => void Object.assign(data, v), subscribe: () => () => {} };
};
const flushAll = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
};

describe("sync in the page", () => {
  it("uploads this computer's list, follows edits after a second, and takes other computers' changes", async () => {
    const store = await import("../src/state/store");
    const { startSync, syncStatus } = await import("../src/state/sync");
    await store.initStore(memory());
    const stamp = toLocalISO(new Date());
    const quiz: Item = { id: "quiz-1", title: "Quiz", type: "due", dateTime: toLocalISO(new Date(Date.now() + 86_400_000)), createdAt: stamp, updatedAt: stamp, source: "manual" };
    store.addItem(quiz);
    store.flushWrites();

    await startSync();
    await flushAll();
    expect(sync.data.has("i:quiz-1")).toBe(true);
    expect(sync.data.get("v")).toBe(1);
    expect(syncStatus.value.state).toBe("ok");
    expect(local.data.has("syncBackup")).toBe(true);

    // An edit here is uploaded a second later.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    store.saveItem({ ...store.items.value[0]!, title: "Quiz 3" });
    await vi.advanceTimersByTimeAsync(1100);
    vi.useRealTimers();
    await flushAll();
    expect((sync.data.get("i:quiz-1") as { v: { n: string } }).v.n).toBe("Quiz 3");

    // Another computer adds something: it appears here.
    const rec = { t: Date.now() + 5000, v: { n: "Lab 4", s: Math.round(Date.now() / 1000) + 172_800 } };
    await sync.set({ "i:lab-4": rec });
    await flushAll();
    expect(store.items.value.map((i) => i.title).sort()).toEqual(["Lab 4", "Quiz 3"]);
  });
});
