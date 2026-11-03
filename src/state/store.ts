import { batch, signal } from "@preact/signals";
import { formatClock, formatShortDateTime, toLocalISO } from "../lib/dates";
import { durationOf, MAX_LOCATION } from "../lib/events";
import * as ops from "../lib/items";
import { moveIndex, type Category, type CategoryColor } from "../lib/categories";
import { hasNumberToken } from "../lib/numbering";
import { occurrenceIndex, occurrenceTitle, topUp, type RepeatEnd, type RepeatRule, type Series } from "../lib/recurrence";
import {
  DEFAULT_PREFS,
  defaultBackend,
  loadState,
  parseCompletions,
  parseItems,
  parseCategories,
  parsePrefs,
  parseSeries,
  type Prefs,
  type StorageBackend,
} from "../lib/storage";
import type { TimeParts } from "../lib/parse";
import type { CompletionRecord, Item } from "../lib/types";
import { showToast } from "./toast";

export const items = signal<Item[]>([]);
export const completions = signal<CompletionRecord[]>([]);
export const series = signal<Series[]>([]);
export const categories = signal<Category[]>([]);
export const prefs = signal<Prefs>(DEFAULT_PREFS);
export const ready = signal(false);
/** Occurrences removed on some computer (from sync): top-up and the calendar never bring them back. */
export const skipOccurrences = signal<ReadonlySet<string>>(new Set());

let backend: StorageBackend;

export async function initStore(b: StorageBackend = defaultBackend()) {
  backend = b;
  const state = await loadState(backend);
  batch(() => {
    items.value = state.items;
    completions.value = state.completions;
    series.value = state.series;
    categories.value = state.categories;
    prefs.value = state.prefs;
    ready.value = true;
  });
  // Keep side panels in other windows in sync. Changes made together arrive
  // together (see persist), and are applied as one update.
  backend.subscribe((changes) => {
    applyingRemote = true;
    try {
      batch(() => {
        if ("items" in changes) items.value = parseItems(changes.items);
        if ("completions" in changes) completions.value = parseCompletions(changes.completions);
        if ("series" in changes) series.value = parseSeries(changes.series);
        if ("categories" in changes) categories.value = parseCategories(changes.categories);
        if ("prefs" in changes) prefs.value = parsePrefs(changes.prefs);
      });
    } finally {
      applyingRemote = false;
    }
  });
}

/** True while applying another panel's change; effects shouldn't write back then. */
let applyingRemote = false;

// ── Persistence ────────────────────────────────────────────────
// Writes made in the same task (an action plus the effects it triggers,
// such as occurrence top-up) are coalesced into one storage write. Other
// panels then receive items and series together, never one without the
// other, so they can't act on half a change.

type Key = "items" | "completions" | "series" | "categories" | "prefs";
let pending: Partial<Record<Key, unknown>> | null = null;

function persist(key: Key, value: unknown) {
  if (!pending) {
    pending = {};
    queueMicrotask(flush);
  }
  pending[key] = value;
}

function flush() {
  const values = pending;
  pending = null;
  if (values) void backend.set(values);
}

/** Writes anything pending right away (for tests). */
export function flushWrites() {
  flush();
}

function setItems(next: Item[]) {
  persist("items", next);
  items.value = next;
}

function setCompletions(next: CompletionRecord[]) {
  persist("completions", next);
  completions.value = next;
}

function setSeries(next: Series[]) {
  persist("series", next);
  series.value = next;
}

function setCategories(next: Category[]) {
  persist("categories", next);
  categories.value = next;
}

export function setPrefs(patch: Partial<Prefs>) {
  const next = { ...prefs.value, ...patch };
  persist("prefs", next);
  prefs.value = next;
}

/**
 * Moves an item, or changes its end, from the calendar, with Undo. An
 * occurrence the series hasn't generated yet (`virtual`) is created with
 * the new time, and Undo removes it again. Like editing an occurrence's
 * time in the editor, this changes only that occurrence.
 */
