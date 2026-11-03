import ICAL from "ical.js";
import { toLocalISO } from "./dates";
import { MAX_LOCATION } from "./events";
import { occurrenceId, occurrences, wallDate, wallYmd, WINDOW, type RepeatEnd, type RepeatRule, type Series } from "./recurrence";
import { localTimeZone, resolveTimeZone, sameZone, zonedTimeToInstant } from "./timezone";
import type { Item, ItemType } from "./types";

// iCalendar import: turns a .ics document into import candidates.
//
//  - Only upcoming events are offered; past ones are counted, not listed.
//  - Times honour TZID: zones defined in the file (VTIMEZONE, e.g. Outlook's
//    "Pacific Standard Time") via ical.js, IANA names without a definition
//    (common from Google) via the browser's time-zone data; otherwise the
//    time is treated as floating local time.
//  - Repeating events whose rule fits the app's model become real series
//    that keep generating; others become a fixed stack of their next
//    occurrences. EXDATE and moved occurrences (RECURRENCE-ID) are honoured.
//  - VTODOs with a DUE date import as Due items.
//  - An event's end (DTEND or DURATION) and LOCATION are kept; a single
//    all-day day and a zero-length event need no stored end.

export class ImportError extends Error {}

export type Candidate =
  | { kind: "item"; item: Item }
  /** `series` is null when the rule can't be represented: the items are then a fixed stack. */
  | { kind: "series"; seriesId: string; series: Series | null; items: Item[]; uid?: string };

export interface ParsedCalendar {
  /** X-WR-CALNAME, if the calendar has one. */
  name?: string;
  candidates: Candidate[];
  /** Events that are entirely in the past (not offered). */
  pastHidden: number;
  /** Upcoming events left out beyond MAX_CANDIDATES. */
  truncated: number;
}

export const MAX_CANDIDATES = 300;
const MAX_NOTES = 2000;
const MAX_TITLE = 200;
/** Cap on recurrence iterations per event (e.g. a daily event since 2015). */
const MAX_ITERATIONS = 20_000;

const INVALID = "This file isn't a valid calendar (.ics).";

export function parseIcs(text: string, now = Date.now(), newId: () => string = () => crypto.randomUUID()): ParsedCalendar {
  if (!/BEGIN:VCALENDAR/i.test(text)) throw new ImportError(INVALID);
  let jcal: unknown;
  try {
    jcal = ICAL.parse(text);
  } catch {
    throw new ImportError(INVALID);
  }
  // A document can hold one or several top-level components.
  const roots = (typeof (jcal as unknown[])[0] === "string" ? [jcal] : (jcal as unknown[])).map(
    (j) => new ICAL.Component(j as never),
  );
  const calendars = roots.filter((c) => c.name === "vcalendar");
  if (calendars.length === 0) throw new ImportError(INVALID);

  // Zones are registered globally in ical.js; start clean for each file.
  ICAL.TimezoneService.reset();
  for (const cal of calendars) {
    for (const tz of cal.getAllSubcomponents("vtimezone")) {
      try {
        ICAL.TimezoneService.register(tz);
      } catch {
        // A broken zone definition falls back to the IANA/floating paths.
      }
    }
  }

  const components = calendars.flatMap((c) => [...c.getAllSubcomponents("vevent"), ...c.getAllSubcomponents("vtodo")]);
  const masters: ICAL.Component[] = [];
  const exceptions = new Map<string, ICAL.Component[]>();
  for (const comp of components) {
    const uid = text0(comp.getFirstPropertyValue("uid"));
    if (comp.hasProperty("recurrence-id") && uid) {
      exceptions.set(uid, [...(exceptions.get(uid) ?? []), comp]);
    } else {
      masters.push(comp);
    }
  }

  const today = startOfLocalDay(now);
  const found: { at: number; candidate: Candidate }[] = [];
  let pastHidden = 0;

  for (const comp of masters) {
    try {
      const result = convert(comp, exceptions.get(text0(comp.getFirstPropertyValue("uid")) ?? "") ?? [], now, today, newId);
      if (result === "past") pastHidden++;
      else if (result) found.push(result);
    } catch {
      // One malformed event shouldn't sink the whole import.
    }
  }

  found.sort((a, b) => a.at - b.at);
  const name = text0(calendars[0]!.getFirstPropertyValue("x-wr-calname")) || undefined;
  return {
    ...(name ? { name } : {}),
    candidates: found.slice(0, MAX_CANDIDATES).map((f) => f.candidate),
    pastHidden,
    truncated: Math.max(0, found.length - MAX_CANDIDATES),
  };
}

