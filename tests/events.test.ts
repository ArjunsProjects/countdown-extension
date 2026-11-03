import { beforeEach, describe, expect, it } from "vitest";
import { toLocalISO } from "../src/lib/dates";
import { durationOf, endOf, formatClockRangeShort, formatDuration, formatWhen, phaseOf } from "../src/lib/events";
import { googleCalendarUrl } from "../src/lib/gcal";
import { buildIcs } from "../src/lib/ics";
import { parseIcs } from "../src/lib/ics-import";
import { defaultEnd, fieldsOf, reconcileEnd, withFields, type ItemFields } from "../src/lib/items";
import { presetRule, topUp, type Series } from "../src/lib/recurrence";
import { buildRows } from "../src/lib/rows";
import { isItem, isSeries, type StorageBackend } from "../src/lib/storage";
import type { Item } from "../src/lib/types";
import {
  addItem,
  ensureOccurrences,
  initStore,
  items,
  makeRepeating,
  series,
  setSeriesEnd,
  setSeriesLocation,
  setSeriesTime,
} from "../src/state/store";

const local = (y: number, m: number, d: number, h = 0, min = 0) => toLocalISO(new Date(y, m - 1, d, h, min));
const event = (start: string, end?: string, extra: Partial<Item> = {}): Item => ({
  id: "e",
  title: "Lecture",
  type: "starts",
  dateTime: start,
  ...(end ? { endDateTime: end } : {}),
  createdAt: start,
  updatedAt: start,
  source: "manual",
  ...extra,
});
const at = (iso: string) => Date.parse(iso);

describe("an event's phase", () => {
  const lecture = event(local(2026, 11, 10, 12, 30), local(2026, 11, 10, 14));

  it("is upcoming before it starts, now while it runs, past once it ends", () => {
    expect(phaseOf(lecture, at(local(2026, 11, 10, 12))) ).toBe("upcoming");
    expect(phaseOf(lecture, at(local(2026, 11, 10, 13)))).toBe("now");
    expect(phaseOf(lecture, at(local(2026, 11, 10, 14)))).toBe("past");
  });

  it("treats deadlines and events without an end as moments", () => {
    const due = { ...lecture, type: "due" as const };
    expect(endOf(due)).toBeNull();
    expect(phaseOf(due, at(local(2026, 11, 10, 13)))).toBe("past");
    expect(phaseOf(event(local(2026, 11, 10, 9)), at(local(2026, 11, 10, 10)))).toBe("past");
  });

  it("lets an all-day event last its whole day, or until its end", () => {
    const holiday = event(local(2026, 11, 11), undefined, { allDay: true });
    expect(phaseOf(holiday, at(local(2026, 11, 11, 18)))).toBe("now");
    expect(phaseOf(holiday, at(local(2026, 11, 12, 0, 1)))).toBe("past");
    const trip = event(local(2026, 11, 10), local(2026, 11, 13), { allDay: true });
    expect(phaseOf(trip, at(local(2026, 11, 12, 20)))).toBe("now");
  });

  it("ignores an end at or before the start", () => {
    expect(endOf(event(local(2026, 11, 10, 9), local(2026, 11, 10, 9)))).toBeNull();
    expect(endOf(event(local(2026, 11, 10, 9), local(2026, 11, 10, 8)))).toBeNull();
  });

  it("keeps a running event on the upcoming list until it ends", () => {
    const now = at(local(2026, 11, 10, 13));
    const sections = buildRows([lecture, event(local(2026, 11, 10, 9), undefined, { id: "standup" })], now);
    expect(sections.upcoming.map((r) => (r.kind === "single" ? r.item.id : ""))).toEqual(["e"]);
    expect(sections.overdue.map((i) => i.id)).toEqual(["standup"]);
  });
});