export function rescheduleItem(target: Item, patch: { dateTime: string; endDateTime?: string }, virtual: boolean, now = new Date()) {
  const before = items.value.find((i) => i.id === target.id);
  const stamp = toLocalISO(now);
  const base = before ?? { ...target, createdAt: stamp };
  const next: Item = { ...base, dateTime: patch.dateTime, updatedAt: stamp };
  if (patch.endDateTime) next.endDateTime = patch.endDateTime;
  else delete next.endDateTime;
  if (before && Date.parse(before.dateTime) === Date.parse(next.dateTime) && (before.endDateTime ?? "") === (next.endDateTime ?? "")) return;

  if (before) saveItem(next);
  else if (virtual) addItem(next);
  else return;

  const moved = Date.parse(next.dateTime) !== Date.parse(base.dateTime);
  showToast({
    message: moved
      ? `Moved to ${formatShortDateTime(new Date(next.dateTime), next.allDay, now)}`
      : `Now ends ${formatClock(new Date(next.endDateTime!))}`,
    action: {
      label: "Undo",
      run: () => (before ? saveItem(before) : setItems(items.value.filter((i) => i.id !== next.id))),
    },
  });
}

/** Adds an item made on the calendar (quick create). */
export function addFromCalendar(fields: { title: string; type: Item["type"]; start: Date; end: Date | null; categoryId: string | null }, now = new Date()): Item {
  const item = ops.newItem(now);
  item.title = fields.title.trim();
  item.type = fields.type;
  item.dateTime = toLocalISO(fields.start);
  if (fields.type === "starts" && fields.end && fields.end > fields.start) item.endDateTime = toLocalISO(fields.end);
  if (fields.categoryId) item.categoryId = fields.categoryId;
  addItem(item);
  return item;
}

/** Takes the result of merging with other computers (sync), as one change. */
export function applySyncState(next: { items: Item[]; series: Series[]; categories: Category[]; prefs: Prefs }) {
  batch(() => {
    if (next.items !== items.value) setItems(next.items);
    if (next.series !== series.value) setSeries(next.series);
    if (next.categories !== categories.value) setCategories(next.categories);
    if (next.prefs !== prefs.value) {
      persist("prefs", next.prefs);
      prefs.value = next.prefs;
    }
  });
}

/** Puts back a saved state wholesale (restoring the list from before sync). */
export function replaceState(next: { items: Item[]; series: Series[]; categories: Category[]; prefs: Prefs; completions: CompletionRecord[] }) {
  batch(() => {
    applySyncState(next);
    setCompletions(next.completions);
  });
}

// ── Actions ───────────────────────────────────────────────────

export function addItem(item: Item) {
  setItems([...items.value, item]);
}

export function saveItem(item: Item) {
  setItems(items.value.map((i) => (i.id === item.id ? item : i)));
}

/** A series title: the template (may contain {n}) and, if numbered, the first number. */
export interface SeriesTitle {
  template: string;
  numberFrom?: number;
}

/** Keeps numberFrom only when the template actually contains the {n} token. */
const titleFields = (title: SeriesTitle) =>
  hasNumberToken(title.template) ? { numberFrom: title.numberFrom ?? 1 } : { numberFrom: undefined };

/**
 * Applies title/type changes to a series: its template (future occurrences)
 * and every upcoming, uncompleted occurrence, re-numbered by position when
 * the title uses {n}. Past and completed occurrences keep the title they had.
 */
