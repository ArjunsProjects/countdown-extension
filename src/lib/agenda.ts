import { addDays, addMonths, monthGrid } from "./calendar";
import { formatDay, toLocalISO } from "./dates";
import { endOf } from "./events";
import type { DateParts } from "./parse";
import { occurrenceEnd, occurrenceId, occurrences, occurrenceTitle, withinEnd, type Series } from "./recurrence";
import type { Item } from "./types";

// The calendar views' data: which events fall in a range, and where each
// one goes on a day's time grid or in the all-day row. Pure, so the layout
// rules are tested directly; the components only position what this returns.

export type CalendarView = "day" | "days3" | "week" | "month";

export interface CalEvent {
  /** The stored item's id, or the id a not-yet-generated occurrence will get. */
  id: string;
  item: Item;
  /** A later occurrence of a series, drawn from its rule (series only store their next few). */
  virtual: boolean;
  start: number;
  /** Equal to start for moments (deadlines, events without an end). */
  end: number;
  allDay: boolean;
}

/** Guard against a rule that never reaches the range (e.g. daily since 2015, viewed in 2040). */
const MAX_STEPS = 50_000;

const dayStart = (d: DateParts) => new Date(d.year, d.month, d.day).getTime();
const dayEnd = (d: DateParts) => new Date(d.year, d.month, d.day + 1).getTime();

/** A moment belongs to the range it falls in; an interval to every range it touches. */
const overlaps = (start: number, end: number, from: number, to: number) =>
  start === end ? start >= from && start < to : start < to && end > from;

/** An occurrence that isn't stored yet, as the item it will become. */
function virtualItem(s: Series, index: number, date: Date, end: Date | null): Item {
  const item: Item = {
    id: occurrenceId(s, index),
    title: occurrenceTitle(s, index),
    type: s.template.type,
    dateTime: toLocalISO(date),
    createdAt: "",
    updatedAt: "",
    source: "manual",
    seriesId: s.id,
  };
  if (s.allDay) item.allDay = true;
  if (s.template.duration && end) item.endDateTime = toLocalISO(end);
  if (s.template.location) item.location = s.template.location;
  if (s.template.notes) item.notes = s.template.notes;
  if (s.categoryId) item.categoryId = s.categoryId;
  return item;
}

/**
 * Everything overlapping [from, to): stored items (completed ones included,
 * so the calendar keeps its history), plus series occurrences that haven't
 * been generated yet. Occurrences before a series' next index that aren't
 * stored were removed (or passed while the panel was closed), so they stay
 * gone. Sorted by start, longer first on ties.
 */
export function eventsInRange(
  items: readonly Item[],
  series: readonly Series[],
  from: number,
  to: number,
  /** Occurrences removed on another computer (sync). */
  skip?: ReadonlySet<string>,
): CalEvent[] {
  const out: CalEvent[] = [];
  const stored = new Set<string>();
  for (const item of items) {
    stored.add(item.id);
    const start = Date.parse(item.dateTime);
    const end = endOf(item) ?? start;
    if (overlaps(start, end, from, to)) out.push({ id: item.id, item, virtual: false, start, end, allDay: Boolean(item.allDay) });
  }
  for (const s of series) {
    let i = 0;
    for (const date of occurrences(new Date(s.start), s.rule, s.timeZone)) {
      if (date.getTime() >= to || i > MAX_STEPS || !withinEnd(date, i, s.end, s.timeZone)) break;
      if (i >= s.nextIndex) {
        const id = occurrenceId(s, i);
        const endDate = occurrenceEnd(s, date);
        const start = date.getTime();
        const end = endDate ? endDate.getTime() : start;
        if (!stored.has(id) && !skip?.has(id) && overlaps(start, end, from, to)) {
          out.push({ id, item: virtualItem(s, i, date, endDate), virtual: true, start, end, allDay: Boolean(s.allDay) });
        }
      }
      i++;
    }
  }
  return out.sort((a, b) => a.start - b.start || b.end - a.end || a.item.title.localeCompare(b.item.title));
}

