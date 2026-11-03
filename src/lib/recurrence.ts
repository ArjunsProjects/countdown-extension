import { toLocalISO } from "./dates";
import { endAfter } from "./events";
import { daysInMonth } from "./parse";
import { renderTitle } from "./numbering";
import { instantToWallTime, zonedTimeToInstant } from "./timezone";
import type { Item, ItemType } from "./types";

// Repeat rules are a subset of iCalendar RRULE (FREQ, INTERVAL, BYDAY,
// UNTIL, COUNT) so imported and exported series map onto them directly,
// plus "DATES": an explicit list of days chosen by the user.

export type Freq = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY" | "DATES";

export interface RepeatRule {
  freq: Freq;
  interval: number;
  /** WEEKLY only: weekdays to repeat on, 0 = Sunday. */
  weekdays?: number[];
  /** DATES only: local YYYY-MM-DD days, sorted; every occurrence uses the series' time. */
  dates?: string[];
}

/** Upper bound on hand-picked dates in one series. */
export const MAX_CUSTOM_DATES = 366;

export type RepeatEnd =
  | { type: "never" }
  /** Last allowed day, local YYYY-MM-DD (inclusive). */
  | { type: "until"; date: string }
  /** Total occurrences, counting the first. */
  | { type: "count"; count: number };

export interface Series {
  id: string;
  /** Bumped when the rule changes, so regenerated occurrences get fresh ids. */
  epoch: number;
  /** Occurrence 0; later occurrences keep its wall-clock time. */
  start: string;
  allDay?: boolean;
  rule: RepeatRule;
  end: RepeatEnd;
  /** Fields copied onto newly generated occurrences. */
  template: {
    title: string;
    type: ItemType;
    notes?: string;
    /** Events: minutes from each occurrence's start to its end (whole days for all-day series). */
    duration?: number;
    location?: string;
  };
  /** Index of the next occurrence to generate. */
  nextIndex: number;
  /** iCalendar UID when imported; kept for duplicate detection and export. */
  uid?: string;
  /** Category for every occurrence, including ones generated later. */
  categoryId?: string;
  /**
   * Set when the title template numbers its occurrences ("Chapter {n}"):
   * the number given to occurrence 0.
   */
  numberFrom?: number;
  /**
   * IANA zone whose wall clock the series follows, when imported from a
   * calendar in another zone (e.g. a 9:30 IST meeting). Absent: local time.
   */
  timeZone?: string;
}

/** Occurrences kept generated ahead of now for each open-ended series. */
export const WINDOW = 6;

// ── Presets offered in the editor ─────────────────────────────

export type RepeatPreset =
  | "none"
  | "daily"
  | "weekdays"
  /** Weekly on hand-picked weekdays. */
  | "weeklyOn"
  | "weekly"
  | "biweekly"
  | "monthly"
  | "yearly"
  /** Hand-picked dates. */
  | "dates"
  /** A rule that isn't one of the presets (e.g. imported). */
  | "custom";

const WEEKDAYS = [1, 2, 3, 4, 5];

/** Presets that map to a fixed rule. */
export type RulePreset = Exclude<RepeatPreset, "none" | "custom" | "dates" | "weeklyOn">;

export function presetRule(preset: RulePreset): RepeatRule {
  switch (preset) {
    case "daily":
      return { freq: "DAILY", interval: 1 };
    case "weekdays":
      return { freq: "WEEKLY", interval: 1, weekdays: WEEKDAYS };
    case "weekly":
      return { freq: "WEEKLY", interval: 1 };
    case "biweekly":
      return { freq: "WEEKLY", interval: 2 };
    case "monthly":
      return { freq: "MONTHLY", interval: 1 };
    case "yearly":
      return { freq: "YEARLY", interval: 1 };
  }
}

export function presetOf(rule: RepeatRule | null): RepeatPreset {
  if (!rule) return "none";
  if (rule.freq === "DATES") return "dates";
  const { freq, interval, weekdays } = rule;
  if (weekdays?.length) {
    if (freq !== "WEEKLY" || interval !== 1) return "custom";
    return weekdays.join() === WEEKDAYS.join() ? "weekdays" : "weeklyOn";
  }
  if (interval === 1) return ({ DAILY: "daily", WEEKLY: "weekly", MONTHLY: "monthly", YEARLY: "yearly" } as const)[freq];
  if (freq === "WEEKLY" && interval === 2) return "biweekly";
  return "custom";
}

const weekdayName = new Intl.DateTimeFormat("en-GB", { weekday: "long" });
const dayMonth = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long" });
const shortWeekday = new Intl.DateTimeFormat("en-GB", { weekday: "short" });