export function saveSeries(seriesId: string, patch: { title: string; type: Item["type"]; numberFrom?: number }, now = new Date()) {
  const t = now.getTime();
  const s = series.value.find((x) => x.id === seriesId);
  const isUpcoming = (i: Item) => i.seriesId === seriesId && !i.completedAt && Date.parse(i.dateTime) > t;
  const stamp = toLocalISO(now);

  if (!s) {
    // A fixed stack (imported rule we can't represent): rename its occurrences.
    const title = patch.title.trim();
    setItems(
      items.value.map((i) =>
        isUpcoming(i) && ((title && i.title !== title) || i.type !== patch.type)
          ? { ...i, title: title || i.title, type: patch.type, updatedAt: stamp }
          : i,
      ),
    );
    return;
  }

  const template = patch.title.trim() || s.template.title;
  const next: Series = { ...s, template: { ...s.template, title: template, type: patch.type } };
  const { numberFrom } = titleFields({ template, numberFrom: patch.numberFrom ?? s.numberFrom });
  if (numberFrom === undefined) delete next.numberFrom;
  else next.numberFrom = numberFrom;

  batch(() => {
    setItems(
      items.value.map((i) => {
        if (!isUpcoming(i)) return i;
        // Occurrences renamed on their own keep their title (type still follows the series).
        const title = i.customTitle ? i.title : occurrenceTitle(next, occurrenceIndex(next, i));
        return i.title === title && i.type === patch.type ? i : { ...i, title, type: patch.type, updatedAt: stamp };
      }),
    );
    if (JSON.stringify(next) !== JSON.stringify(s)) setSeries(series.value.map((x) => (x.id === seriesId ? next : x)));
  });
}

// ── Recurring series ──────────────────────────────────────────

/** What a series copies from its first occurrence onto later ones. */
function templateOf(item: Item, title: string): Series["template"] {
  const t: Series["template"] = { title, type: item.type };
  if (item.notes) t.notes = item.notes;
  const duration = durationOf(item);
  if (duration) t.duration = duration;
  if (item.location) t.location = item.location;
  return t;
}

/**
 * Turns an item into the first occurrence of a new repeating series.
 * `title` carries the template when it numbers occurrences ({n}); the item's
 * own title should already be the rendered first one.
 * Call inside batch() together with adding/saving the returned item, so
 * occurrence generation sees both at once.
 */
export function makeRepeating(item: Item, rule: RepeatRule, end: RepeatEnd, title?: SeriesTitle): Item {
  const s: Series = {
    id: crypto.randomUUID(),
    epoch: 0,
    start: item.dateTime,
    rule,
    end,
    template: templateOf(item, title?.template ?? item.title),
    nextIndex: 1,
  };
  const { numberFrom } = titleFields({ template: s.template.title, numberFrom: title?.numberFrom });
  if (numberFrom !== undefined) s.numberFrom = numberFrom;
  if (item.allDay) s.allDay = true;
  if (item.categoryId) s.categoryId = item.categoryId;
  setSeries([...series.value, s]);
  return { ...item, seriesId: s.id };
}

/**
 * Changes a series' repeat rule, restarting it from `anchor` (an upcoming
 * occurrence that is kept and becomes occurrence 0). Other upcoming
 * occurrences are regenerated; past and completed ones stay. A null rule
 * stops the series and leaves the anchor as a one-off item.
 * `title` sets the template and numbering (numberFrom = the anchor's number).
 */
export function changeSeriesRule(
  seriesId: string,
  anchor: Item,
  rule: RepeatRule | null,
  end: RepeatEnd,
  now = new Date(),
  title?: SeriesTitle,
) {
  const s = series.value.find((x) => x.id === seriesId);
  if (!s) return;
  const t = now.getTime();
  const isUpcomingSibling = (i: Item) =>
    i.seriesId === seriesId && i.id !== anchor.id && !i.completedAt && Date.parse(i.dateTime) > t;

  batch(() => {
    const kept = items.value.filter((i) => !isUpcomingSibling(i));
    if (rule) {
      const restarted: Series = {
        ...s,
        epoch: s.epoch + 1,
        start: anchor.dateTime,
        rule,
        end,
        template: templateOf(anchor, title?.template ?? anchor.title),
        nextIndex: 1,
      };
      const { numberFrom } = titleFields({ template: restarted.template.title, numberFrom: title?.numberFrom });
      if (numberFrom === undefined) delete restarted.numberFrom;
      else restarted.numberFrom = numberFrom;
      if (anchor.allDay) restarted.allDay = true;
      else delete restarted.allDay;
      const anchorTitle = anchor.customTitle ? anchor.title : occurrenceTitle(restarted, 0);
      setItems(kept.map((i) => (i.id === anchor.id ? { ...anchor, title: anchorTitle, seriesId } : i)));
      setSeries(series.value.map((x) => (x.id === seriesId ? restarted : x)));
    } else {
      setItems(
        kept.map((i) => {
          if (i.id !== anchor.id) return i;
          const { seriesId: _, ...single } = anchor;
          return single;
        }),
      );
      setSeries(series.value.filter((x) => x.id !== seriesId));
    }
  });
}

