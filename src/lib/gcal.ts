import { endOf } from "./events";
import { occurrenceIndex, recurFor, type ExportEntry } from "./ics";
import { wallDate } from "./recurrence";

// Google Calendar's "create event" link. Times are sent as local wall-clock
// time plus ctz (the user's time zone), which keeps repeating events at the
// same local time across daylight-saving changes.

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
const local = (d: Date) => `${ymd(d)}T${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;

export const GCAL_IMPORT_URL = "https://calendar.google.com/calendar/r/settings/export";

export function googleCalendarUrl(entry: ExportEntry, timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone): string {
  const item = entry.kind === "item" ? entry.item : entry.upcoming[0]!;
  const allDay = entry.kind === "item" ? item.allDay : entry.series.allDay;
  // A series following another zone is sent in that zone's wall time.
  const zone = entry.kind === "series" && !allDay ? entry.series.timeZone : undefined;
  if (zone) timeZone = zone;
  const when = wallDate(new Date(item.dateTime), zone);
  const end = endOf(item);
  const until = end === null ? when : wallDate(new Date(end), zone);

  // All-day: end date is exclusive (a whole day unless the event says otherwise).
  // Timed: its end, or a point in time (start = end).
  const dates = allDay
    ? `${ymd(when)}/${ymd(end === null ? new Date(when.getFullYear(), when.getMonth(), when.getDate() + 1) : until)}`
    : `${local(when)}/${local(until)}`;

  const params = new URLSearchParams({ action: "TEMPLATE", text: item.title, dates, ctz: timeZone });
  if (item.notes) params.set("details", item.notes);
  if (item.location) params.set("location", item.location);
  if (entry.kind === "series") {
    params.set("recur", `RRULE:${recurFor(entry.series, occurrenceIndex(entry.series, item), allDay).toString()}`);
  }
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