describe("dates with an end", () => {
  it("shows a time range on one line", () => {
    expect(formatWhen(event(local(2026, 11, 10, 9, 30), local(2026, 11, 10, 11)))).toBe("Tuesday, 10 November 2026, 9:30\u00a0–\u00a011:00\u00a0AM");
    expect(formatWhen(event(local(2026, 11, 10, 11, 30), local(2026, 11, 10, 13)))).toBe("Tuesday, 10 November 2026, 11:30\u00a0AM\u00a0–\u00a01:00\u00a0PM");
  });

  it("names both days for an event that runs past midnight", () => {
    expect(formatWhen(event(local(2026, 11, 10, 21), local(2026, 11, 11, 2)))).toBe(
      "Tuesday, 10 November 2026, 9:00 PM – Wednesday, 11 November, 2:00 AM",
    );
  });

  it("shows the last day of a multi-day all-day event (the stored end is exclusive)", () => {
    expect(formatWhen(event(local(2026, 11, 10), local(2026, 11, 13), { allDay: true }))).toBe("Tuesday, 10 November – Thursday, 12 November 2026");
    expect(formatWhen(event(local(2026, 12, 30), local(2027, 1, 3), { allDay: true }))).toBe("Wednesday, 30 December 2026 – Saturday, 2 January 2027");
    expect(formatWhen(event(local(2026, 11, 11), undefined, { allDay: true }))).toBe("Wednesday, 11 November 2026");
  });

  it("shortens ranges for calendar blocks", () => {
    const at = (h: number, m = 0) => new Date(2026, 10, 10, h, m);
    expect(formatClockRangeShort(at(9, 30), at(11))).toBe("9:30–11\u00a0AM");
    expect(formatClockRangeShort(at(11), at(13))).toBe("11\u00a0AM–1\u00a0PM");
    expect(formatClockRangeShort(at(15), at(16))).toBe("3–4\u00a0PM");
  });

  it("formats durations", () => {
    expect([45, 60, 90, 120, 1440, 4320].map(formatDuration)).toEqual(["45 min", "1 hr", "1 hr 30 min", "2 hrs", "1 day", "3 days"]);
  });

  it("measures durations for series (days for all-day, never a default)", () => {
    expect(durationOf(event(local(2026, 11, 10, 12, 30), local(2026, 11, 10, 14)))).toBe(90);
    expect(durationOf(event(local(2026, 11, 10), local(2026, 11, 13), { allDay: true }))).toBe(3 * 1440);
    expect(durationOf(event(local(2026, 11, 10), local(2026, 11, 11), { allDay: true }))).toBeUndefined();
    expect(durationOf(event(local(2026, 11, 10, 9)))).toBeUndefined();
  });
});

