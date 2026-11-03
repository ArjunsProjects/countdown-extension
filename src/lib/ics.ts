import ICAL from "ical.js";
import { endAfter, endOf } from "./events";
import { occurrenceEnd, occurrenceId, occurrenceIndex, occurrences, occurrenceTitle, wallDate, withinEnd, type RepeatEnd, type Series } from "./recurrence";
import { zonedTimeToInstant } from "./timezone";
import { buildVtimezone } from "./vtimezone";
import type { Item } from "./types";

// iCalendar (RFC 5545) export. Import arrives in Phase 5 in this same module.
//
// Time handling:
//  - One-off timed items are written in UTC (…Z), an unambiguous instant.
//  - Repeating series use floating local time (no Z, no TZID): "10:00 every
//    Monday" stays 10:00 across daylight-saving changes in whichever zone
//    the calendar is in. A series that follows another zone (imported, e.g.
//    9:30 IST) is written with TZID=<IANA name> plus a generated VTIMEZONE.
//  - All-day items use VALUE=DATE.
//  - Events with an end get DTEND (exclusive, so an all-day event ending on
//    the 12th has DTEND 13th; a single all-day day needs none). Deadlines and
//    events without an end are points in time with no DTEND (RFC 5545
//    §3.6.1: the event ends when it starts).
//  - LOCATION carries the event's place.

export const PRODID = "-//Countdown//Countdown Chrome Extension//EN";

/** One thing to export: a single item, or a whole repeating series. */
export type ExportEntry = { kind: "item"; item: Item } | { kind: "series"; series: Series; upcoming: Item[] };

const floating = (d: Date, isDate = false) =>
  ICAL.Time.fromData(
    isDate
      ? { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate(), isDate: true }
      : {
          year: d.getFullYear(),
          month: d.getMonth() + 1,
          day: d.getDate(),
          hour: d.getHours(),
          minute: d.getMinutes(),
          second: d.getSeconds(),
        },
  );

const utc = (d: Date) => ICAL.Time.fromJSDate(d, true);

export { occurrenceIndex } from "./recurrence";

/**
 * RRULE for a series exported from occurrence `fromIndex`.
 *
 * Month-end handling avoids BYSETPOS, which some calendar engines expand
 * incorrectly (ical.js does):
 *  - Monthly on the 31st → BYMONTHDAY=-1 (last day of each month): exact.
 *  - Annually on 29 Feb  → BYMONTH=2;BYMONTHDAY=-1 (last day of Feb): exact.
 *  - Monthly on the 29th/30th → BYMONTHDAY=29/30: other calendars skip
 *    months without that day (February), where the app uses the last day.
 * BYMONTHDAY is explicit so a DTSTART that was itself clamped (e.g. 28 Feb
 * in a 30th-of-month series) doesn't pull later dates back to the 28th.
 */
export function recurFor(series: Series, fromIndex = 0, allDay = series.allDay ?? false): ICAL.Recur {
  const { rule, end } = series;
  // Day and month checks happen on the series' own clock.
  const start = wallDate(new Date(series.start), series.timeZone);
  const data: Record<string, unknown> = { freq: rule.freq };
  if (rule.interval > 1) data.interval = rule.interval;
  if (rule.freq === "WEEKLY" && rule.weekdays?.length) {
    data.byday = rule.weekdays.map((d) => ["SU", "MO", "TU", "WE", "TH", "FR", "SA"][d]);
  }
  const day = start.getDate();
  if (rule.freq === "MONTHLY" && day > 28) data.bymonthday = [day === 31 ? -1 : day];
  if (rule.freq === "YEARLY" && start.getMonth() === 1 && day === 29) {
    data.bymonth = [2];
    data.bymonthday = [-1];
  }
  applyEnd(data, end, fromIndex, allDay, series.timeZone);
  return ICAL.Recur.fromData(data);
}

function applyEnd(data: Record<string, unknown>, end: RepeatEnd, fromIndex: number, allDay: boolean, timeZone?: string) {
  if (end.type === "count") data.count = Math.max(1, end.count - fromIndex);
  if (end.type === "until") {
    const [y, m, d] = end.date.split("-").map(Number) as [number, number, number];
    if (allDay) data.until = ICAL.Time.fromData({ year: y, month: m, day: d, isDate: true });
    else if (timeZone) {
      // With a TZID'd DTSTART, UNTIL must be in UTC (RFC 5545 §3.3.10).
      const instant = zonedTimeToInstant({ year: y, month: m, day: d, hour: 23, minute: 59, second: 59 }, timeZone)!;
      data.until = ICAL.Time.fromJSDate(new Date(instant), true);
    } else data.until = ICAL.Time.fromData({ year: y, month: m, day: d, hour: 23, minute: 59, second: 59 });
  }
}

