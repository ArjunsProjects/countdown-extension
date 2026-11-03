import { CATEGORY_COLORS, type Category, type CategoryColor } from "../categories";
import { toLocalISO } from "../dates";
import { endOf } from "../events";
import { PALETTE_IDS, type PaletteId } from "../palettes";
import { occurrenceAt, occurrenceEnd, occurrenceTitle, type Series } from "../recurrence";
import { DEFAULT_PREFS, type Prefs, type Theme } from "../storage";
import type { Item, Unit } from "../types";

// The compact form each thing takes in chrome.storage.sync, one key per
// item, series or category. Chrome caps sync storage at about 100 KB and
// 512 keys, so field names are short, times are numbers, and anything at
// its default is left out. All-day dates travel as plain dates, so they
// land on the same day on a computer in another time zone.
//
// Fields this version doesn't know (written by a newer one) ride along in
// `x`, so an older computer never erases them when it saves.

export type Content = Record<string, unknown>;

const sec = (iso: string) => Math.round(Date.parse(iso) / 1000);
const fromSec = (s: number) => toLocalISO(new Date(s * 1000));
const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const fromYmd = (s: string) => {
  const [y, m, d] = s.split("-").map(Number) as [number, number, number];
  return toLocalISO(new Date(y, m - 1, d));
};
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** A time as it travels: epoch seconds, or a plain date for all-day. */
const packTime = (iso: string, allDay: boolean) => (allDay ? ymd(iso) : sec(iso));
const unpackTime = (v: unknown): string | null => (isNum(v) ? fromSec(v) : isStr(v) && YMD.test(v) ? fromYmd(v) : null);

/** Copies fields this version doesn't model, so they survive a round trip. */
function extras(o: object, known: ReadonlySet<string>): Content | undefined {
  const x: Content = {};
  for (const [k, v] of Object.entries(o)) if (!known.has(k) && v !== undefined) x[k] = v;
  return Object.keys(x).length ? x : undefined;
}

// ── Items ─────────────────────────────────────────────────────

const ITEM_FIELDS = new Set([
  "id", "title", "type", "dateTime", "allDay", "endDateTime", "location", "notes", "createdAt", "updatedAt",
  "source", "uid", "seriesId", "customTitle", "categoryId", "completedAt",
]);

/** An item's content, without its completion (that merges on its own). */
export function encodeItem(item: Item): Content {
  const allDay = Boolean(item.allDay);
  const c: Content = { n: item.title, s: packTime(item.dateTime, allDay) };
  if (item.type === "starts") c.y = 1;
  if (allDay) c.a = 1;
  if (item.endDateTime && endOf(item) !== null) c.e = packTime(item.endDateTime, allDay);
  if (item.location) c.l = item.location;
  if (item.notes) c.o = item.notes;
  if (item.source === "import") c.i = 1;
  if (item.uid) c.u = item.uid;
  if (item.seriesId) c.r = item.seriesId;
  if (item.customTitle) c.k = 1;
  if (item.categoryId) c.g = item.categoryId;
  if (item.createdAt && !Number.isNaN(Date.parse(item.createdAt))) c.cr = sec(item.createdAt);
  const x = extras(item, ITEM_FIELDS);
  if (x) c.x = x;
  return c;
}

/** Back to an item; null if the content is unreadable. `updatedAt` is when the change was made. */
export function decodeItem(id: string, c: Content, updatedAt: number, completedAt: string | null): Item | null {
  const dateTime = unpackTime(c.s);
  if (!isStr(c.n) || !dateTime) return null;
  const stamp = toLocalISO(new Date(updatedAt));
  const item: Item = {
    ...(typeof c.x === "object" && c.x !== null ? (c.x as Content) : {}),
    id,
    title: c.n,
    type: c.y === 1 ? "starts" : "due",
    dateTime,
    createdAt: isNum(c.cr) ? fromSec(c.cr) : stamp,
    updatedAt: stamp,
    source: c.i === 1 ? "import" : "manual",
  };
  if (c.a === 1) item.allDay = true;
  const end = unpackTime(c.e);
  if (end && item.type === "starts") item.endDateTime = end;
  if (isStr(c.l)) item.location = c.l;
  if (isStr(c.o)) item.notes = c.o;
  if (isStr(c.u)) item.uid = c.u;
  if (isStr(c.r)) item.seriesId = c.r;
  if (c.k === 1) item.customTitle = true;
  if (isStr(c.g)) item.categoryId = c.g;
  if (completedAt) item.completedAt = completedAt;
  return item;
}