/**
 * Moves every upcoming, uncompleted occurrence of a series to one time of day
 * (null = all-day), including occurrences whose time was changed on their own,
 * and updates the series so future occurrences follow.
 */
export function setSeriesTime(seriesId: string, time: TimeParts | null, now = new Date()) {
  const s = series.value.find((x) => x.id === seriesId);
  const t = now.getTime();
  const stamp = toLocalISO(now);
  const at = (iso: string) => {
    const d = new Date(iso);
    return toLocalISO(new Date(d.getFullYear(), d.getMonth(), d.getDate(), time?.hour ?? 0, time?.minute ?? 0));
  };
  const withTime = <T extends { allDay?: boolean }>(x: T): T => {
    const next = { ...x };
    if (time) delete next.allDay;
    else next.allDay = true;
    return next;
  };
  // Occurrences keep their length when moved. Switching between all-day and
  // timed drops the end, since its unit (days vs minutes) changes.
  const sameKind = (allDay: boolean | undefined) => Boolean(time) === !allDay;
  const moved = (i: Item): Item => {
    const next = withTime({ ...i, dateTime: at(i.dateTime), updatedAt: stamp });
    if (!i.endDateTime || !sameKind(i.allDay)) return withoutKey(next, "endDateTime");
    const length = Date.parse(i.endDateTime) - Date.parse(i.dateTime);
    return { ...next, endDateTime: toLocalISO(new Date(Date.parse(next.dateTime) + length)) };
  };
  batch(() => {
    setItems(items.value.map((i) => (i.seriesId === seriesId && !i.completedAt && Date.parse(i.dateTime) > t ? moved(i) : i)));
    if (s) {
      const next = withTime({ ...s, start: at(s.start) });
      if (!sameKind(s.allDay)) next.template = withoutKey(s.template, "duration");
      setSeries(series.value.map((x) => (x.id === seriesId ? next : x)));
    }
  });
}

const withoutKey = <T extends object, K extends keyof T>(o: T, key: K): T => {
  const next = { ...o };
  delete next[key];
  return next;
};

/**
 * Gives every upcoming, uncompleted occurrence of a timed series the same
 * end time (null = no end), and future occurrences the same length. An end
 * at or before an occurrence's start means the next day (9 PM – 2 AM).
 */
export function setSeriesEnd(seriesId: string, time: TimeParts | null, now = new Date()) {
  const s = series.value.find((x) => x.id === seriesId);
  const t = now.getTime();
  const stamp = toLocalISO(now);
  const endFor = (iso: string): string | undefined => {
    if (!time) return undefined;
    const start = new Date(iso);
    let end = new Date(start.getFullYear(), start.getMonth(), start.getDate(), time.hour, time.minute);
    if (end <= start) end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1, time.hour, time.minute);
    return toLocalISO(end);
  };
  const upcoming = (i: Item) => i.seriesId === seriesId && !i.completedAt && Date.parse(i.dateTime) > t && !i.allDay;
  batch(() => {
    setItems(
      items.value.map((i) => {
        if (!upcoming(i)) return i;
        const endDateTime = endFor(i.dateTime);
        const next = withoutKey({ ...i, updatedAt: stamp }, "endDateTime");
        return endDateTime ? { ...next, endDateTime } : next;
      }),
    );
    if (s && !s.allDay) {
      const end = endFor(s.start);
      const duration = end ? Math.round((Date.parse(end) - Date.parse(s.start)) / 60_000) : undefined;
      const template = withoutKey(s.template, "duration");
      setSeries(series.value.map((x) => (x.id === seriesId ? { ...s, template: duration ? { ...template, duration } : template } : x)));
    }
  });
}