function baseEvent(uid: string, title: string, type: Item["type"], notes: string | undefined, now: Date, location?: string) {
  const ev = new ICAL.Component("vevent");
  ev.updatePropertyWithValue("uid", uid);
  ev.updatePropertyWithValue("dtstamp", utc(now));
  ev.updatePropertyWithValue("summary", title);
  if (notes) ev.updatePropertyWithValue("description", notes);
  if (location) ev.updatePropertyWithValue("location", location);
  // Lets a round trip through the file restore Due vs Starts exactly.
  ev.updatePropertyWithValue("x-countdown-type", type);
  return ev;
}

function itemEvent(item: Item, now: Date) {
  const ev = baseEvent(item.uid ?? `${item.id}@countdown`, item.title, item.type, item.notes, now, item.location);
  const when = new Date(item.dateTime);
  ev.updatePropertyWithValue("dtstart", item.allDay ? floating(when, true) : utc(when));
  // An all-day event without its own end is one day, which DTSTART alone says.
  const end = item.endDateTime ? endOf(item) : null;
  if (end !== null) ev.updatePropertyWithValue("dtend", item.allDay ? floating(new Date(end), true) : utc(new Date(end)));
  return ev;
}

/**
 * Whether an RFC 5545 engine would produce this occurrence from our RRULE.
 * Only differs for monthly series on the 29th/30th, where the app uses the
 * last day of a shorter month but the exported rule skips that month.
 */
function inRfcSet(series: Series, date: Date): boolean {
  const day = wallDate(new Date(series.start), series.timeZone).getDate();
  if (series.rule.freq === "MONTHLY" && (day === 29 || day === 30)) {
    return wallDate(date, series.timeZone).getDate() === day;
  }
  return true;
}

/** Sets DTSTART / DTEND / adds EXDATE for a series time: floating, or TZID'd for a zoned series. */
function seriesTime(ev: ICAL.Component, name: "dtstart" | "dtend" | "exdate", series: Series, date: Date, allDay: boolean) {
  const zone = allDay ? undefined : series.timeZone;
  const value = floating(wallDate(date, zone), allDay);
  const prop = name === "exdate" ? ev.addPropertyWithValue(name, value) : ev.updatePropertyWithValue(name, value);
  if (zone) prop.setParameter("tzid", zone);
}

/**
 * A series becomes one repeating VEVENT plus, where needed:
 *  - EXDATE for occurrences the user removed or moved;
 *  - standalone VEVENTs for occurrences that were moved, or that the
 *    exported rule can't produce (see inRfcSet).
 * The repeating event starts at the first upcoming occurrence that matches
 * the rule, so DTSTART is always synchronized with the RRULE (RFC 5545
 * leaves the result undefined otherwise).
 */
function seriesEvents(series: Series, upcoming: Item[], allItems: readonly Item[], now: Date): ICAL.Component[] {
  const head = upcoming[0]!;
  const fromIndex = occurrenceIndex(series, head);
  const allDay = series.allDay ?? false;
  const own = allItems.filter((i) => i.seriesId === series.id);
  const byIndex = new Map(own.map((i) => [occurrenceIndex(series, i), i]));

  const out: ICAL.Component[] = [];
  const exdates: Date[] = [];
  let dtIndex = -1;
  let dtDate: Date | null = null;

  let i = 0;
  for (const date of occurrencesFrom(series)) {
    if (!withinEndOf(series, date, i)) break;
    if (i >= fromIndex) {
      const item = byIndex.get(i);
      const generated = i < series.nextIndex;
      // Moved, renamed, or given its own end or place: exported as its own event plus an EXDATE.
      const moved =
        item !== undefined &&
        (Date.parse(item.dateTime) !== date.getTime() ||
          item.customTitle === true ||
          endOf(item) !== (occurrenceEnd(series, date)?.getTime() ?? null) ||
          (item.location ?? "") !== (series.template.location ?? ""));
      const synced = inRfcSet(series, date);

      if (dtIndex < 0) {
        // Candidate start: matches the rule and is either not yet generated or present and unmoved.
        if (synced && (!generated || (item && !moved))) {
          dtIndex = i;
          dtDate = date;
        } else if (item) {
          out.push(occurrenceEvent(series, item, i, now));
        }
      } else if (generated) {
        if (!item || moved) {
          if (synced) exdates.push(date);
          if (item) out.push(occurrenceEvent(series, item, i, now));
        } else if (!synced) {
          out.push(occurrenceEvent(series, item, i, now));
        }
      }
    }
    if (i >= series.nextIndex && dtIndex >= 0) break;
    if (++i > 100_000) break;
  }

  if (dtIndex >= 0 && dtDate) {
    const { template } = series;
    const ev = baseEvent(series.uid ?? `${series.id}@countdown`, template.title, template.type, template.notes, now, template.location);
    seriesTime(ev, "dtstart", series, dtDate, allDay);
    if (template.type === "starts" && template.duration) seriesTime(ev, "dtend", series, endAfter(dtDate, template.duration, allDay), allDay);
    ev.updatePropertyWithValue("rrule", recurFor(series, dtIndex, allDay));
    for (const d of exdates) seriesTime(ev, "exdate", series, d, allDay);
    out.unshift(ev);
  }
  return out;
}

