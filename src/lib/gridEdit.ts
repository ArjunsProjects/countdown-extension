import { toLocalISO } from "./dates";
import type { DateParts } from "./parse";
import type { Item } from "./types";

// The arithmetic behind editing on the calendar grid: moving an event,
// changing its end, and making a new one from a click or a drag. Times
// snap to 15 minutes and follow the wall clock, so a move to 9:00 lands on
// 9:00 even across a daylight-saving change.

/** Minutes events snap to. */
export const SNAP = 15;

export const snap = (minutes: number, step = SNAP) => Math.round(minutes / step) * step;
const floorTo = (minutes: number, step = SNAP) => Math.floor(minutes / step) * step;
const ceilTo = (minutes: number, step = SNAP) => Math.ceil(minutes / step) * step;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Minutes after midnight, by the wall clock. */
export const minutesOfDay = (d: Date) => d.getHours() * 60 + d.getMinutes();

/** A wall-clock time on a day (minutes may run past midnight into the next day). */
export const atMinutes = (d: DateParts, minutes: number) => new Date(d.year, d.month, d.day, 0, minutes);

export type Reschedule = Pick<Item, "dateTime"> & { endDateTime?: string };

/**
 * Moves an item by whole days and some minutes, snapping its new start to
 * the grid. A move of less than half a step up or down (across days, say)
 * keeps the time of day. An event keeps its length (its end moves with it).
 */
export function moveBy(item: Item, deltaDays: number, deltaMinutes: number): Reschedule {
  const start = new Date(item.dateTime);
  const day = { year: start.getFullYear(), month: start.getMonth(), day: start.getDate() + deltaDays };
  const minutes = Math.round(deltaMinutes / SNAP) === 0 ? minutesOfDay(start) : snap(minutesOfDay(start) + deltaMinutes);
  const next = atMinutes(day, minutes);
  const length = item.endDateTime ? Date.parse(item.endDateTime) - start.getTime() : 0;
  return {
    dateTime: toLocalISO(next),
    ...(length > 0 ? { endDateTime: toLocalISO(new Date(next.getTime() + length)) } : {}),
  };
}

/** A new end for an event: the snapped time on `day`, at least one step after its start. */
export function resizeEnd(item: Item, day: DateParts, minutes: number): string {
  const start = Date.parse(item.dateTime);
  const end = Math.max(atMinutes(day, snap(minutes)).getTime(), start + SNAP * 60_000);
  return toLocalISO(new Date(end));
}

/**
 * A new event's time from the grid: a click makes an hour from the slot
 * clicked; a drag covers the slots it crossed (whole steps, at least one).
 * It stays within the day.
 */
export function newRange(day: DateParts, from: number, to?: number): { start: Date; end: Date } {
  const a = clamp(Math.min(from, to ?? from), 0, 1440 - SNAP);
  const b = clamp(Math.max(from, to ?? from), 0, 1440);
  const start = floorTo(a);
  const end = to === undefined || b - a < SNAP / 2 ? Math.min(start + 60, 1440) : Math.max(ceilTo(b), start + SNAP);
  return { start: atMinutes(day, start), end: atMinutes(day, Math.min(end, 1440)) };
}

/** The minutes a pointer is at on the grid, from its position inside the scrolling body. */
export const pointerMinutes = (offsetY: number, hourPx: number) => clamp((offsetY / hourPx) * 60, 0, 1440);