/** Gives every upcoming, uncompleted occurrence of a series, and future ones, the same location ("" = none). */
export function setSeriesLocation(seriesId: string, location: string, now = new Date()) {
  const s = series.value.find((x) => x.id === seriesId);
  const t = now.getTime();
  const stamp = toLocalISO(now);
  const place = location.trim().slice(0, MAX_LOCATION);
  const apply = <T extends { location?: string }>(x: T): T => (place ? { ...x, location: place } : withoutKey(x, "location"));
  batch(() => {
    setItems(
      items.value.map((i) =>
        i.seriesId === seriesId && !i.completedAt && Date.parse(i.dateTime) > t && (i.location ?? "") !== place
          ? { ...apply(i), updatedAt: stamp }
          : i,
      ),
    );
    if (s) setSeries(series.value.map((x) => (x.id === seriesId ? { ...s, template: apply(s.template) } : x)));
  });
}

// ── Categories ────────────────────────────────────────────────

export function addCategory(name: string, color: CategoryColor): Category {
  const category: Category = { id: crypto.randomUUID(), name: name.trim() || "Untitled", color };
  setCategories([...categories.value, category]);
  return category;
}

export function updateCategory(id: string, patch: Partial<Omit<Category, "id">>) {
  setCategories(
    categories.value.map((c) => {
      if (c.id !== id) return c;
      const next = { ...c, ...patch };
      if (patch.name !== undefined) next.name = patch.name.trim() || c.name;
      if (next.collapsed === false) delete next.collapsed;
      return next;
    }),
  );
}

/** Moves a category to position `to` in the section order. */
export function moveCategory(id: string, to: number) {
  const from = categories.value.findIndex((c) => c.id === id);
  if (from < 0 || from === to) return;
  setCategories(moveIndex(categories.value, from, to));
}

/** Deletes a category; its items and series become uncategorized. Undo restores everything. */
export function removeCategory(id: string) {
  const index = categories.value.findIndex((c) => c.id === id);
  const category = categories.value[index];
  if (!category) return;
  const itemIds = new Set(items.value.filter((i) => i.categoryId === id).map((i) => i.id));
  const seriesIds = new Set(series.value.filter((x) => x.categoryId === id).map((x) => x.id));
  const strip = <T extends { categoryId?: string }>(x: T): T => {
    const { categoryId: _, ...rest } = x;
    return rest as T;
  };
  batch(() => {
    setCategories(categories.value.filter((c) => c.id !== id));
    setItems(items.value.map((i) => (itemIds.has(i.id) ? strip(i) : i)));
    if (seriesIds.size) setSeries(series.value.map((x) => (seriesIds.has(x.id) ? strip(x) : x)));
  });
  showToast({
    message: `Deleted ${category.name}`,
    action: {
      label: "Undo",
      run: () =>
        batch(() => {
          setCategories(moveIndex([...categories.value, category], categories.value.length, index));
          setItems(items.value.map((i) => (itemIds.has(i.id) ? { ...i, categoryId: id } : i)));
          if (seriesIds.size) setSeries(series.value.map((x) => (seriesIds.has(x.id) ? { ...x, categoryId: id } : x)));
        }),
    },
  });
}

export type CategoryTarget = { kind: "item"; id: string } | { kind: "series"; id: string };

/**
 * What moving this item to a category should move: an upcoming occurrence
 * stands for its whole series; a past one (overdue) moves alone.
 */
