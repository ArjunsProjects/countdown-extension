import { describe, expect, it } from "vitest";
import { toLocalISO } from "../src/lib/dates";
import type { Series } from "../src/lib/recurrence";
import {
  cleanReminders,
  DEFAULT_REMINDERS,
  describeReminders,
  dueReminders,
  fitReminders,
  nextReminder,
  reminderLabel,
  reminderMessage,
  remindersOf,
  reminderTime,
  snoozedDue,
  summaryMessage,
  type ReminderData,
} from "../src/lib/reminders";
import type { Item } from "../src/lib/types";

const at = (m: number, d: number, h = 0, min = 0) => new Date(2026, m - 1, d, h, min).getTime();
const MIN = 60_000;
const made = toLocalISO(new Date(2026, 9, 1));
const item = (over: Partial<Item> & { dateTime: string }): Item => ({
  id: "a",
  title: "Assignment 3",
  type: "due",
  createdAt: made,
  updatedAt: made,
  source: "manual",
  ...over,
});
const iso = (t: number) => toLocalISO(new Date(t));
const data = (items: Item[], extra: Partial<ReminderData> = {}): ReminderData => ({ items, series: [], defaults: DEFAULT_REMINDERS, ...extra });

describe("which reminders apply", () => {
  it("cleans stored lists: whole minutes, no repeats, at most two, earliest first", () => {
    expect(cleanReminders([60, 1440, 60])).toEqual([1440, 60]);
    expect(cleanReminders([5, 10, 1440])).toEqual([1440, 10]);
    expect(cleanReminders([-5, 1.5, "15", 99_999_999])).toEqual([]);
    expect(cleanReminders(undefined)).toBeUndefined();
    expect(cleanReminders([])).toEqual([]);
  });

  it("uses the item's own, then its series', then the defaults for its type", () => {
    const s = { id: "s", template: { title: "Lecture", type: "starts", reminders: [30] } } as unknown as Series;
    const lecture = item({ type: "starts", dateTime: iso(at(11, 10, 9)), seriesId: "s" });
    expect(remindersOf(lecture, s, DEFAULT_REMINDERS)).toEqual([30]);
    expect(remindersOf({ ...lecture, reminders: [] }, s, DEFAULT_REMINDERS)).toEqual([]);
    expect(remindersOf(lecture, undefined, DEFAULT_REMINDERS)).toEqual([15]);
    expect(remindersOf(item({ dateTime: iso(at(11, 10, 9)) }), undefined, DEFAULT_REMINDERS)).toEqual([1440, 60]);
  });
});

describe("when a reminder goes off", () => {
  it("counts minutes back from a timed item", () => {
    const due = item({ dateTime: iso(at(11, 10, 23, 59)) });
    expect(reminderTime(due, 60)).toBe(at(11, 10, 22, 59));
    expect(reminderTime(due, 0)).toBe(at(11, 10, 23, 59));
  });

  it("keeps the clock time for whole days, across a daylight-saving change", () => {
    // 1 November 2026 is when North American clocks go back.
    const exam = item({ dateTime: iso(at(11, 2, 9)) });
    const t = new Date(reminderTime(exam, 1440));
    expect([t.getDate(), t.getHours(), t.getMinutes()]).toEqual([1, 9, 0]);
    const w = new Date(reminderTime(exam, 7 * 1440));
    expect([w.getMonth(), w.getDate(), w.getHours()]).toEqual([9, 26, 9]);
  });

  it("reminds all-day items at 9 AM, and an all-day deadline the day before at the latest", () => {
    const trip = item({ type: "starts", allDay: true, dateTime: iso(at(11, 12)) });
    expect(reminderTime(trip, 15)).toBe(at(11, 12, 9));
    expect(reminderTime(trip, 1440)).toBe(at(11, 11, 9));
    const essay = item({ allDay: true, dateTime: iso(at(11, 12)) });
    expect(reminderTime(essay, 60)).toBe(at(11, 11, 9));
    expect(reminderTime(essay, 2 * 1440)).toBe(at(11, 10, 9));
    expect(fitReminders([1440, 60], essay)).toEqual([1440]);
    expect(fitReminders([15], trip)).toEqual([0]);
  });
});

