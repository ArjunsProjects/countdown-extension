import { describe, expect, it } from "vitest";
import { allDayLanes, eventsInRange, layoutDay, onDay, rangeLabel, rangeLabelShort, segmentsForDay, stepAnchor, viewDays, type CalEvent } from "../src/lib/agenda";
import { toLocalISO } from "../src/lib/dates";
import { presetRule, type Series } from "../src/lib/recurrence";
import type { Item } from "../src/lib/types";

const local = (y: number, m: number, d: number, h = 0, min = 0) => toLocalISO(new Date(y, m - 1, d, h, min));
const t = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min).getTime();
const item = (id: string, start: string, end?: string, extra: Partial<Item> = {}): Item => ({
  id,
  title: id,
  type: end ? "starts" : "due",
  dateTime: start,
  ...(end ? { endDateTime: end } : {}),
  createdAt: "",
  updatedAt: "",
  source: "manual",
  ...extra,
});
const ids = (events: readonly CalEvent[]) => events.map((e) => e.id);
const nov = (day: number) => ({ year: 2026, month: 10, day });

describe("what falls in a range", () => {
  it("includes moments in the range and events that touch it", () => {
    const items = [
      item("before", local(2026, 11, 9, 23)),
      item("due", local(2026, 11, 10, 9)),
      item("overnight", local(2026, 11, 9, 22), local(2026, 11, 10, 2)),
      item("after", local(2026, 11, 11, 0)),
    ];
    expect(ids(eventsInRange(items, [], t(2026, 11, 10), t(2026, 11, 11)))).toEqual(["overnight", "due"]);
  });

  it("adds a series' later occurrences from its rule, without doubling stored ones", () => {
    const s: Series = {
      id: "s",
      epoch: 0,
      start: local(2026, 11, 3, 12, 30),
      rule: presetRule("weekly"),
      end: { type: "never" },
      template: { title: "Lecture", type: "starts", duration: 90, location: "Swing Space" },
      categoryId: "cs",
      nextIndex: 2,
    };
    // Occurrence 1 was generated and is stored; 0 was removed; 2+ aren't generated yet.
    const stored = item("s~0~1", local(2026, 11, 10, 12, 30), local(2026, 11, 10, 14), { seriesId: "s" });
    const events = eventsInRange([stored], [s], t(2026, 11, 1), t(2026, 12, 1));
    // Tuesdays 3, 10, 17, 24 November (1 December is outside the range).
    expect(ids(events)).toEqual(["s~0~1", "s~0~2", "s~0~3"]);
    const virtual = events[1]!;
    expect(virtual.virtual).toBe(true);
    expect(virtual.end - virtual.start).toBe(90 * 60_000);
    expect(virtual.item).toMatchObject({ location: "Swing Space", categoryId: "cs", seriesId: "s", title: "Lecture" });
  });

  it("stops a series at its end", () => {
    const s: Series = {
      id: "s",
      epoch: 0,
      start: local(2026, 11, 3, 9),
      rule: presetRule("daily"),
      end: { type: "count", count: 3 },
      template: { title: "Sprint", type: "starts" },
      nextIndex: 0,
    };
    expect(eventsInRange([], [s], t(2026, 11, 1), t(2026, 12, 1))).toHaveLength(3);
  });

  it("lets an all-day event cover its days", () => {
    const trip = item("trip", local(2026, 11, 10), local(2026, 11, 13), { allDay: true, type: "starts" });
    const events = eventsInRange([trip], [], t(2026, 11, 1), t(2026, 12, 1));
    expect([9, 10, 12, 13].map((d) => onDay(events[0]!, nov(d)))).toEqual([false, true, true, false]);
  });
});

