import { relativeLabel } from "./countdown";
import { formatClock, formatShortDateTime } from "./dates";
import { endOf, formatClockRangeShort } from "./events";
import type { Series } from "./recurrence";
import type { Item, ItemType } from "./types";

// Reminders: a notification some time before a deadline or the start of an
// event. An item uses its own reminders if it has them, otherwise its
// series', otherwise the defaults for its type. Each is a number of minutes
// before. All-day items count whole days instead and remind at 9 AM.

const DAY = 1440;
const DAY_MS = 86_400_000;

/** Minutes before, as offered for items with a time. */
export const REMINDER_CHOICES: readonly number[] = [0, 5, 10, 15, 30, 60, 120, DAY, 2 * DAY, 7 * DAY];
/** Up to two per item, like Apple Calendar's two alerts. */
export const MAX_REMINDERS = 2;
/** The hour all-day items remind at. */
export const ALL_DAY_HOUR = 9;
/** A timed reminder that comes late (the computer was asleep, Chrome was busy) still shows until this long after its item. */
export const GRACE_MS = 5 * 60_000;
export const SNOOZE_MS = 10 * 60_000;
/** A snoozed reminder comes back up to a day after its item. */
const SNOOZE_LIMIT_MS = DAY_MS;
/** More than this many at once (say, after a weekend with Chrome closed) are summed up in one more notification. */
export const MAX_AT_ONCE = 3;
const MAX_MINUTES = 4 * 7 * DAY;

// Keys in chrome.storage.local shared by the pages and the service worker.
// Each has one writer, so neither can overwrite the other's changes.
/** The worker's: when it last checked, and what's snoozed. */
export const REMINDER_STATE_KEY = "reminderState";
/** The worker's: items marked done from a notification, and when. */
export const REMINDER_DONE_KEY = "reminderDone";
/** A page's: which of those it has applied to the list. */
export const REMINDER_DONE_SEEN_KEY = "reminderDoneSeen";

export interface ReminderDefaults {
  due: number[];
  starts: number[];
}

export const DEFAULT_REMINDERS: ReminderDefaults = { due: [DAY, 60], starts: [15] };

/** Valid reminders, earliest first, or undefined for no list (follow the series or the defaults). */
export function cleanReminders(v: unknown): number[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const valid = v.filter((m): m is number => Number.isInteger(m) && m >= 0 && m <= MAX_MINUTES);
  return [...new Set(valid)].sort((a, b) => b - a).slice(0, MAX_REMINDERS);
}

export function parseReminderDefaults(v: unknown): ReminderDefaults {
  const o = (typeof v === "object" && v !== null ? v : {}) as Record<string, unknown>;
  return { due: cleanReminders(o.due) ?? DEFAULT_REMINDERS.due, starts: cleanReminders(o.starts) ?? DEFAULT_REMINDERS.starts };
}

/** An item's reminders: its own, else its series', else the defaults for its type. */
export function remindersOf(item: Item, owner: Series | undefined, defaults: ReminderDefaults): number[] {
  return cleanReminders(item.reminders) ?? cleanReminders(owner?.template.reminders) ?? defaults[item.type];
}

export type Kind = { type: ItemType; allDay?: boolean };

/** Whole days before an all-day item. A deadline is due as its day begins, so it reminds the day before at the latest. */
const daysBefore = (item: Kind, minutes: number) => Math.max(Math.floor(minutes / DAY), item.type === "due" ? 1 : 0);

/** The choices that make sense for an item: whole days for all-day items. */
export function choicesFor(item: Kind): number[] {
  if (!item.allDay) return [...REMINDER_CHOICES];
  return item.type === "due" ? [DAY, 2 * DAY, 7 * DAY] : [0, DAY, 2 * DAY, 7 * DAY];
}

/** A reminder as it applies to this kind of item (on an all-day event, "15 minutes before" means on the day). */
export const fitReminder = (minutes: number, item: Kind) => (item.allDay ? daysBefore(item, minutes) * DAY : minutes);

export function fitReminders(list: readonly number[], item: Kind): number[] {
  return cleanReminders(list.map((m) => fitReminder(m, item))) ?? [];
}

/** When a reminder goes off. Whole days keep the clock time, even across a daylight-saving change. */
export function reminderTime(item: Item, minutes: number): number {
  const start = new Date(item.dateTime);
  const back = (days: number, hour: number, minute: number) =>
    new Date(start.getFullYear(), start.getMonth(), start.getDate() - days, hour, minute).getTime();
  if (item.allDay) return back(daysBefore(item, minutes), ALL_DAY_HOUR, 0);
  if (minutes % DAY === 0) return back(minutes / DAY, start.getHours(), start.getMinutes());
  return start.getTime() - minutes * 60_000;
}

/** Until when a reminder is worth showing: just after a timed item, through an all-day event, until an all-day deadline. */
export function showUntil(item: Item): number {
  const start = Date.parse(item.dateTime);
  if (!item.allDay) return start + GRACE_MS;
  return item.type === "starts" ? (endOf(item) ?? start) : start;
}

export interface ReminderData {
  items: readonly Item[];
  series: readonly Series[];
  defaults: ReminderDefaults;
  /** Items marked done from a notification that Countdown hasn't applied yet. */
  done?: ReadonlySet<string>;
}

const stillToDo = (item: Item, data: ReminderData) => !item.completedAt && !data.done?.has(item.id);