/** Human label for a rule, phrased from its start date: "Weekly on Thursday". */
export function describeRule(rule: RepeatRule, start: Date): string {
  const n = rule.interval;
  switch (rule.freq) {
    case "DATES": {
      const count = rule.dates?.length ?? 0;
      return `On ${count} custom ${count === 1 ? "date" : "dates"}`;
    }
    case "DAILY":
      return n === 1 ? "Daily" : `Every ${n} days`;
    case "WEEKLY": {
      if (presetOf(rule) === "weekdays") return "Every weekday";
      const days = rule.weekdays?.length
        ? rule.weekdays.map((d) => shortWeekday.format(new Date(2026, 1, 1 + d))).join(", ")
        : weekdayName.format(start);
      return `${n === 1 ? "Weekly" : `Every ${n} weeks`} on ${days}`;
    }
    case "MONTHLY": {
      const day = start.getDate();
      const suffix = day > 28 ? ` (or last day)` : "";
      return `${n === 1 ? "Monthly" : `Every ${n} months`} on day ${day}${suffix}`;
    }
    case "YEARLY":
      return `${n === 1 ? "Annually" : `Every ${n} years`} on ${dayMonth.format(start)}`;
  }
}

/** Short end description for stack tiles: "until 31 Dec", "10 times". */
export function describeEnd(end: RepeatEnd): string {
  if (end.type === "until") {
    const [y, m, d] = end.date.split("-").map(Number) as [number, number, number];
    return `until ${dayMonth.format(new Date(y, m - 1, d))}`;
  }
  if (end.type === "count") return `${end.count} times`;
  return "";
}

// ── Occurrence generation ─────────────────────────────────────

/**
 * Yields occurrence dates in order, starting with `start` itself.
 * Wall-clock time is preserved across DST changes — in `timeZone` when
 * given, otherwise in the local zone. Monthly/yearly dates past the end of a
 * shorter month land on its last day.
 */
export function* occurrences(start: Date, rule: RepeatRule, timeZone?: string): Generator<Date> {
  const w = timeZone ? instantToWallTime(start.getTime(), timeZone) : null;
  const zone = w ? timeZone : undefined;
  const [y, m, d, h, mi] = w
    ? [w.year, w.month - 1, w.day, w.hour, w.minute]
    : [start.getFullYear(), start.getMonth(), start.getDate(), start.getHours(), start.getMinutes()];

  // Calendar arithmetic happens on wall dates (normalized via UTC), then the
  // wall time is converted to an instant in the series' zone.
  const at = (yy: number, mm: number, dd: number): Date => {
    if (!zone) return new Date(yy, mm, dd, h, mi);
    const n = new Date(Date.UTC(yy, mm, dd));
    const instant = zonedTimeToInstant(
      { year: n.getUTCFullYear(), month: n.getUTCMonth() + 1, day: n.getUTCDate(), hour: h, minute: mi, second: 0 },
      zone,
    );
    return new Date(instant!);
  };
  const weekday = (yy: number, mm: number, dd: number) => new Date(Date.UTC(yy, mm, dd)).getUTCDay();
  const clampedMonth = (months: number): Date => {
    const first = new Date(Date.UTC(y, m + months, 1));
    const fy = first.getUTCFullYear();
    const fm = first.getUTCMonth();
    return at(fy, fm, Math.min(d, daysInMonth(fy, fm)));
  };

  if (rule.freq === "DATES") {
    // Each chosen day, in order, at the start's wall-clock time.
    for (const day of [...new Set(rule.dates ?? [])].sort()) {
      const [yy, mm, dd] = day.split("-").map(Number) as [number, number, number];
      yield at(yy, mm - 1, dd);
    }
    return;
  }

  const n = Math.max(1, Math.floor(rule.interval));
  yield new Date(start);

  if (rule.freq === "WEEKLY" && rule.weekdays?.length) {
    const days = new Set(rule.weekdays);
    const weekStart = d - weekday(y, m, d); // Sunday of the start week
    for (let offset = 1; offset < 366 * 50; offset++) {
      const week = Math.floor((d + offset - weekStart) / 7);
      if (week % n === 0 && days.has(weekday(y, m, d + offset))) yield at(y, m, d + offset);
    }
    return;
  }

  for (let k = 1; k < 100_000; k++) {
    switch (rule.freq) {
      case "DAILY":
        yield at(y, m, d + k * n);
        break;
      case "WEEKLY":
        yield at(y, m, d + 7 * k * n);
        break;
      case "MONTHLY":
        yield clampedMonth(k * n);
        break;
      case "YEARLY":
        yield clampedMonth(12 * k * n);
        break;
    }
  }
}

const pad = (v: number) => String(v).padStart(2, "0");