describe("views", () => {
  it("shows a day, three days from the anchor, a Sunday-first week, or a month grid", () => {
    expect(viewDays("day", nov(11))).toEqual([nov(11)]);
    expect(viewDays("days3", nov(11))).toEqual([nov(11), nov(12), nov(13)]);
    expect(viewDays("week", nov(11))[0]).toEqual(nov(8));
    expect(viewDays("week", nov(11))).toHaveLength(7);
    expect(viewDays("month", nov(11))).toHaveLength(42);
  });

  it("steps by the view's length", () => {
    expect(stepAnchor("days3", nov(11), 1)).toEqual(nov(14));
    expect(stepAnchor("week", nov(11), -1)).toEqual(nov(4));
    expect(stepAnchor("month", { year: 2026, month: 0, day: 31 }, 1)).toEqual({ year: 2026, month: 1, day: 28 });
  });

  it("labels the range", () => {
    expect(rangeLabel("day", nov(10))).toBe("Tuesday, 10 November 2026");
    expect(rangeLabel("days3", nov(10))).toBe("10 – 12 November 2026");
    expect(rangeLabel("days3", nov(29))).toBe("29 November – 1 December 2026");
    expect(rangeLabel("week", { year: 2026, month: 11, day: 31 })).toBe("27 December 2026 – 2 January 2027");
    expect(rangeLabel("month", nov(10))).toBe("November 2026");
  });

  it("has a short form for a narrow toolbar", () => {
    expect(rangeLabelShort("days3", nov(3))).toBe("3 – 5 Nov");
    expect(rangeLabelShort("days3", nov(29))).toBe("29 Nov – 1 Dec");
    expect(rangeLabelShort("day", nov(3))).toBe("Tue 3 Nov");
    expect(rangeLabelShort("month", nov(3))).toBe("Nov 2026");
  });

  it("leaves out the current year when every day shown is in it", () => {
    expect(rangeLabel("days3", nov(10), 2026)).toBe("10 – 12 November");
    expect(rangeLabel("day", nov(10), 2026)).toBe("Tuesday, 10 November");
    expect(rangeLabel("week", { year: 2026, month: 11, day: 31 }, 2026)).toBe("27 December 2026 – 2 January 2027");
  });
});

describe("a day's time grid", () => {
  const day = (events: Item[], d = nov(10)) => segmentsForDay(eventsInRange(events, [], t(2026, 11, 1), t(2026, 12, 1)), d);

  it("places events by wall-clock minutes and clips overnight ones", () => {
    const segs = day([item("lecture", local(2026, 11, 10, 9, 30), local(2026, 11, 10, 11)), item("late", local(2026, 11, 10, 22), local(2026, 11, 11, 1))]);
    expect(segs.map((s) => [s.event.id, s.top, s.bottom, s.endsAfter])).toEqual([
      ["lecture", 570, 660, false],
      ["late", 1320, 1440, true],
    ]);
    const next = day([item("late", local(2026, 11, 10, 22), local(2026, 11, 11, 1))], nov(11));
    expect([next[0]!.top, next[0]!.bottom, next[0]!.startsBefore]).toEqual([0, 60, true]);
  });

  it("keeps moments as moments and leaves all-day events to the all-day row", () => {
    const segs = day([item("due", local(2026, 11, 10, 23, 59)), item("holiday", local(2026, 11, 10), undefined, { allDay: true, type: "starts" })]);
    expect(segs.map((s) => [s.event.id, s.top, s.bottom])).toEqual([["due", 1439, 1439]]);
  });

  it("puts overlapping events side by side and leaves others full width", () => {
    const segs = day([
      item("a", local(2026, 11, 10, 9), local(2026, 11, 10, 10, 30)),
      item("b", local(2026, 11, 10, 10), local(2026, 11, 10, 11)),
      item("c", local(2026, 11, 10, 10, 45), local(2026, 11, 10, 12)),
      item("d", local(2026, 11, 10, 14), local(2026, 11, 10, 15)),
    ]);
    const placed = Object.fromEntries(layoutDay(segs).map((p) => [p.event.id, [p.col, p.cols]]));
    // a and b overlap; c starts after a ends, so it reuses a's column.
    expect(placed).toEqual({ a: [0, 2], b: [1, 2], c: [0, 2], d: [0, 1] });
  });

  it("gives moments room so a deadline beside an event doesn't hide under it", () => {
    const segs = day([item("lecture", local(2026, 11, 10, 9), local(2026, 11, 10, 10)), item("due", local(2026, 11, 10, 9, 45))]);
    expect(layoutDay(segs).map((p) => p.cols)).toEqual([2, 2]);
  });
});

describe("the all-day row", () => {
  it("stacks overlapping all-day events in rows, spanning their days", () => {
    const week = viewDays("week", nov(11)); // Sun 8 – Sat 14
    const events = eventsInRange(
      [
        item("trip", local(2026, 11, 10), local(2026, 11, 13), { allDay: true, type: "starts" }),
        item("holiday", local(2026, 11, 11), undefined, { allDay: true, type: "starts" }),
        item("weekend", local(2026, 11, 14), undefined, { allDay: true, type: "starts" }),
        item("long", local(2026, 11, 1), local(2026, 11, 9), { allDay: true, type: "starts" }),
      ],
      [],
      t(2026, 11, 8),
      t(2026, 11, 15),
    );
    const lanes = Object.fromEntries(allDayLanes(events, week).map((l) => [l.event.id, [l.first, l.span, l.lane, l.startsBefore]]));
    expect(lanes).toEqual({
      long: [0, 1, 0, true],
      trip: [2, 3, 0, false],
      holiday: [3, 1, 1, false],
      weekend: [6, 1, 0, false],
    });
  });
});