export function categoryTargetFor(item: Item, past = false): CategoryTarget {
  return item.seriesId && !past ? { kind: "series", id: item.seriesId } : { kind: "item", id: item.id };
}

/**
 * Puts items and whole series (every occurrence, and future ones) into a
 * category (null = none), as one change. Shows an undo toast unless `quiet`.
 */
export function assignCategory(target: CategoryTarget | readonly CategoryTarget[], categoryId: string | null, quiet = false) {
  const targets = Array.isArray(target) ? target : [target as CategoryTarget];
  const itemIds = new Set(targets.filter((t) => t.kind === "item").map((t) => t.id));
  const seriesIds = new Set(targets.filter((t) => t.kind === "series").map((t) => t.id));
  const matches = (i: Item) => itemIds.has(i.id) || (i.seriesId !== undefined && seriesIds.has(i.seriesId));
  const before = new Map(items.value.filter(matches).map((i) => [i.id, i.categoryId]));
  const owners = new Map(series.value.filter((x) => seriesIds.has(x.id)).map((x) => [x.id, x.categoryId]));
  if (before.size === 0 && owners.size === 0) return;
  const set = <T extends { categoryId?: string }>(x: T, id: string | null | undefined): T => {
    const next = { ...x };
    if (id) next.categoryId = id;
    else delete next.categoryId;
    return next;
  };

  batch(() => {
    setItems(items.value.map((i) => (matches(i) ? set(i, categoryId) : i)));
    if (owners.size) setSeries(series.value.map((x) => (owners.has(x.id) ? set(x, categoryId) : x)));
  });
  if (quiet) return;
  const name = categories.value.find((c) => c.id === categoryId)?.name;
  // A stack counts once, however many occurrences it has.
  const count = targets.length > 1 ? `${targets.length} items ` : "";
  showToast({
    message: name ? `Moved ${count}to ${name}` : count ? `Moved ${count}to Other` : "Removed from category",
    action: {
      label: "Undo",
      run: () =>
        batch(() => {
          setItems(items.value.map((i) => (before.has(i.id) ? set(i, before.get(i.id)) : i)));
          if (owners.size) setSeries(series.value.map((x) => (owners.has(x.id) ? set(x, owners.get(x.id)) : x)));
        }),
    },
  });
}

/** Stops a series: removes its upcoming occurrences and the rule, with undo. */
export function removeSeries(seriesId: string, now = new Date()) {
  removeMany([], [seriesId], now);
}

/**
 * Removes items and whole series (their upcoming occurrences and rules) as
 * one change, with a single Undo that restores all of it.
 */
export function removeMany(itemIds: Iterable<string>, seriesIds: Iterable<string>, now = new Date()) {
  const t = now.getTime();
  const picked = new Set(itemIds);
  const sIds = new Set(seriesIds);
  const ids = new Set(picked);
  for (const i of items.value) {
    if (i.seriesId && sIds.has(i.seriesId) && !i.completedAt && Date.parse(i.dateTime) > t) ids.add(i.id);
  }
  const removedSeries = series.value.filter((s) => sIds.has(s.id));
  const { next, removed } = ops.removeIds(items.value, ids);
  if (removed.length === 0 && removedSeries.length === 0) return;

  batch(() => {
    setItems(next);
    if (removedSeries.length) setSeries(series.value.filter((s) => !sIds.has(s.id)));
  });

  // Count what the user picked: each item and each series once.
  const pickedRemoved = removed.filter((r) => picked.has(r.item.id)).length;
  const count = pickedRemoved + removedSeries.length;
  const message =
    pickedRemoved === 0 && removedSeries.length === 1
      ? "Repeating item removed"
      : count === 1
        ? "Item removed"
        : `${count} items removed`;

  showToast({
    message,
    action: {
      label: "Undo",
      run: () =>
        batch(() => {
          setItems(ops.restore(items.value, removed));
          const missing = removedSeries.filter((s) => !series.value.some((x) => x.id === s.id));
          if (missing.length) setSeries([...series.value, ...missing]);
        }),
    },
  });
}