describe("what's due between checks", () => {
  const due = item({ dateTime: iso(at(11, 10, 23, 59)) });

  it("finds reminders that went off since the last check, once per item", () => {
    expect(dueReminders(data([due]), at(11, 10, 22), at(11, 10, 23))).toEqual([due]);
    expect(dueReminders(data([due]), at(11, 10, 23), at(11, 10, 23, 30))).toEqual([]);
    // Chrome was closed for both: one notification, not two.
    expect(dueReminders(data([due]), at(11, 8), at(11, 10, 23))).toEqual([due]);
  });

  it("drops what's no longer worth showing, done or completed", () => {
    expect(dueReminders(data([due]), at(11, 8), at(11, 11, 1))).toEqual([]);
    // A reminder at the time itself can still come a few minutes late.
    const now = { ...due, reminders: [0] };
    expect(dueReminders(data([now]), at(11, 10, 23, 58), at(11, 10, 23, 59) + 3 * MIN)).toEqual([now]);
    expect(dueReminders(data([now]), at(11, 10, 23, 58), at(11, 10, 23, 59) + 6 * MIN)).toEqual([]);
    expect(dueReminders(data([{ ...due, completedAt: made }]), at(11, 10, 22), at(11, 10, 23))).toEqual([]);
    expect(dueReminders(data([due], { done: new Set(["a"]) }), at(11, 10, 22), at(11, 10, 23))).toEqual([]);
  });

  it("doesn't go off late for an item made or moved after its reminder time", () => {
    const late = { ...due, updatedAt: iso(at(11, 10, 23, 30)) };
    expect(dueReminders(data([late]), at(11, 10, 22), at(11, 10, 23, 40))).toEqual([]);
  });

  it("follows a series' reminders, and an all-day event through its day", () => {
    const s = { id: "s", template: { title: "Lab", type: "starts", reminders: [30] } } as unknown as Series;
    const lab = item({ id: "lab", type: "starts", dateTime: iso(at(11, 10, 14)), seriesId: "s" });
    expect(dueReminders({ ...data([lab]), series: [s] }, at(11, 10, 13), at(11, 10, 13, 31))).toEqual([lab]);
    const trip = item({ id: "trip", type: "starts", allDay: true, dateTime: iso(at(11, 12)) });
    expect(dueReminders(data([trip]), at(11, 12, 8), at(11, 12, 18))).toEqual([trip]);
  });

  it("schedules the next one, including snoozes", () => {
    expect(nextReminder(data([due]), at(11, 1))).toBe(at(11, 9, 23, 59));
    expect(nextReminder(data([due]), at(11, 10, 23))).toBeNull();
    expect(nextReminder(data([due]), at(11, 10, 23), { a: at(11, 10, 23, 10) })).toBe(at(11, 10, 23, 10));
  });

  it("brings back a snoozed item while it's still to do", () => {
    const snoozed = { a: at(11, 10, 23, 10) };
    expect(snoozedDue(data([due]), snoozed, at(11, 10, 23, 10))).toEqual([due]);
    expect(snoozedDue(data([due]), snoozed, at(11, 10, 23, 5))).toEqual([]);
    expect(snoozedDue(data([{ ...due, completedAt: made }]), snoozed, at(11, 10, 23, 10))).toEqual([]);
  });
});

describe("the words", () => {
  it("says how long is left, and when", () => {
    const due = item({ dateTime: iso(at(11, 10, 23, 59)) });
    expect(reminderMessage(due, at(11, 10, 22, 59))).toBe("Due in 1 hour · 11:59 PM");
    expect(reminderMessage(due, at(11, 10, 23, 59))).toBe("Due now · 11:59 PM");
    expect(reminderMessage(due, at(11, 9, 23, 59))).toBe("Due in 1 day · Tue 10 Nov, 11:59 PM");
    // Alarms come a few seconds late; the time left still reads as the reminder was set.
    expect(reminderMessage(due, at(11, 9, 23, 59) + 25_000)).toBe("Due in 1 day · Tue 10 Nov, 11:59 PM");
    const lecture = item({ type: "starts", dateTime: iso(at(11, 10, 12, 30)), endDateTime: iso(at(11, 10, 14)), location: "Swing Space" });
    expect(reminderMessage(lecture, at(11, 10, 12, 15))).toBe("Starts in 15 minutes · 12:30–2 PM · Swing Space");
  });

  it("speaks in days for all-day items", () => {
    expect(reminderMessage(item({ allDay: true, dateTime: iso(at(11, 12)) }), at(11, 11, 9))).toBe("Due tomorrow");
    expect(reminderMessage(item({ allDay: true, dateTime: iso(at(11, 12)) }), at(11, 10, 9))).toBe("Due in 2 days · Thu 12 Nov");
    expect(reminderMessage(item({ type: "starts", allDay: true, dateTime: iso(at(11, 12)) }), at(11, 12, 9))).toBe("Today · All day");
  });

  it("labels the choices", () => {
    expect(reminderLabel(0, { type: "due" })).toBe("When it's due");
    expect(reminderLabel(15, { type: "starts" })).toBe("15 minutes before");
    expect(reminderLabel(120, { type: "starts" })).toBe("2 hours before");
    expect(reminderLabel(7 * 1440, { type: "due" })).toBe("1 week before");
    expect(reminderLabel(0, { type: "starts", allDay: true })).toBe("On the day at 9 AM");
    expect(describeReminders([1440, 60], { type: "due" })).toBe("1 day and 1 hour before");
    expect(describeReminders([60, 0], { type: "due" })).toBe("1 hour before and when it's due");
    expect(describeReminders([], { type: "due" })).toBe("None");
    expect(summaryMessage([item({ dateTime: made, title: "Quiz 2" }), item({ dateTime: made, title: "Lab 4" }), item({ dateTime: made })])).toBe(
      "Quiz 2, Lab 4 and Assignment 3",
    );
  });
});