describe("editing an end", () => {
  const base = (): ItemFields => ({
    title: "Lecture",
    type: "starts",
    date: { year: 2026, month: 10, day: 10 },
    time: { hour: 12, minute: 30 },
    notes: "",
    end: { date: { year: 2026, month: 10, day: 10 }, time: { hour: 14, minute: 0 } },
    location: "",
  });

  it("moves the end with the start, keeping the duration", () => {
    const prev = base();
    const next = reconcileEnd(prev, { ...prev, time: { hour: 15, minute: 0 } });
    expect(next.end).toEqual({ date: { year: 2026, month: 10, day: 10 }, time: { hour: 16, minute: 30 } });
    const moved = reconcileEnd(prev, { ...prev, date: { year: 2026, month: 10, day: 12 } });
    expect(moved.end?.date).toEqual({ year: 2026, month: 10, day: 12 });
  });

  it("reads an end time before the start as the next day", () => {
    const prev = { ...base(), time: { hour: 21, minute: 0 } };
    const next = reconcileEnd(prev, { ...prev, end: { date: prev.date, time: { hour: 2, minute: 0 } } });
    expect(next.end).toEqual({ date: { year: 2026, month: 10, day: 11 }, time: { hour: 2, minute: 0 } });
  });

  it("converts the end when switching to and from all-day", () => {
    const prev = base();
    const allDay = reconcileEnd(prev, { ...prev, time: null });
    expect(allDay.end).toEqual({ date: { year: 2026, month: 10, day: 10 }, time: null });
    const timed = reconcileEnd(allDay, { ...allDay, time: { hour: 9, minute: 0 } });
    expect(timed.end).toEqual({ date: { year: 2026, month: 10, day: 10 }, time: { hour: 10, minute: 0 } });
  });

  it("starts a new end an hour after the start", () => {
    expect(defaultEnd({ date: { year: 2026, month: 10, day: 10 }, time: { hour: 23, minute: 30 } })).toEqual({
      date: { year: 2026, month: 10, day: 11 },
      time: { hour: 0, minute: 30 },
    });
  });

  it("saves the end and location, and reads them back", () => {
    const item = event(local(2026, 11, 1, 9), undefined, { id: "x" });
    const saved = withFields(item, { ...base(), location: "  Wesbrook Building " }, new Date());
    expect(saved.endDateTime).toBe(local(2026, 11, 10, 14));
    expect(saved.location).toBe("Wesbrook Building");
    expect(fieldsOf(saved).end).toEqual(base().end);
  });

  it("stores an all-day end exclusively, and drops ends deadlines can't have", () => {
    const item = event(local(2026, 11, 1), undefined, { id: "x", allDay: true });
    const trip = withFields(item, { ...base(), time: null, end: { date: { year: 2026, month: 10, day: 12 }, time: null } }, new Date());
    expect(trip.endDateTime).toBe(local(2026, 11, 13));
    expect(fieldsOf(trip).end).toEqual({ date: { year: 2026, month: 10, day: 12 }, time: null });
    const oneDay = withFields(item, { ...base(), time: null, end: { date: { year: 2026, month: 10, day: 10 }, time: null } }, new Date());
    expect(oneDay.endDateTime).toBeUndefined();
    expect(withFields(item, { ...base(), type: "due" }, new Date()).endDateTime).toBeUndefined();
  });

  it("accepts the new fields in storage and rejects broken ones", () => {
    expect(isItem(event(local(2026, 11, 10, 9), local(2026, 11, 10, 10), { location: "Room 1" }))).toBe(true);
    expect(isItem({ ...event(local(2026, 11, 10, 9)), endDateTime: "soon" })).toBe(false);
    expect(isItem({ ...event(local(2026, 11, 10, 9)), location: 7 })).toBe(false);
  });
});