/**
 * Adds imported items and series as one change. Undo removes them again,
 * including occurrences generated for the imported series since.
 */
export function addImported(newItems: Item[], newSeries: Series[], count: number) {
  if (newItems.length === 0 && newSeries.length === 0) return;
  const ids = new Set(newItems.map((i) => i.id));
  const sids = new Set(newSeries.map((s) => s.id));
  batch(() => {
    setItems([...items.value, ...newItems]);
    if (newSeries.length) setSeries([...series.value, ...newSeries]);
  });
  showToast({
    message: count === 1 ? "Added 1 item" : `Added ${count} items`,
    action: {
      label: "Undo",
      run: () =>
        batch(() => {
          setItems(items.value.filter((i) => !ids.has(i.id) && !(i.seriesId && sids.has(i.seriesId) && !i.completedAt)));
          if (sids.size) setSeries(series.value.filter((s) => !sids.has(s.id)));
        }),
    },
  });
}

/**
 * Generates upcoming occurrences for every series that is running low.
 * Safe to call often: it only writes when something was added.
 */
export function ensureOccurrences(now: number) {
  if (!ready.value || series.value.length === 0) return;
  // The panel that made a change tops up for it; reacting to another panel's
  // change here could write back a list that hasn't caught up yet.
  if (applyingRemote) return;
  const added: Item[] = [];
  let changed = false;
  const nextSeries = series.value.map((s) => {
    const result = topUp(s, [...items.value, ...added], now, skipOccurrences.value);
    added.push(...result.added);
    if (result.series !== s) changed = true;
    return result.series;
  });
  if (added.length === 0 && !changed) return;
  batch(() => {
    if (added.length) setItems([...items.value, ...added]);
    if (changed) setSeries(nextSeries);
  });
}

export function removeItems(ids: Iterable<string>) {
  const { next, removed } = ops.removeIds(items.value, new Set(ids));
  if (removed.length === 0) return;
  setItems(next);
  showToast({
    message: removed.length === 1 ? "Item removed" : `${removed.length} items removed`,
    action: { label: "Undo", run: () => setItems(ops.restore(items.value, removed)) },
  });
}

/** Removes every completed item from the list. Completion records (stats) are kept. */
export function clearCompleted() {
  const ids = items.value.filter((i) => i.completedAt).map((i) => i.id);
  const { next, removed } = ops.removeIds(items.value, new Set(ids));
  if (removed.length === 0) return;
  setItems(next);
  showToast({
    message: `Cleared ${removed.length} completed`,
    action: { label: "Undo", run: () => setItems(ops.restore(items.value, removed)) },
  });
}

/** Moves a completed item back to the list and drops its completion record. */
export function uncompleteItem(id: string) {
  const record = completions.value.findLast((c) => c.itemId === id);
  const completedAt = items.value.find((i) => i.id === id)?.completedAt;
  if (!completedAt) return;
  batch(() => {
    setItems(ops.uncomplete(items.value, id));
    if (record) setCompletions(completions.value.filter((c) => c.id !== record.id));
  });
  showToast({
    message: "Marked as not done",
    action: {
      label: "Undo",
      run: () =>
        batch(() => {
          setItems(items.value.map((i) => (i.id === id ? { ...i, completedAt } : i)));
          if (record) setCompletions([...completions.value, record]);
        }),
    },
  });
}

export function completeItem(id: string, now = new Date()) {
  const result = ops.complete(items.value, id, now);
  if (!result) return;
  batch(() => {
    setItems(result.next);
    setCompletions([...completions.value, result.record]);
  });
  showToast({
    message: "Completed",
    action: {
      label: "Undo",
      run: () =>
        batch(() => {
          setItems(ops.uncomplete(items.value, id));
          setCompletions(completions.value.filter((c) => c.id !== result.record.id));
        }),
    },
  });
}