// ── One component ─────────────────────────────────────────────

function convert(
  comp: ICAL.Component,
  related: ICAL.Component[],
  now: number,
  today: number,
  newId: () => string,
): { at: number; candidate: Candidate } | "past" | null {
  const status = String(comp.getFirstPropertyValue("status") ?? "").toUpperCase();
  if (status === "CANCELLED") return null;
  const isTodo = comp.name === "vtodo";
  if (isTodo && status === "COMPLETED") return null;

  const startProp = isTodo ? (comp.getFirstProperty("due") ?? comp.getFirstProperty("dtstart")) : comp.getFirstProperty("dtstart");
  if (!startProp) return null;
  const startTime = startProp.getFirstValue() as ICAL.Time;
  const allDay = startTime.isDate;
  const tzid = startProp.getParameter("tzid") as string | undefined;

  const marker = String(comp.getFirstPropertyValue("x-countdown-type") ?? "").toLowerCase();
  const type: ItemType = marker === "due" || marker === "starts" ? marker : isTodo ? "due" : "starts";
  const title = clip(text0(comp.getFirstPropertyValue("summary")).trim(), MAX_TITLE) || "Untitled event";
  const notes = clip(text0(comp.getFirstPropertyValue("description")).trim(), MAX_NOTES) || undefined;
  const uid = text0(comp.getFirstPropertyValue("uid")) || undefined;
  const location = clip(text0(comp.getFirstPropertyValue("location")).trim(), MAX_LOCATION) || undefined;
  const stamp = toLocalISO(new Date(now));

  /** An occurrence's end, when it's worth storing (events only, after the start, not a default single day). */
  const endField = (when: Date, end: Date | null): Partial<Item> => {
    if (type !== "starts" || !end || end <= when) return {};
    if (allDay && end.getTime() === new Date(when.getFullYear(), when.getMonth(), when.getDate() + 1).getTime()) return {};
    return { endDateTime: toLocalISO(end) };
  };

  const makeItem = (id: string, when: Date, extra: Partial<Item> = {}): Item => {
    const item: Item = {
      id,
      title,
      type,
      dateTime: toLocalISO(when),
      createdAt: stamp,
      updatedAt: stamp,
      source: "import",
      ...extra,
    };
    if (allDay) item.allDay = true;
    if (notes) item.notes = notes;
    if (location && item.location === undefined) item.location = location;
    return item;
  };
  const isUpcoming = (when: Date) => (allDay ? when.getTime() >= today : when.getTime() > now);

  const recurring = !isTodo && (comp.hasProperty("rrule") || comp.hasProperty("rdate"));
  if (!recurring) {
    const when = toLocal(startTime, tzid);
    const end = isTodo ? null : endOfComponent(comp, when, tzid);
    // A running event is still worth importing; one that's over isn't.
    if (!isUpcoming(when) && !(end && end.getTime() > now && type === "starts")) return "past";
    return { at: when.getTime(), candidate: { kind: "item", item: makeItem(newId(), when, { ...(uid ? { uid } : {}), ...endField(when, end) }) } };
  }

  // Expand with ical.js, which applies EXDATE, RDATE and moved occurrences.
  const event = new ICAL.Event(comp, { strictExceptions: false });
  for (const ex of related) {
    try {
      event.relateException(ex);
    } catch {
      // Ignore exceptions that don't belong to this event.
    }
  }
  const upcoming: Date[] = [];
  /** Per occurrence: its own end and place (a moved or edited occurrence can differ from the series). */
  const extras = new Map<number, Partial<Item>>();
  const iterator = event.iterator();
  let guard = 0;
  for (let next = iterator.next(); next && upcoming.length < WINDOW; next = iterator.next()) {
    if (++guard > MAX_ITERATIONS) break;
    const details = event.getOccurrenceDetails(next);
    const source = details.item.component;
    if (String(source.getFirstPropertyValue("status") ?? "").toUpperCase() === "CANCELLED") continue;
    const zone = (source.getFirstProperty("dtstart")?.getParameter("tzid") as string | undefined) ?? tzid;
    const when = toLocal(details.startDate, zone);
    const end = details.endDate ? toLocal(details.endDate, (source.getFirstProperty("dtend")?.getParameter("tzid") as string | undefined) ?? zone) : null;
    if (!isUpcoming(when) && !(end && end.getTime() > now && type === "starts")) continue;
    upcoming.push(when);
    const place = clip(text0(source.getFirstPropertyValue("location")).trim(), MAX_LOCATION) || undefined;
    extras.set(when.getTime(), { ...endField(when, end), ...(place !== location ? { location: place } : {}) });
  }
  if (upcoming.length === 0) return "past";

  const start = toLocal(startTime, tzid);
  // Follow the source zone's clock when it differs from ours, so generated
  // occurrences stay at e.g. 9:30 IST through our DST changes.
  const resolved = !allDay && tzid ? resolveTimeZone(tzid) : null;
  const zone = resolved && !sameZone(resolved, localTimeZone()) ? resolved : undefined;
  const recur = comp.getFirstPropertyValue("rrule") as ICAL.Recur | null;
  const mapped = recur && !comp.hasProperty("rdate") ? mapRecur(recur, start, zone) : null;

  if (!mapped) {
    // Fixed stack: the next occurrences, without a rule to generate more.
    const seriesId = newId();
    const items = upcoming.map((when) => makeItem(newId(), when, { seriesId, ...extras.get(when.getTime()) }));
    return { at: upcoming[0]!.getTime(), candidate: { kind: "series", seriesId, series: null, items, ...(uid ? { uid } : {}) } };
  }

  // The series' own length, from the master event (DTEND − DTSTART, or DURATION).
  const masterEnd = endOfComponent(comp, start, tzid);
  const duration = type === "starts" && masterEnd ? lengthOf(start, masterEnd, allDay) : undefined;

  const series: Series = {
    id: newId(),
    epoch: 0,
    start: toLocalISO(start),
    rule: mapped.rule,
    end: mapped.end,
    template: { title, type, ...(notes ? { notes } : {}), ...(duration ? { duration } : {}), ...(location ? { location } : {}) },
    nextIndex: 0,
    ...(uid ? { uid } : {}),
  };
  if (allDay) series.allDay = true;
  if (zone) series.timeZone = zone;

  // Line ical.js's occurrences up with the app's own indices, so the app can
  // continue the series after them. Occurrences that don't match a rule date
  // (moved, or a zone that shifts DST differently) keep their own id.
  const last = upcoming[upcoming.length - 1]!.getTime();
  const indexOf = new Map<number, number>();
  let i = 0;
  for (const date of occurrences(start, mapped.rule, series.timeZone)) {
    if (date.getTime() > last || i > MAX_ITERATIONS) break;
    indexOf.set(date.getTime(), i);
    i++;
  }
  series.nextIndex = Math.max(1, i);
  const items = upcoming.map((when) => {
    const index = indexOf.get(when.getTime());
    return makeItem(index === undefined ? newId() : occurrenceId(series, index), when, { seriesId: series.id, ...extras.get(when.getTime()) });
  });
  return { at: upcoming[0]!.getTime(), candidate: { kind: "series", seriesId: series.id, series, items, ...(uid ? { uid } : {}) } };
}