describe("repeating events with an end", () => {
  const memory = (): StorageBackend => {
    const data: Record<string, unknown> = {};
    return { get: async () => ({ ...data }), set: async (v) => void Object.assign(data, v), subscribe: () => () => {} };
  };
  const now = new Date(2026, 10, 2, 8);

  beforeEach(async () => {
    await initStore(memory());
    items.value = [];
    series.value = [];
  });

  const weeklyLecture = () => {
    addItem(
      makeRepeating(
        event(local(2026, 11, 3, 12, 30), local(2026, 11, 3, 14), { id: "first", location: "Swing Space" }),
        presetRule("weekly"),
        { type: "never" },
      ),
    );
    ensureOccurrences(now.getTime());
  };

  it("gives every occurrence the first one's length and place", () => {
    weeklyLecture();
    expect(series.value[0]!.template).toMatchObject({ duration: 90, location: "Swing Space" });
    const later = items.value.filter((i) => i.id !== "first");
    expect(later.length).toBeGreaterThan(0);
    for (const i of later) {
      expect(Date.parse(i.endDateTime!) - Date.parse(i.dateTime)).toBe(90 * 60_000);
      expect(i.location).toBe("Swing Space");
    }
  });

  it("validates a series' duration", () => {
    weeklyLecture();
    expect(isSeries(series.value[0])).toBe(true);
    expect(isSeries({ ...series.value[0], template: { ...series.value[0]!.template, duration: -5 } })).toBe(false);
  });

  it("generates an occurrence that's already happening", () => {
    const s: Series = {
      id: "s",
      epoch: 0,
      start: local(2026, 11, 2, 7, 30),
      rule: presetRule("daily"),
      end: { type: "count", count: 1 },
      template: { title: "Standup", type: "starts", duration: 60 },
      nextIndex: 0,
    };
    const { added } = topUp(s, [], now.getTime());
    expect(added).toHaveLength(1);
    expect(phaseOf(added[0]!, now.getTime())).toBe("now");
  });

  it("moves ends with the start time, and sets one end or place for all", () => {
    weeklyLecture();
    const sid = series.value[0]!.id;
    setSeriesTime(sid, { hour: 15, minute: 0 }, now);
    for (const i of items.value) expect(Date.parse(i.endDateTime!) - Date.parse(i.dateTime)).toBe(90 * 60_000);

    setSeriesEnd(sid, { hour: 15, minute: 50 }, now);
    for (const i of items.value) expect(new Date(i.endDateTime!).getHours() * 60 + new Date(i.endDateTime!).getMinutes()).toBe(15 * 60 + 50);
    expect(series.value[0]!.template.duration).toBe(50);

    setSeriesLocation(sid, "Forest Sciences Centre", now);
    expect(items.value.every((i) => i.location === "Forest Sciences Centre")).toBe(true);
    expect(series.value[0]!.template.location).toBe("Forest Sciences Centre");

    setSeriesEnd(sid, null, now);
    expect(items.value.every((i) => i.endDateTime === undefined)).toBe(true);
    expect(series.value[0]!.template.duration).toBeUndefined();
  });
});

