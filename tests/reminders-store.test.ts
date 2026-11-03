import { batch } from "@preact/signals";
import { describe, expect, it } from "vitest";
import { toLocalISO } from "../src/lib/dates";
import { presetRule } from "../src/lib/recurrence";
import { DEFAULT_PREFS } from "../src/lib/storage";
import { decodeItem, decodePrefs, decodeSeries, encodeItem, encodePrefs, encodeSeries, isDerived } from "../src/lib/sync/records";
import type { Item } from "../src/lib/types";

// Where reminders live as items become series and back, and that they
// survive the sync record format.

const stamp = toLocalISO(new Date(2026, 9, 1));
const lecture = (over: Partial<Item> = {}): Item => ({
  id: "lec",
  title: "Lecture",
  type: "starts",
  dateTime: toLocalISO(new Date(Date.now() + 2 * 86_400_000)),
  createdAt: stamp,
  updatedAt: stamp,
  source: "manual",
  ...over,
});

describe("reminders in the store", () => {
  it("moves to the series when an item starts repeating, and back when it stops", async () => {
    const store = await import("../src/state/store");
    await store.initStore({ get: async () => ({}), set: async () => {}, subscribe: () => () => {} });
    batch(() => store.addItem(store.makeRepeating(lecture({ reminders: [30] }), presetRule("weekly"), { type: "never" })));
    const s = store.series.value[0]!;
    expect(s.template.reminders).toEqual([30]);
    expect(store.items.value.every((i) => i.reminders === undefined)).toBe(true);

    store.setSeriesReminders(s.id, [60, 10]);
    expect(store.series.value[0]!.template.reminders).toEqual([60, 10]);
    store.setSeriesReminders(s.id, undefined);
    expect(store.series.value[0]!.template.reminders).toBeUndefined();

    // A new rule keeps them; no rule leaves the item a one-off with them.
    store.setSeriesReminders(s.id, [15]);
    const anchor = store.items.value.find((i) => i.id === "lec")!;
    store.changeSeriesRule(s.id, anchor, presetRule("daily"), { type: "never" });
    expect(store.series.value[0]!.template.reminders).toEqual([15]);
    store.changeSeriesRule(s.id, store.items.value.find((i) => i.id === "lec")!, null, { type: "never" });
    expect(store.items.value.find((i) => i.id === "lec")!.reminders).toEqual([15]);
  });
});

describe("reminders through sync", () => {
  it("carries an item's and a series' reminders, and the defaults", () => {
    const item = lecture({ reminders: [1440, 60] });
    expect(decodeItem(item.id, encodeItem(item), Date.now(), null)!.reminders).toEqual([1440, 60]);

    const s = { id: "s", epoch: 0, start: item.dateTime, rule: presetRule("weekly"), end: { type: "never" as const }, nextIndex: 1, template: { title: "Lab", type: "starts" as const, reminders: [30] } };
    expect(decodeSeries(s.id, encodeSeries(s), 1)!.template.reminders).toEqual([30]);

    const prefs = { ...DEFAULT_PREFS, reminders: { due: [2880], starts: [] } };
    expect(decodePrefs(encodePrefs(prefs), DEFAULT_PREFS).reminders).toEqual({ due: [2880], starts: [] });
    // Settings from a version before reminders leave this computer's alone.
    const { rd: _, ...older } = encodePrefs(DEFAULT_PREFS);
    expect(decodePrefs(older, prefs).reminders).toEqual(prefs.reminders);
  });

  it("syncs an occurrence that has reminders of its own", () => {
    const s = { id: "s", epoch: 0, start: toLocalISO(new Date(2026, 10, 2, 9)), rule: presetRule("weekly"), end: { type: "never" as const }, nextIndex: 3, template: { title: "Lab", type: "starts" as const } };
    const byId = new Map([[s.id, s]]);
    const second = { ...lecture(), id: "s~0~1", title: "Lab", seriesId: "s", dateTime: toLocalISO(new Date(2026, 10, 9, 9)) };
    expect(isDerived(second, byId)).toBe(true);
    expect(isDerived({ ...second, reminders: [5] }, byId)).toBe(false);
  });
});
