import { describe, expect, it } from "vitest";
import { toLocalISO } from "../src/lib/dates";
import { moveBy, newRange, pointerMinutes, resizeEnd } from "../src/lib/gridEdit";
import type { Item } from "../src/lib/types";

const at = (m: number, d: number, h: number, min = 0) => new Date(2026, m - 1, d, h, min);
const iso = (m: number, d: number, h: number, min = 0) => toLocalISO(at(m, d, h, min));
const event = (start: string, end?: string): Item => ({
  id: "e",
  title: "Lecture",
  type: end ? "starts" : "due",
  dateTime: start,
  ...(end ? { endDateTime: end } : {}),
  createdAt: start,
  updatedAt: start,
  source: "manual",
});
const nov = (day: number) => ({ year: 2026, month: 10, day });

describe("moving on the grid", () => {
  it("moves by days and minutes, keeping the length and snapping to 15 minutes", () => {
    const lecture = event(iso(11, 10, 12, 30), iso(11, 10, 14));
    const moved = moveBy(lecture, 1, 52); // drag a day right and ~52 minutes down
    expect(Date.parse(moved.dateTime)).toBe(at(11, 11, 13, 15).getTime());
    expect(Date.parse(moved.endDateTime!)).toBe(at(11, 11, 14, 45).getTime());
  });

  it("moves a deadline (no end) on its own", () => {
    const due = event(iso(11, 10, 23, 59));
    const moved = moveBy(due, 0, -60);
    expect(Date.parse(moved.dateTime)).toBe(at(11, 10, 23, 0).getTime());
    expect(moved.endDateTime).toBeUndefined();
  });

  it("keeps the time of day when it hasn't moved a whole step up or down", () => {
    const odd = event(iso(11, 10, 9, 52), iso(11, 10, 10, 52));
    const sideways = moveBy(odd, 1, 5); // a wobble while dragging to the next day
    expect(Date.parse(sideways.dateTime)).toBe(at(11, 11, 9, 52).getTime());
    expect(Date.parse(moveBy(odd, 0, 15).dateTime)).toBe(at(11, 10, 10, 0).getTime());
  });

  it("lands on the wall-clock time across a daylight-saving change", () => {
    // 1 November 2026 is when North American clocks go back.
    const before = event(iso(10, 31, 9), iso(10, 31, 10));
    const moved = moveBy(before, 1, 0);
    expect(new Date(moved.dateTime).getHours()).toBe(9);
    expect(Date.parse(moved.endDateTime!) - Date.parse(moved.dateTime)).toBe(3_600_000);
  });
});

describe("changing an end", () => {
  it("snaps the end and never makes it shorter than 15 minutes", () => {
    const lecture = event(iso(11, 10, 12, 30), iso(11, 10, 14));
    expect(Date.parse(resizeEnd(lecture, nov(10), 15 * 60 + 7))).toBe(at(11, 10, 15, 0).getTime());
    expect(Date.parse(resizeEnd(lecture, nov(10), 12 * 60))).toBe(at(11, 10, 12, 45).getTime());
    expect(Date.parse(resizeEnd(lecture, nov(11), 60))).toBe(at(11, 11, 1, 0).getTime());
  });
});

describe("making an event on the grid", () => {
  it("makes an hour from a click, starting at the slot clicked", () => {
    const { start, end } = newRange(nov(10), 15 * 60 + 7);
    expect([start.getHours(), start.getMinutes(), end.getHours(), end.getMinutes()]).toEqual([15, 0, 16, 0]);
  });

  it("covers the slots a drag crossed, in either direction", () => {
    const down = newRange(nov(10), 9 * 60 + 10, 10 * 60 + 40);
    expect([down.start.getHours(), down.start.getMinutes(), down.end.getHours(), down.end.getMinutes()]).toEqual([9, 0, 10, 45]);
    const up = newRange(nov(10), 10 * 60 + 40, 9 * 60 + 10);
    expect(up.start.getTime()).toBe(down.start.getTime());
  });

  it("stays within the day", () => {
    const late = newRange(nov(10), 23 * 60 + 50);
    expect(late.end.getTime()).toBe(new Date(2026, 10, 11).getTime());
  });

  it("reads minutes from the pointer's place on the grid", () => {
    expect(pointerMinutes(48 * 9.5, 48)).toBe(570);
    expect(pointerMinutes(-20, 48)).toBe(0);
  });
});

describe("rescheduling from the calendar", () => {
  it("moves an item with Undo, and creates a not-yet-generated occurrence", async () => {
    const store = await import("../src/state/store");
    const { toast } = await import("../src/state/toast");
    const data: Record<string, unknown> = {};
    await store.initStore({ get: async () => ({ ...data }), set: async (v) => void Object.assign(data, v), subscribe: () => () => {} });
    const lecture = event(iso(11, 10, 12, 30), iso(11, 10, 14));
    store.addItem(lecture);

    store.rescheduleItem(lecture, moveBy(lecture, 0, 60), false);
    expect(new Date(store.items.value[0]!.dateTime).getHours()).toBe(13);
    expect(toast.value?.message).toMatch(/^Moved to /);
    toast.value!.action!.run();
    expect(new Date(store.items.value[0]!.dateTime).getHours()).toBe(12);

    const occurrence = { ...event(iso(11, 17, 12, 30), iso(11, 17, 14)), id: "s~0~5", seriesId: "s", createdAt: "" };
    store.rescheduleItem(occurrence, { dateTime: iso(11, 17, 15), endDateTime: iso(11, 17, 16, 30) }, true);
    const made = store.items.value.find((i) => i.id === "s~0~5")!;
    expect(new Date(made.dateTime).getHours()).toBe(15);
    expect(made.createdAt).not.toBe("");
    toast.value!.action!.run();
    expect(store.items.value.some((i) => i.id === "s~0~5")).toBe(false);
  });
});