/** Whether an event shows on a given day (all-day spans included). */
export function onDay(e: CalEvent, d: DateParts): boolean {
  return overlaps(e.start, e.end, dayStart(d), dayEnd(d));
}

// ── Views ─────────────────────────────────────────────────────

const weekday = (d: DateParts) => new Date(d.year, d.month, d.day).getDay();

/** The days a view shows. Weeks start on Sunday, like the date picker. */
export function viewDays(view: CalendarView, anchor: DateParts): DateParts[] {
  switch (view) {
    case "day":
      return [anchor];
    case "days3":
      return [0, 1, 2].map((n) => addDays(anchor, n));
    case "week":
      return Array.from({ length: 7 }, (_, n) => addDays(anchor, n - weekday(anchor)));
    case "month":
      return monthGrid(anchor.year, anchor.month);
  }
}

/** The anchor one step earlier or later: a day, three days, a week or a month. */
export function stepAnchor(view: CalendarView, anchor: DateParts, dir: 1 | -1): DateParts {
  switch (view) {
    case "day":
      return addDays(anchor, dir);
    case "days3":
      return addDays(anchor, 3 * dir);
    case "week":
      return addDays(anchor, 7 * dir);
    case "month":
      return addMonths(anchor, dir);
  }
}

const monthYear = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" });
const dayMonth = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long" });
const dayMonthShort = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });
const monthYearShort = new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric" });
const weekdayDayShort = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short" });
const toDate = (d: DateParts) => new Date(d.year, d.month, d.day);

/**
 * "Tuesday, 10 November 2026" · "10 – 12 November 2026" · "30 November – 2 December 2026" · "November 2026".
 * Pass the current year to leave it out when every day shown is in it (it fits a narrow panel).
 */
export function rangeLabel(view: CalendarView, anchor: DateParts, currentYear?: number): string {
  if (view === "month") return monthYear.format(toDate(anchor));
  const days = viewDays(view, anchor);
  const a = days[0]!;
  const b = days[days.length - 1]!;
  const year = a.year === currentYear && b.year === currentYear ? "" : ` ${b.year}`;
  if (view === "day") return formatDay(toDate(anchor), year !== "");
  if (a.year !== b.year) return `${dayMonth.format(toDate(a))} ${a.year} – ${dayMonth.format(toDate(b))} ${b.year}`;
  if (a.month !== b.month) return `${dayMonth.format(toDate(a))} – ${dayMonth.format(toDate(b))}${year}`;
  return `${a.day} – ${dayMonth.format(toDate(b))}${year}`;
}

/** The same range for a narrow toolbar: "3 – 5 Nov", "30 Nov – 2 Dec", "Tue 3 Nov", "Nov 2026". */
export function rangeLabelShort(view: CalendarView, anchor: DateParts): string {
  if (view === "month") return monthYearShort.format(toDate(anchor));
  if (view === "day") return weekdayDayShort.format(toDate(anchor)).replace(",", "");
  const days = viewDays(view, anchor);
  const a = days[0]!;
  const b = days[days.length - 1]!;
  if (a.month !== b.month || a.year !== b.year) return `${dayMonthShort.format(toDate(a))} – ${dayMonthShort.format(toDate(b))}`;
  return `${a.day} – ${dayMonthShort.format(toDate(b))}`;
}

// ── A day's time grid ─────────────────────────────────────────

export interface Segment {
  event: CalEvent;
  /** Minutes after the day's midnight, by the wall clock. */
  top: number;
  bottom: number;
  /** The event started on an earlier day / carries on past midnight. */
  startsBefore: boolean;
  endsAfter: boolean;
}

const wallMinutes = (t: number) => {
  const d = new Date(t);
  return d.getHours() * 60 + d.getMinutes();
};