/** YYYY-MM-DD of a date, in `timeZone` when given, otherwise local. */
export function wallYmd(date: Date, timeZone?: string): string {
  const w = timeZone ? instantToWallTime(date.getTime(), timeZone) : null;
  return w
    ? `${w.year}-${pad(w.month)}-${pad(w.day)}`
    : `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function withinEnd(date: Date, index: number, end: RepeatEnd, timeZone?: string): boolean {
  if (end.type === "count") return index < end.count;
  if (end.type === "until") return wallYmd(date, timeZone) <= end.date;
  return true;
}

/** The occurrence at `index`, or null if the series has ended before it. */
export function occurrenceAt(series: Series, index: number): Date | null {
  let i = 0;
  for (const date of occurrences(new Date(series.start), series.rule, series.timeZone)) {
    if (!withinEnd(date, i, series.end, series.timeZone)) return null;
    if (i === index) return date;
    i++;
  }
  return null;
}

export const occurrenceId = (series: Series, index: number) => `${series.id}~${series.epoch}~${index}`;

/**
 * Generates occurrences until the series has WINDOW upcoming, uncompleted
 * occurrences or ends. Occurrences that would already be in the past are
 * skipped, so a panel left closed for a month doesn't flood Overdue.
 * Ids are deterministic, so two panels topping up at once agree.
 */
export function topUp(
  series: Series,
  items: readonly Item[],
  now: number,
): { series: Series; added: Item[]; ended: boolean } {
  let upcoming = items.filter(
    (i) => i.seriesId === series.id && !i.completedAt && Date.parse(i.dateTime) > now,
  ).length;
  const existing = new Set(items.map((i) => i.id));
  const added: Item[] = [];
  let next = series.nextIndex;
  let ended = false;

  // Walk the generator once instead of calling occurrenceAt per index.
  let i = 0;
  const gen = occurrences(new Date(series.start), series.rule, series.timeZone);
  for (const date of gen) {
    if (upcoming >= WINDOW && i >= next) break;
    if (!withinEnd(date, i, series.end, series.timeZone)) {
      ended = true;
      break;
    }
    if (i >= next) {
      next = i + 1;
      // An occurrence that's already happening (it has an end) still counts.
      const end = occurrenceEnd(series, date);
      if ((end ?? date).getTime() > now) {
        const id = occurrenceId(series, i);
        if (!existing.has(id)) {
          const stamp = toLocalISO(new Date(now));
          const item: Item = {
            id,
            title: occurrenceTitle(series, i),
            type: series.template.type,
            dateTime: toLocalISO(date),
            createdAt: stamp,
            updatedAt: stamp,
            source: "manual",
            seriesId: series.id,
          };
          if (series.allDay) item.allDay = true;
          if (series.categoryId) item.categoryId = series.categoryId;
          if (series.template.notes) item.notes = series.template.notes;
          if (series.template.location) item.location = series.template.location;
          if (series.template.duration && end) item.endDateTime = toLocalISO(end);
          added.push(item);
        }
        upcoming++;
      }
    }
    i++;
    if (i > 100_000) break;
  }

  return { series: next === series.nextIndex ? series : { ...series, nextIndex: next }, added, ended };
}

/**
 * When an occurrence starting at `date` ends: its series' duration, or, for
 * all-day events, the end of the day. null for deadlines and moments.
 */
export function occurrenceEnd(series: Series, date: Date): Date | null {
  if (series.template.type !== "starts") return null;
  if (series.template.duration) return endAfter(date, series.template.duration, Boolean(series.allDay));
  return series.allDay ? endAfter(date, 1440, true) : null;
}

/** True once a series has generated its last occurrence. */
export function hasEnded(series: Series): boolean {
  return occurrenceAt(series, series.nextIndex) === null;
}

/**
 * A Date whose *local* fields equal the wall-clock fields of `date` in
 * `timeZone` (or `date` itself when no zone). For calendar checks such as
 * day-of-month or weekday on the series' own clock.
 */
export function wallDate(date: Date, timeZone?: string): Date {
  const w = timeZone ? instantToWallTime(date.getTime(), timeZone) : null;
  return w ? new Date(w.year, w.month - 1, w.day, w.hour, w.minute, w.second) : date;
}

/** Index of an occurrence within its series, from its deterministic id (the first occurrence is 0). */
export function occurrenceIndex(series: Series, item: Item): number {
  const prefix = `${series.id}~${series.epoch}~`;
  return item.id.startsWith(prefix) ? Number(item.id.slice(prefix.length)) || 0 : 0;
}

/** The title of occurrence `index`: numbered when the series numbers its titles. */
export function occurrenceTitle(series: Series, index: number): string {
  return series.numberFrom === undefined ? series.template.title : renderTitle(series.template.title, index, series.numberFrom);
}
