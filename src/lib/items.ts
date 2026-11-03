import { toLocalISO } from "./dates";
import { MAX_LOCATION } from "./events";
import type { DateParts, TimeParts } from "./parse";
import type { CompletionRecord, Item, ItemType } from "./types";

// Pure operations on the item list. The store (src/state) wraps these with
// persistence and undo; keeping them pure makes them straightforward to test.

export interface ItemFields {
  title: string;
  type: ItemType;
  date: DateParts;
  /** null means all-day. */
  time: TimeParts | null;
  notes: string;
  /**
   * Events: when it ends. The date is the last day (inclusive, even for
   * all-day events); time is null exactly when the start's is. null: no end.
   */
  end: EndFields | null;
  location: string;
}

export interface EndFields {
  date: DateParts;
  time: TimeParts | null;
}

const partsOf = (d: Date): DateParts => ({ year: d.getFullYear(), month: d.getMonth(), day: d.getDate() });
const clockOf = (d: Date): TimeParts => ({ hour: d.getHours(), minute: d.getMinutes() });
const at = (date: DateParts, time: TimeParts | null) => new Date(date.year, date.month, date.day, time?.hour ?? 0, time?.minute ?? 0);

/** The draft's start as a Date. */
export const startOfFields = (f: Pick<ItemFields, "date" | "time">) => at(f.date, f.time);

/** The instant an end means: for all-day ends, midnight after the last day (exclusive). */
export function endInstant(end: EndFields): Date {
  return end.time ? at(end.date, end.time) : new Date(end.date.year, end.date.month, end.date.day + 1);
}

export function newItem(now: Date, id: string = crypto.randomUUID()): Item {
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9, 0);
  const stamp = toLocalISO(now);
  return {
    id,
    title: "",
    type: "due",
    dateTime: toLocalISO(tomorrow),
    createdAt: stamp,
    updatedAt: stamp,
    source: "manual",
  };
}

export function fieldsOf(item: Item): ItemFields {
  const d = new Date(item.dateTime);
  return {
    title: item.title,
    type: item.type,
    date: { year: d.getFullYear(), month: d.getMonth(), day: d.getDate() },
    time: item.allDay ? null : { hour: d.getHours(), minute: d.getMinutes() },
    notes: item.notes ?? "",
    end: endFieldsOf(item, d),
    location: item.location ?? "",
  };
}

function endFieldsOf(item: Item, start: Date): EndFields | null {
  if (item.type !== "starts" || !item.endDateTime) return null;
  const end = new Date(item.endDateTime);
  if (!(end > start)) return null;
  if (!item.allDay) return { date: partsOf(end), time: clockOf(end) };
  // Stored exclusive: the last day is the one before (a mid-day value floors to its day).
  const last = new Date(end.getFullYear(), end.getMonth(), end.getDate() - (end.getHours() || end.getMinutes() ? 0 : 1));
  return { date: partsOf(last < start ? start : last), time: null };
}

/** A new end for a draft: an hour after the start, or the same day for all-day. */
export function defaultEnd(f: Pick<ItemFields, "date" | "time">): EndFields {
  if (!f.time) return { date: f.date, time: null };
  const e = new Date(startOfFields(f).getTime() + 60 * 60_000);
  return { date: partsOf(e), time: clockOf(e) };
}

/**
 * Keeps a draft's end consistent after an edit (`next` = `prev` with one
 * field changed), the way calendar apps do:
 *  - moving the start moves the end with it, keeping the duration;
 *  - switching between all-day and timed converts the end;
 *  - an end at or before the start is fixed rather than saved: a time
 *    earlier than the start on the same day means the next day (9 PM – 2 AM).
 */