// ── Times ─────────────────────────────────────────────────────

/** Where a VEVENT ends: DTEND, else DTSTART + DURATION, else null (a moment, or one all-day day). */
function endOfComponent(comp: ICAL.Component, start: Date, tzid: string | undefined): Date | null {
  const endProp = comp.getFirstProperty("dtend");
  if (endProp) return toLocal(endProp.getFirstValue() as ICAL.Time, (endProp.getParameter("tzid") as string | undefined) ?? tzid);
  const duration = comp.getFirstPropertyValue("duration") as ICAL.Duration | null;
  if (!duration) return null;
  // All-day lengths count days, so a day that changes the clocks still ends at midnight.
  if ((comp.getFirstPropertyValue("dtstart") as ICAL.Time | null)?.isDate) {
    return new Date(start.getFullYear(), start.getMonth(), start.getDate() + Math.round(duration.toSeconds() / 86_400));
  }
  return new Date(start.getTime() + duration.toSeconds() * 1000);
}

/** A series' duration in minutes (whole days for all-day), or undefined when it's the default. */
function lengthOf(start: Date, end: Date, allDay: boolean): number | undefined {
  if (end <= start) return undefined;
  if (allDay) {
    const days = Math.round((end.getTime() - start.getTime()) / 86_400_000);
    return days > 1 ? days * 1440 : undefined;
  }
  return Math.round((end.getTime() - start.getTime()) / 60_000);
}