// ── Series ────────────────────────────────────────────────────

const SERIES_FIELDS = new Set(["id", "epoch", "start", "allDay", "rule", "end", "template", "nextIndex", "uid", "categoryId", "numberFrom", "timeZone"]);
const TEMPLATE_FIELDS = new Set(["title", "type", "notes", "duration", "location"]);

/** A series' rule and template. Its next-index counter stays on each computer. */
export function encodeSeries(s: Series): Content {
  const allDay = Boolean(s.allDay);
  const c: Content = { s: packTime(s.start, allDay), r: s.rule, e: s.end, n: s.template.title, ep: s.epoch };
  if (allDay) c.a = 1;
  if (s.template.type === "starts") c.y = 1;
  if (s.template.notes) c.o = s.template.notes;
  if (s.template.duration) c.du = s.template.duration;
  if (s.template.location) c.l = s.template.location;
  if (s.uid) c.u = s.uid;
  if (s.categoryId) c.g = s.categoryId;
  if (s.numberFrom !== undefined) c.nf = s.numberFrom;
  if (s.timeZone) c.z = s.timeZone;
  const x = extras(s, SERIES_FIELDS);
  if (x) c.x = x;
  const tx = extras(s.template, TEMPLATE_FIELDS);
  if (tx) c.tx = tx;
  return c;
}

export function decodeSeries(id: string, c: Content, nextIndex: number): Series | null {
  const start = unpackTime(c.s);
  if (!start || !isStr(c.n) || typeof c.r !== "object" || c.r === null || typeof c.e !== "object" || c.e === null) return null;
  const s: Series = {
    ...(typeof c.x === "object" && c.x !== null ? (c.x as Content) : {}),
    id,
    epoch: isNum(c.ep) ? c.ep : 0,
    start,
    rule: c.r as Series["rule"],
    end: c.e as Series["end"],
    template: {
      ...(typeof c.tx === "object" && c.tx !== null ? (c.tx as Content) : {}),
      title: c.n,
      type: c.y === 1 ? "starts" : "due",
    },
    nextIndex,
  };
  if (c.a === 1) s.allDay = true;
  if (isStr(c.o)) s.template.notes = c.o;
  if (isNum(c.du) && c.du > 0) s.template.duration = c.du;
  if (isStr(c.l)) s.template.location = c.l;
  if (isStr(c.u)) s.uid = c.u;
  if (isStr(c.g)) s.categoryId = c.g;
  if (isNum(c.nf)) s.numberFrom = c.nf;
  if (isStr(c.z)) s.timeZone = c.z;
  return s;
}

// ── Categories and settings ───────────────────────────────────

const COLORS = new Set<string>(CATEGORY_COLORS);

/** A category with its place in the order. Collapsing stays on each computer. */
export function encodeCategory(c: Category, order: number): Content {
  return { n: c.name, c: c.color, o: order };
}

export function decodeCategory(id: string, c: Content, collapsed: boolean | undefined): { category: Category; order: number } | null {
  if (!isStr(c.n) || !isStr(c.c) || !COLORS.has(c.c)) return null;
  const category: Category = { id, name: c.n, color: c.c as CategoryColor };
  if (collapsed) category.collapsed = true;
  return { category, order: isNum(c.o) ? c.o : 0 };
}

