import { formatClock, formatDay, formatItemDate } from "./dates";
import type { Item } from "./types";

// Events with an end. A Due item is a moment (its deadline); a Starts item
// can also have an end, which keeps it on the list while it's happening.
// All-day events without an explicit end last their whole day, like
// iCalendar's DTSTART;VALUE=DATE with no DTEND.

export const MAX_LOCATION = 200;

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

type Timing = Pick<Item, "type" | "dateTime" | "endDateTime" | "allDay">;

const nextDay = (d: Date, days = 1) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);

/** When an event ends (epoch ms), or null for deadlines and events that are a moment. */
export function endOf(item: Timing): number | null {
  if (item.type !== "starts") return null;
  const start = Date.parse(item.dateTime);
  const end = item.endDateTime ? Date.parse(item.endDateTime) : Number.NaN;
  if (end > start) return end;
  return item.allDay ? nextDay(new Date(start)).getTime() : null;
}

/** The moment an item leaves the upcoming list: an event's end, otherwise its time. */
export function finishOf(item: Timing): number {
  return endOf(item) ?? Date.parse(item.dateTime);
}

export type Phase = "upcoming" | "now" | "past";

export function phaseOf(item: Timing, now: number): Phase {
  if (Date.parse(item.dateTime) > now) return "upcoming";
  const end = endOf(item);
  return end !== null && end > now ? "now" : "past";
}

/**
 * The length a series should give each occurrence, in minutes (whole days
 * for all-day events), or undefined when it's the default: a moment, or a
 * single all-day day.
 */
export function durationOf(item: Timing): number | undefined {
  if (item.type !== "starts" || !item.endDateTime) return undefined;
  const start = Date.parse(item.dateTime);
  const end = Date.parse(item.endDateTime);
  if (!(end > start)) return undefined;
  if (item.allDay) {
    // Days, not hours: a day that changes the clocks is still one day.
    const days = Math.round((end - start) / DAY_MS);
    return days > 1 ? days * 1440 : undefined;
  }
  return Math.round((end - start) / MINUTE_MS);
}

/** An occurrence's end from its start and the series' duration. */
export function endAfter(start: Date, duration: number, allDay: boolean): Date {
  return allDay ? nextDay(start, Math.max(1, Math.round(duration / 1440))) : new Date(start.getTime() + duration * MINUTE_MS);
}

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/**
 * "9:30 – 11:00 AM", or "11:30 AM – 1:00 PM" when the meridiem changes.
 * No-break spaces keep a range on one line; the date before it wraps instead.
 */
export function formatClockRange(start: Date, end: Date): string {
  const a = formatClock(start);
  const b = formatClock(end);
  return a.slice(-2) === b.slice(-2) ? `${a.slice(0, -3)}\u00a0–\u00a0${b}` : `${a}\u00a0–\u00a0${b}`;
}

/**
 * The date line for a tile:
 *   Tuesday, 10 November 2026, 9:30 – 11:00 AM
 *   Tuesday, 10 November – Thursday, 12 November 2026   (all-day, several days)
 *   Tuesday, 10 November 2026, 9:00 PM – Wednesday, 11 November, 2:00 AM
 */
export function formatWhen(item: Timing): string {
  const start = new Date(item.dateTime);
  const end = endOf(item);
  if (item.allDay) {
    // The stored end is exclusive: the last day is the one before it.
    const last = end === null ? start : nextDay(new Date(end), -1);
    if (sameDay(start, last) || last < start) return formatItemDate(start, true);
    return `${formatDay(start, start.getFullYear() !== last.getFullYear())} – ${formatDay(last)}`;
  }
  if (end === null) return formatItemDate(start);
  const e = new Date(end);
  if (sameDay(start, e)) return `${formatDay(start)}, ${formatClockRange(start, e)}`;
  return `${formatItemDate(start)} – ${formatDay(e, e.getFullYear() !== start.getFullYear())}, ${formatClock(e)}`;
}

/** "45 min", "1 hr", "1 hr 30 min", "2 hrs", "1 day", "3 days". */
export function formatDuration(minutes: number): string {
  if (minutes >= 1440 && minutes % 1440 === 0) {
    const days = minutes / 1440;
    return `${days} ${days === 1 ? "day" : "days"}`;
  }
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const hours = h ? `${h} ${h === 1 ? "hr" : "hrs"}` : "";
  return [hours, m || !h ? `${m} min` : ""].filter(Boolean).join(" ");
}