/** An ICAL.Time as a local Date, honouring its TZID (see module comment). */
function toLocal(time: ICAL.Time, tzid: string | undefined): Date {
  if (time.isDate) return new Date(time.year, time.month - 1, time.day);
  if (time.zone?.tzid === "UTC") return time.toJSDate();
  if (tzid && time.zone?.tzid === tzid && time.zone !== ICAL.Timezone.localTimezone) return time.toJSDate();
  const zone = tzid ? resolveTimeZone(tzid) : null;
  if (zone) {
    const instant = zonedTimeToInstant(time, zone);
    if (instant !== null) return new Date(instant);
  }
  return new Date(time.year, time.month - 1, time.day, time.hour, time.minute, time.second);
}

// ── Rules ─────────────────────────────────────────────────────

const DAY_CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const KNOWN_PARTS = new Set(["freq", "interval", "count", "until", "byday", "bymonthday", "bymonth", "wkst"]);
const asArray = <T,>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

/**
 * Maps an RRULE onto the app's repeat model, or returns null when it can't be
 * represented exactly (e.g. "second Tuesday", BYSETPOS, hourly).
 */
export function mapRecur(recur: ICAL.Recur, startInstant: Date, timeZone?: string): { rule: RepeatRule; end: RepeatEnd } | null {
  // Day, weekday and month checks use the series' own clock.
  const start = wallDate(startInstant, timeZone);
  const data = recur.toJSON() as Record<string, unknown>;
  if (Object.keys(data).some((k) => !KNOWN_PARTS.has(k))) return null;
  const freq = String(data.freq);
  if (freq !== "DAILY" && freq !== "WEEKLY" && freq !== "MONTHLY" && freq !== "YEARLY") return null;

  const interval = Number(data.interval ?? 1);
  if (!Number.isInteger(interval) || interval < 1) return null;
  const rule: RepeatRule = { freq, interval };

  const byday = asArray(data.byday as string | string[] | undefined).map(String);
  const bymonthday = asArray(data.bymonthday as number | number[] | undefined).map(Number);
  const bymonth = asArray(data.bymonth as number | number[] | undefined).map(Number);
  const day = start.getDate();

  if (byday.length) {
    if (freq !== "WEEKLY") return null;
    const days = byday.map((code) => DAY_CODES.indexOf(code));
    if (days.some((d) => d < 0)) return null; // "2TU" and friends
    const unique = [...new Set(days)].sort();
    if (!(unique.length === 1 && unique[0] === start.getDay())) rule.weekdays = unique;
  }

  if (bymonthday.length) {
    if (bymonthday.length !== 1) return null;
    const md = bymonthday[0]!;
    const lastDayStart = md === -1 && day === 31; // app's month-end rule
    const febLast = md === -1 && freq === "YEARLY" && start.getMonth() === 1 && day === 29;
    if (freq === "MONTHLY" && !(md === day || lastDayStart)) return null;
    if (freq === "YEARLY" && !(md === day || febLast)) return null;
    if (freq !== "MONTHLY" && freq !== "YEARLY") return null;
  }

  if (bymonth.length) {
    if (freq !== "YEARLY" || bymonth.length !== 1 || bymonth[0] !== start.getMonth() + 1) return null;
  }

  let end: RepeatEnd = { type: "never" };
  if (data.count !== undefined) {
    const count = Number(data.count);
    if (!Number.isInteger(count) || count < 1) return null;
    end = { type: "count", count };
  } else if (data.until !== undefined) {
    const until = recur.until!;
    end = {
      type: "until",
      date: until.isDate ? ymd(new Date(until.year, until.month - 1, until.day)) : wallYmd(until.toJSDate(), timeZone),
    };
  }
  return { rule, end };
}

// ── Helpers ───────────────────────────────────────────────────

const text0 = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function startOfLocalDay(t: number): number {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}