export function reconcileEnd(prev: ItemFields, next: ItemFields): ItemFields {
  let end = next.end;
  if (!end) return next;
  const start = startOfFields(next);

  if (!next.time && end.time) end = { date: end.date, time: null };
  else if (next.time && !end.time) end = defaultEnd(next);
  else if (prev.end && end === prev.end && startOfFields(prev).getTime() !== start.getTime()) {
    // The start moved and the end wasn't touched: keep the duration.
    if (next.time) {
      const duration = endInstant(prev.end).getTime() - startOfFields(prev).getTime();
      const e = new Date(start.getTime() + duration);
      end = { date: partsOf(e), time: clockOf(e) };
    } else {
      const days = Math.round((at(prev.end.date, null).getTime() - at(prev.date, null).getTime()) / 86_400_000);
      end = { date: partsOf(new Date(next.date.year, next.date.month, next.date.day + days)), time: null };
    }
  }

  if (endInstant(end) <= start) {
    end = { date: next.date, time: end.time };
    if (endInstant(end) <= start) end = { date: partsOf(new Date(next.date.year, next.date.month, next.date.day + 1)), time: end.time };
  }
  return end === next.end ? next : { ...next, end };
}

export function withFields(item: Item, fields: ItemFields, now: Date): Item {
  const { date, time } = fields;
  const when = new Date(date.year, date.month, date.day, time?.hour ?? 0, time?.minute ?? 0);
  const next: Item = {
    ...item,
    title: fields.title.trim(),
    type: fields.type,
    dateTime: toLocalISO(when),
    updatedAt: toLocalISO(now),
  };
  if (time) delete next.allDay;
  else next.allDay = true;
  const notes = fields.notes.trim();
  if (notes) next.notes = notes;
  else delete next.notes;
  // Only events end; a single all-day day is the default and isn't stored.
  delete next.endDateTime;
  if (fields.type === "starts" && fields.end) {
    const end = endInstant({ date: fields.end.date, time: time ? fields.end.time : null });
    const oneDay = !time && end.getTime() === new Date(date.year, date.month, date.day + 1).getTime();
    if (end > when && !oneDay) next.endDateTime = toLocalISO(end);
  }
  const location = fields.location.trim().slice(0, MAX_LOCATION);
  if (location) next.location = location;
  else delete next.location;
  return next;
}

/** True when saving would change anything the user can see. */
export function differs(a: Item, b: Item): boolean {
  return (
    a.title !== b.title ||
    a.type !== b.type ||
    // Same instant written with a different UTC offset is not a change.
    Date.parse(a.dateTime) !== Date.parse(b.dateTime) ||
    Boolean(a.allDay) !== Boolean(b.allDay) ||
    (a.endDateTime ? Date.parse(a.endDateTime) : null) !== (b.endDateTime ? Date.parse(b.endDateTime) : null) ||
    (a.location ?? "") !== (b.location ?? "") ||
    (a.notes ?? "") !== (b.notes ?? "")
  );
}

export interface Removed {
  item: Item;
  index: number;
}

export function removeIds(items: readonly Item[], ids: ReadonlySet<string>): { next: Item[]; removed: Removed[] } {
  const next: Item[] = [];
  const removed: Removed[] = [];
  items.forEach((item, index) => (ids.has(item.id) ? removed.push({ item, index }) : next.push(item)));
  return { next, removed };
}

/** Puts removed items back at their original positions. */
export function restore(items: readonly Item[], removed: readonly Removed[]): Item[] {
  const next = [...items];
  const present = new Set(items.map((i) => i.id));
  for (const { item, index } of [...removed].sort((a, b) => a.index - b.index)) {
    if (!present.has(item.id)) next.splice(Math.min(index, next.length), 0, item);
  }
  return next;
}

export function complete(
  items: readonly Item[],
  id: string,
  now: Date,
): { next: Item[]; record: CompletionRecord } | null {
  const item = items.find((i) => i.id === id);
  if (!item || item.completedAt) return null;
  const at = toLocalISO(now);
  const record: CompletionRecord = {
    id: crypto.randomUUID(),
    itemId: item.id,
    title: item.title,
    type: item.type,
    dateTime: item.dateTime,
    completedAt: at,
  };
  return { next: items.map((i) => (i.id === id ? { ...i, completedAt: at } : i)), record };
}

export function uncomplete(items: readonly Item[], id: string): Item[] {
  return items.map((i) => {
    if (i.id !== id) return i;
    const { completedAt: _, ...rest } = i;
    return rest;
  });
}