/** Every reminder going off after `after`, with its item. */
function* upcoming(data: ReminderData, after: number): Generator<{ item: Item; at: number }> {
  const owners = new Map(data.series.map((s) => [s.id, s]));
  for (const item of data.items) {
    if (!stillToDo(item, data) || showUntil(item) <= after) continue;
    const owner = item.seriesId ? owners.get(item.seriesId) : undefined;
    // A reminder whose time had already passed when the item was made, moved or changed doesn't go off late.
    const edited = Date.parse(item.updatedAt);
    for (const minutes of remindersOf(item, owner, data.defaults)) {
      const at = reminderTime(item, minutes);
      if (at > after && !(at <= edited)) yield { item, at };
    }
  }
}

/** What's due between one check and the next: one notification per item, soonest item first. */
export function dueReminders(data: ReminderData, from: number, to: number): Item[] {
  const due = new Map<string, Item>();
  for (const { item, at } of upcoming(data, from)) {
    if (at <= to && to < showUntil(item)) due.set(item.id, item);
  }
  return [...due.values()].sort((a, b) => Date.parse(a.dateTime) - Date.parse(b.dateTime));
}

/** Snoozed items that are back: still to do, and less than a day past. */
export function snoozedDue(data: ReminderData, snoozed: Readonly<Record<string, number>>, now: number): Item[] {
  return data.items.filter(
    (item) => (snoozed[item.id] ?? Infinity) <= now && stillToDo(item, data) && now < Date.parse(item.dateTime) + SNOOZE_LIMIT_MS,
  );
}

/** When the next reminder or snooze ends, if there is one. */
export function nextReminder(data: ReminderData, after: number, snoozed: Readonly<Record<string, number>> = {}): number | null {
  let next = Infinity;
  for (const { at } of upcoming(data, after)) next = Math.min(next, at);
  for (const until of Object.values(snoozed)) if (until > after) next = Math.min(next, until);
  return next === Infinity ? null : next;
}

// ── Words ─────────────────────────────────────────────────────

const startOfDay = (t: number) => {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};
const daysBetween = (from: number, to: number) => Math.round((startOfDay(to) - startOfDay(from)) / DAY_MS);
const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`;
const nineAM = () => formatClock(new Date(2000, 0, 1, ALL_DAY_HOUR)).replace(":00", "");

/** "Due in 1 hour · 11:59 PM", "Starts in 15 minutes · 12:30–2 PM · Swing Space", "Due tomorrow · Fri 6 Nov". */
export function reminderMessage(item: Item, now: number): string {
  const start = Date.parse(item.dateTime);
  const nowDate = new Date(now);
  const day = formatShortDateTime(new Date(start), true, nowDate);
  const days = daysBetween(now, start);
  const parts: string[] = [];
  if (item.allDay) {
    if (item.type === "due") parts.push(days <= 1 ? "Due tomorrow" : `Due in ${plural(days, "day")}`);
    else parts.push(days <= 0 ? "Today" : days === 1 ? "Tomorrow" : `In ${plural(days, "day")}`);
    if (days > 1) parts.push(day);
    if (item.type === "starts") parts.push("All day");
  } else {
    const verb = item.type === "due" ? "Due" : "Starts";
    // To the nearest minute: an alarm comes a few seconds late, and "1 day before" shouldn't read "in 23 hours".
    const left = Math.round((start - now) / 60_000) * 60_000;
    parts.push(left > 0 ? `${verb} ${relativeLabel(start, start - left)}` : item.type === "due" ? "Due now" : "Starting now");
    const end = endOf(item);
    const clock = end !== null && daysBetween(start, end) === 0 ? formatClockRangeShort(new Date(start), new Date(end)) : formatClock(new Date(start));
    parts.push(days === 0 ? clock : `${day}, ${clock}`);
  }
  if (item.location) parts.push(item.location);
  return parts.join(" · ");
}

/** "3 more reminders": the titles, for when several come at once. */
export function summaryMessage(items: readonly Item[]): string {
  const titles = items.map((i) => i.title);
  return titles.length <= 1 ? (titles[0] ?? "") : `${titles.slice(0, -1).join(", ")} and ${titles.at(-1)}`;
}

/** "15 minutes before", "1 day before", "When it's due", "On the day at 9 AM"… */
export function reminderLabel(minutes: number, item: Kind): string {
  if (item.allDay) {
    const days = daysBefore(item, minutes);
    if (days === 0) return `On the day at ${nineAM()}`;
    return `${days === 7 ? "1 week" : plural(days, "day")} before at ${nineAM()}`;
  }
  if (minutes === 0) return item.type === "due" ? "When it's due" : "When it starts";
  if (minutes < 60) return `${plural(minutes, "minute")} before`;
  if (minutes < DAY) return `${plural(minutes / 60, "hour")} before`;
  return `${minutes === 7 * DAY ? "1 week" : plural(minutes / DAY, "day")} before`;
}

/** A list of reminders in a line: "1 day and 1 hour before", "None". */
export function describeReminders(list: readonly number[], item: Kind): string {
  const fitted = fitReminders(list, item);
  if (fitted.length === 0) return "None";
  const labels = fitted.map((m) => reminderLabel(m, item));
  const tail = item.allDay ? ` before at ${nineAM()}` : " before";
  if (labels.every((l) => l.endsWith(tail))) return `${labels.map((l) => l.slice(0, -tail.length)).join(" and ")}${tail}`;
  return labels.map((l, i) => (i === 0 ? l : l[0]!.toLowerCase() + l.slice(1))).join(" and ");
}