/** The timed (not all-day) events on a day, clipped to it. Moments have top === bottom. */
export function segmentsForDay(events: readonly CalEvent[], d: DateParts): Segment[] {
  const from = dayStart(d);
  const to = dayEnd(d);
  const out: Segment[] = [];
  for (const event of events) {
    if (event.allDay || !overlaps(event.start, event.end, from, to)) continue;
    const startsBefore = event.start < from;
    const endsAfter = event.end > to;
    const top = startsBefore ? 0 : wallMinutes(event.start);
    const bottom = event.end === event.start ? top : endsAfter || event.end === to ? 1440 : wallMinutes(event.end);
    out.push({ event, top, bottom: Math.max(bottom, top), startsBefore, endsAfter });
  }
  return out;
}

export interface Placed extends Segment {
  /** Column within its cluster of overlapping events, and how many columns the cluster has. */
  col: number;
  cols: number;
}

/**
 * Lays out a day's segments side by side where they overlap, the way most
 * calendars do: overlapping events form a cluster, each takes the first
 * column free at its start, and every event in a cluster shares its width.
 * `minLength` (minutes) is how tall a moment or very short event is drawn,
 * so it still collides with what it visually covers.
 */
export function layoutDay(segments: readonly Segment[], minLength = 30): Placed[] {
  const sorted = [...segments].sort((a, b) => a.top - b.top || b.bottom - a.bottom);
  const placed: Placed[] = [];
  let cluster: Placed[] = [];
  let columns: number[] = []; // visual bottom of the last event in each column
  let clusterBottom = -1;

  const closeCluster = () => {
    for (const p of cluster) p.cols = columns.length;
    cluster = [];
    columns = [];
  };

  for (const seg of sorted) {
    const visualBottom = Math.max(seg.bottom, seg.top + minLength);
    if (seg.top >= clusterBottom) closeCluster();
    let col = columns.findIndex((b) => b <= seg.top);
    if (col < 0) {
      col = columns.length;
      columns.push(visualBottom);
    } else {
      columns[col] = visualBottom;
    }
    const p: Placed = { ...seg, col, cols: 1 };
    cluster.push(p);
    placed.push(p);
    clusterBottom = Math.max(clusterBottom, visualBottom);
  }
  closeCluster();
  return placed;
}

// ── The all-day row ───────────────────────────────────────────

export interface Lane {
  event: CalEvent;
  /** Index of the first day shown and how many shown days it covers. */
  first: number;
  span: number;
  /** Row within the all-day area. */
  lane: number;
  startsBefore: boolean;
  endsAfter: boolean;
}

/** All-day events as bars across the days shown, each in the first row free for its whole span. */
export function allDayLanes(events: readonly CalEvent[], days: readonly DateParts[]): Lane[] {
  if (days.length === 0) return [];
  const starts = days.map(dayStart);
  const ends = days.map(dayEnd);
  const out: Lane[] = [];
  const rows: number[] = []; // last day index occupied in each row
  const spans = events
    .filter((e) => e.allDay && overlaps(e.start, e.end, starts[0]!, ends[ends.length - 1]!))
    .map((event) => {
      const first = Math.max(0, starts.findIndex((s, i) => event.start < ends[i]! && event.start >= s));
      // The end is exclusive: the last day is the one its final moment falls in.
      const lastMoment = Math.max(event.start, event.end - 1);
      let last = ends.findIndex((e) => lastMoment < e);
      if (last < 0) last = days.length - 1;
      return { event, first: event.start < starts[0]! ? 0 : first, last };
    })
    .sort((a, b) => a.first - b.first || b.last - b.first - (a.last - a.first));

  for (const { event, first, last } of spans) {
    let lane = rows.findIndex((occupiedTo) => occupiedTo < first);
    if (lane < 0) {
      lane = rows.length;
      rows.push(last);
    } else {
      rows[lane] = last;
    }
    out.push({ event, first, span: last - first + 1, lane, startsBefore: event.start < starts[0]!, endsAfter: event.end > ends[ends.length - 1]! });
  }
  return out;
}