describe("calendar files with ends and places", () => {
  const importNow = Date.UTC(2026, 10, 2, 16, 0, 0); // 2 Nov 2026, 08:00 in Vancouver-ish
  let n = 0;
  const ids = () => `id${++n}`;
  const cal = (...lines: string[]) => ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:test", ...lines, "END:VCALENDAR"].join("\r\n");
  const vevent = (...lines: string[]) => ["BEGIN:VEVENT", ...lines, "END:VEVENT"];
  const only = (ics: string) => {
    const c = parseIcs(ics, importNow, ids).candidates;
    expect(c).toHaveLength(1);
    return c[0]!;
  };

  it("keeps an event's end and location (DTEND or DURATION)", () => {
    const withEnd = only(cal(...vevent("UID:a", "SUMMARY:MATH 111", "DTSTART:20261110T173000Z", "DTEND:20261110T190000Z", "LOCATION:Wesbrook Building")));
    expect(withEnd.kind === "item" && Date.parse(withEnd.item.endDateTime!) - Date.parse(withEnd.item.dateTime)).toBe(90 * 60_000);
    expect(withEnd.kind === "item" && withEnd.item.location).toBe("Wesbrook Building");
    const withDuration = only(cal(...vevent("UID:b", "SUMMARY:Lab", "DTSTART:20261110T230000Z", "DURATION:PT2H")));
    expect(withDuration.kind === "item" && Date.parse(withDuration.item.endDateTime!) - Date.parse(withDuration.item.dateTime)).toBe(2 * 3_600_000);
  });

  it("stores multi-day all-day ends exclusively and leaves single days alone", () => {
    const trip = only(cal(...vevent("UID:c", "SUMMARY:Trip", "DTSTART;VALUE=DATE:20261110", "DTEND;VALUE=DATE:20261113")));
    expect(trip.kind === "item" && trip.item.endDateTime).toBe(local(2026, 11, 13));
    const holiday = only(cal(...vevent("UID:d", "SUMMARY:Remembrance Day", "DTSTART;VALUE=DATE:20261111", "DTEND;VALUE=DATE:20261112")));
    expect(holiday.kind === "item" && holiday.item.endDateTime).toBeUndefined();
  });

  it("imports an event that's happening right now", () => {
    const running = parseIcs(cal(...vevent("UID:e", "SUMMARY:Standup", "DTSTART:20261102T153000Z", "DTEND:20261102T163000Z")), importNow, ids);
    expect(running.candidates).toHaveLength(1);
    expect(running.pastHidden).toBe(0);
  });

  it("gives an imported repeating event its duration and place", () => {
    const c = only(
      cal(...vevent("UID:f", "SUMMARY:CPSC 213 lecture", "DTSTART:20261103T203000Z", "DTEND:20261103T220000Z", "RRULE:FREQ=WEEKLY", "LOCATION:Swing Space")),
    );
    expect(c.kind).toBe("series");
    if (c.kind !== "series") return;
    expect(c.series?.template).toMatchObject({ duration: 90, location: "Swing Space" });
    for (const i of c.items) {
      expect(Date.parse(i.endDateTime!) - Date.parse(i.dateTime)).toBe(90 * 60_000);
      expect(i.location).toBe("Swing Space");
    }
  });

  it("exports DTEND and LOCATION, and reads them back the same", () => {
    const lecture = event(local(2026, 11, 10, 9, 30), local(2026, 11, 10, 11), { id: "m", location: "Wesbrook Building" });
    const trip = event(local(2026, 11, 20), local(2026, 11, 23), { id: "t", allDay: true, title: "Trip" });
    const ics = buildIcs([{ kind: "item", item: lecture }, { kind: "item", item: trip }], [lecture, trip], new Date(importNow));
    expect(ics).toMatch(/DTEND:\d{8}T\d{6}Z/);
    expect(ics).toContain("DTEND;VALUE=DATE:20261123");
    expect(ics).toContain("LOCATION:Wesbrook Building");
    const back = parseIcs(ics, importNow, ids).candidates.map((c) => (c.kind === "item" ? c.item : null));
    const [l, t] = back;
    expect(Date.parse(l!.endDateTime!)).toBe(Date.parse(lecture.endDateTime!));
    expect(l!.location).toBe("Wesbrook Building");
    expect(t!.endDateTime).toBe(trip.endDateTime);
  });

  it("round-trips a repeating event's length through a file", () => {
    const s: Series = {
      id: "s1",
      epoch: 0,
      start: local(2026, 11, 3, 12, 30),
      rule: presetRule("weekly"),
      end: { type: "never" },
      template: { title: "CPSC 213 lecture", type: "starts", duration: 90, location: "Swing Space" },
      nextIndex: 1,
    };
    const head: Item = event(local(2026, 11, 3, 12, 30), local(2026, 11, 3, 14), { id: "s1~0~0", seriesId: "s1", location: "Swing Space", title: "CPSC 213 lecture" });
    const ics = buildIcs([{ kind: "series", series: s, upcoming: [head] }], [head], new Date(importNow));
    expect(ics).toContain("DTEND:20261103T140000");
    const back = parseIcs(ics, importNow, ids).candidates[0]!;
    expect(back.kind === "series" && back.series?.template).toMatchObject({ duration: 90, location: "Swing Space" });
  });

  it("sends the end and place to Google Calendar", () => {
    const url = new URL(
      googleCalendarUrl({ kind: "item", item: event(local(2026, 11, 10, 9, 30), local(2026, 11, 10, 11), { location: "Wesbrook Building" }) }, "America/Vancouver"),
    );
    expect(url.searchParams.get("dates")).toBe("20261110T093000/20261110T110000");
    expect(url.searchParams.get("location")).toBe("Wesbrook Building");
    const trip = new URL(googleCalendarUrl({ kind: "item", item: event(local(2026, 11, 20), local(2026, 11, 23), { allDay: true }) }));
    expect(trip.searchParams.get("dates")).toBe("20261120/20261123");
  });
});