/** Most events written for one series exported occurrence by occurrence. */
const MAX_LISTED = 104;

/**
 * Whether a series must be exported as separate events: hand-picked dates
 * have no RRULE equivalent, and numbered titles differ per occurrence.
 */
export const exportsAsList = (series: Series) => series.rule.freq === "DATES" || series.numberFrom !== undefined;

/**
 * Separate VEVENTs for each upcoming occurrence: existing ones as they are
 * (moved dates and all), later ones generated from the template. Endless
 * series stop after MAX_LISTED events.
 */
function listedEvents(series: Series, upcoming: Item[], allItems: readonly Item[], now: Date): ICAL.Component[] {
  const fromIndex = occurrenceIndex(series, upcoming[0]!);
  const byId = new Map(allItems.filter((i) => i.seriesId === series.id).map((i) => [i.id, i]));
  const out: ICAL.Component[] = [];
  let i = 0;
  for (const date of occurrencesFrom(series)) {
    if (!withinEndOf(series, date, i) || out.length >= MAX_LISTED) break;
    if (i >= fromIndex) {
      if (i < series.nextIndex) {
        // Already generated: export what exists (removed ones are skipped).
        const item = i === fromIndex ? upcoming[0] : byId.get(occurrenceId(series, i));
        if (item && !item.completedAt) out.push(occurrenceEvent(series, item, i, now));
      } else {
        const item: Item = {
          id: occurrenceId(series, i),
          title: occurrenceTitle(series, i),
          type: series.template.type,
          dateTime: date.toISOString(),
          createdAt: "",
          updatedAt: "",
          source: "manual",
          ...(series.allDay ? { allDay: true } : {}),
          ...(series.template.notes ? { notes: series.template.notes } : {}),
          ...(series.template.location ? { location: series.template.location } : {}),
          ...(series.template.type === "starts" && series.template.duration
            ? { endDateTime: endAfter(date, series.template.duration, Boolean(series.allDay)).toISOString() }
            : {}),
        };
        out.push(occurrenceEvent(series, item, i, now));
      }
    }
    if (++i > 100_000) break;
  }
  return out;
}

/** A single occurrence exported on its own (moved, or outside the exported rule). */
function occurrenceEvent(series: Series, item: Item, index: number, now: Date) {
  const ev = itemEvent(item, now);
  ev.updatePropertyWithValue("uid", `${series.id}-${index}@countdown`);
  return ev;
}

const withinEndOf = (series: Series, date: Date, index: number) => withinEnd(date, index, series.end, series.timeZone);

const occurrencesFrom = (series: Series) => occurrences(new Date(series.start), series.rule, series.timeZone);

/** Builds a complete VCALENDAR document. Lines end in CRLF and fold at 75 octets. */
export function buildIcs(entries: readonly ExportEntry[], allItems: readonly Item[], now = new Date()): string {
  const cal = new ICAL.Component(["vcalendar", [], []]);
  cal.updatePropertyWithValue("prodid", PRODID);
  cal.updatePropertyWithValue("version", "2.0");
  cal.updatePropertyWithValue("calscale", "GREGORIAN");
  cal.updatePropertyWithValue("method", "PUBLISH");
  // One VTIMEZONE per zone used by a zoned series.
  const zones = new Map<string, Date>();
  for (const e of entries) {
    if (e.kind === "series" && e.series.timeZone && !e.series.allDay && !exportsAsList(e.series) && !zones.has(e.series.timeZone)) {
      zones.set(e.series.timeZone, new Date(e.upcoming[0]?.dateTime ?? e.series.start));
    }
  }
  for (const [zone, from] of zones) cal.addSubcomponent(buildVtimezone(zone, from));

  for (const entry of entries) {
    const events =
      entry.kind === "item"
        ? [itemEvent(entry.item, now)]
        : exportsAsList(entry.series)
          ? listedEvents(entry.series, entry.upcoming, allItems, now)
          : seriesEvents(entry.series, entry.upcoming, allItems, now);
    for (const ev of events) cal.addSubcomponent(ev);
  }
  // RFC 5545 requires every content line, including the last, to end in CRLF.
  return `${cal.toString()}\r\n`;
}

/** A file name for the export: the item's title for one entry, else a dated name. */
export function exportFileName(entries: readonly ExportEntry[], now = new Date()): string {
  if (entries.length === 1) {
    const e = entries[0]!;
    const title = e.kind === "item" ? e.item.title : (e.upcoming[0]?.title ?? "series");
    const slug = title
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60);
    if (slug) return `${slug}.ics`;
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  return `countdown-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.ics`;
}