/** The settings that follow you between computers (collapsed sections don't). */
export function encodePrefs(p: Prefs): Content {
  return { u: p.unit, th: p.theme, p: p.palette, li: p.liveIcon ? 1 : 0 };
}

const UNITS = new Set<string>(["days", "hours", "minutes", "seconds"]);
const THEMES = new Set<string>(["system", "light", "dark"]);

export function decodePrefs(c: Content, local: Prefs): Prefs {
  return {
    ...local,
    unit: isStr(c.u) && UNITS.has(c.u) ? (c.u as Unit) : DEFAULT_PREFS.unit,
    theme: isStr(c.th) && THEMES.has(c.th) ? (c.th as Theme) : DEFAULT_PREFS.theme,
    palette: isStr(c.p) && PALETTE_IDS.has(c.p) ? (c.p as PaletteId) : DEFAULT_PREFS.palette,
    liveIcon: c.li !== 0,
  };
}

// ── Occurrences a series makes by itself ──────────────────────

/** "seriesId~epoch~index" → its parts, for occurrences a series generated. */
export function parseOccurrenceId(id: string): { seriesId: string; epoch: number; index: number } | null {
  const m = /^(.+)~(\d+)~(\d+)$/.exec(id);
  return m ? { seriesId: m[1]!, epoch: Number(m[2]), index: Number(m[3]) } : null;
}

/**
 * The occurrence a series would generate at `index`, as stored. Every
 * computer derives these the same way (the ids are deterministic), so they
 * aren't synced; only occurrences you changed are.
 */
export function derivedOccurrence(s: Series, index: number, stamp: string): Item | null {
  const date = occurrenceAt(s, index);
  if (!date) return null;
  const item: Item = {
    id: `${s.id}~${s.epoch}~${index}`,
    title: occurrenceTitle(s, index),
    type: s.template.type,
    dateTime: toLocalISO(date),
    createdAt: stamp,
    updatedAt: stamp,
    source: "manual",
    seriesId: s.id,
  };
  if (s.allDay) item.allDay = true;
  if (s.categoryId) item.categoryId = s.categoryId;
  if (s.template.notes) item.notes = s.template.notes;
  if (s.template.location) item.location = s.template.location;
  const end = occurrenceEnd(s, date);
  if (s.template.duration && end) item.endDateTime = toLocalISO(end);
  return item;
}

/**
 * Whether an item is exactly what its series generates (so it needn't be
 * synced). Occurrence 0 never is: it's the item the series was made from
 * (or the first one imported), which generation never creates.
 */
export function isDerived(item: Item, seriesById: ReadonlyMap<string, Series>): boolean {
  if (!item.seriesId || item.completedAt || item.customTitle) return false;
  const s = seriesById.get(item.seriesId);
  const parts = parseOccurrenceId(item.id);
  if (!s || !parts || parts.index === 0 || parts.seriesId !== s.id || parts.epoch !== s.epoch) return false;
  const d = derivedOccurrence(s, parts.index, item.createdAt);
  if (!d) return false;
  const instant = (iso?: string) => (iso ? Date.parse(iso) : null);
  return (
    d.title === item.title &&
    d.type === item.type &&
    instant(d.dateTime) === instant(item.dateTime) &&
    Boolean(d.allDay) === Boolean(item.allDay) &&
    instant(d.endDateTime) === instant(item.endDateTime) &&
    (d.location ?? "") === (item.location ?? "") &&
    (d.notes ?? "") === (item.notes ?? "") &&
    (d.categoryId ?? "") === (item.categoryId ?? "")
  );
}

// ── Hashing (to notice what changed) ──────────────────────────

/** A short, stable fingerprint of some content. Two 32-bit FNV-1a passes. */
export function hash(content: unknown): string {
  const s = JSON.stringify(content);
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x5bd1e995);
  }
  return (a >>> 0).toString(36) + (b >>> 0).toString(36);
}
