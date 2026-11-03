import { computed, signal } from "@preact/signals";
import { stepAnchor, type CalendarView } from "../lib/agenda";
import { toDateParts } from "../lib/calendar";
import type { DateParts } from "../lib/parse";
import { categories } from "./store";

// Which view the page shows (the list or a calendar), and where the calendar
// is. Kept per page in localStorage: the side panel and the calendar opened
// in a tab each remember their own view, so switching the tab to Week
// doesn't change the panel. Like the theme cache, this is a convenience;
// nothing here is the user's data.

export type View = "list" | CalendarView;

const VIEWS = new Set<View>(["list", "day", "days3", "week", "month"]);

/** This page is the calendar opened in its own tab, not the side panel. */
export const inTab = typeof location !== "undefined" && new URLSearchParams(location.search).has("tab");

const VIEW_KEY = inTab ? "countdown-view-tab" : "countdown-view-panel";
const HIDDEN_KEY = "countdown-calendar-hidden";

function read<T>(key: string, parse: (raw: string) => T | null, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return (raw !== null && parse(raw)) || fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Not saved: the page still works, it just won't remember.
  }
}

export const view = signal<View>(read(VIEW_KEY, (raw) => (VIEWS.has(raw as View) ? (raw as View) : null), inTab ? "week" : "list"));

/** Wide enough for a 7-day week: the calendar's own tab, or a side panel dragged wider. */
const wideQuery = typeof matchMedia !== "undefined" ? matchMedia("(min-width: 600px)") : null;
export const wide = signal(wideQuery?.matches ?? false);
wideQuery?.addEventListener("change", (e) => (wide.value = e.matches));

/** The view actually shown: Week falls back to 3 days when there isn't room. */
export const shownView = computed<View>(() => (view.value === "week" && !wide.value ? "days3" : view.value));

/** The day the calendar is on (the first day shown, or the week/month containing it). */
export const anchor = signal<DateParts>(toDateParts(new Date()));

/** Categories hidden from the calendar ("none" = items without a category). */
export const hiddenCategories = signal<ReadonlySet<string>>(
  new Set(read(HIDDEN_KEY, (raw) => (Array.isArray(JSON.parse(raw)) ? (JSON.parse(raw) as string[]) : null), [])),
);

export function setView(next: View) {
  view.value = next;
  write(VIEW_KEY, next);
}

export function goToday() {
  anchor.value = toDateParts(new Date());
}

export function step(dir: 1 | -1) {
  const v = shownView.value;
  if (v !== "list") anchor.value = stepAnchor(v, anchor.value, dir);
}

export function setCategoryShown(key: string, shown: boolean) {
  const next = new Set(hiddenCategories.value);
  if (shown) next.delete(key);
  else next.add(key);
  hiddenCategories.value = next;
  write(HIDDEN_KEY, JSON.stringify([...next]));
}

/** An item's category, if it still exists. */
export const categoryOf = (id: string | undefined) => (id ? categories.value.find((c) => c.id === id) : undefined);

/** Opens this page in a full browser tab, where there's room for a week. */
export function openInTab() {
  const path = "sidepanel/index.html?tab";
  if (typeof chrome !== "undefined" && chrome.tabs?.create && chrome.runtime?.getURL) {
    void chrome.tabs.create({ url: chrome.runtime.getURL(path) });
  } else {
    // Local preview outside the extension.
    window.open(`${location.pathname}?tab`, "_blank", "noopener");
  }
}
