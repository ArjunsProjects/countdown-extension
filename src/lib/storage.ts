import { MAX_CUSTOM_DATES, type RepeatEnd, type RepeatRule, type Series } from "./recurrence";
import { CATEGORY_COLORS, MAX_CATEGORY_NAME, type Category } from "./categories";
import { DEFAULT_PALETTE, PALETTE_IDS, type PaletteId } from "./palettes";
import { isValidTimeZone } from "./timezone";
import type { CompletionRecord, Item, Unit } from "./types";

export const SCHEMA_VERSION = 1;

export type Theme = "system" | "light" | "dark";

export interface Prefs {
  unit: Unit;
  theme: Theme;
  /** Colour theme. */
  palette: PaletteId;
  /** The toolbar icon's sweep shows the time left until the next item. */
  liveIcon: boolean;
  overdueCollapsed: boolean;
  completedCollapsed: boolean;
}

export const DEFAULT_PREFS: Prefs = {
  unit: "days",
  theme: "system",
  palette: DEFAULT_PALETTE,
  liveIcon: true,
  overdueCollapsed: false,
  completedCollapsed: true,
};

export interface StoredState {
  items: Item[];
  completions: CompletionRecord[];
  series: Series[];
  categories: Category[];
  prefs: Prefs;
}

type StorageKey = keyof StoredState | "schemaVersion";


/** The slice of chrome.storage.local the app uses, so tests and plain-browser previews can swap it. */
export interface StorageBackend {
  get(): Promise<Record<string, unknown>>;
  set(values: Partial<Record<StorageKey, unknown>>): Promise<void>;
  /** Calls back with changed keys (from this or another panel). Returns an unsubscribe function. */
  subscribe(onChange: (changes: Record<string, unknown>) => void): () => void;
}

export const chromeBackend: StorageBackend = {
  get: () => chrome.storage.local.get(null),
  set: (values) => chrome.storage.local.set(values),
  subscribe(onChange) {
    const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== "local") return;
      onChange(Object.fromEntries(Object.entries(changes).map(([k, c]) => [k, c.newValue])));
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  },
};

/** Fallback for opening the panel page outside the extension (local preview). */
export function localStorageBackend(prefix = "countdown:"): StorageBackend {
  return {
    async get() {
      const out: Record<string, unknown> = {};
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)!;
        if (!key.startsWith(prefix)) continue;
        try {
          out[key.slice(prefix.length)] = JSON.parse(localStorage.getItem(key)!);
        } catch {
          // Unreadable entry: skip it; validation falls back to defaults.
        }
      }
      return out;
    },
    async set(values) {
      for (const [k, v] of Object.entries(values)) localStorage.setItem(prefix + k, JSON.stringify(v));
    },
    subscribe(onChange) {
      const listener = (e: StorageEvent) => {
        if (e.key?.startsWith(prefix)) onChange({ [e.key.slice(prefix.length)]: e.newValue && JSON.parse(e.newValue) });
      };
      addEventListener("storage", listener);
      return () => removeEventListener("storage", listener);
    },
  };
}

export function defaultBackend(): StorageBackend {
  return typeof chrome !== "undefined" && chrome.storage?.local ? chromeBackend : localStorageBackend();
}

// ── Validation ──────────────────────────────────────────────────
// Stored data is treated as untrusted: a bad record is dropped rather
// than crashing the panel.

const isString = (v: unknown): v is string => typeof v === "string";
const isOptionalString = (v: unknown) => v === undefined || isString(v);
const isDateString = (v: unknown) => isString(v) && !Number.isNaN(Date.parse(v));

export function isItem(v: unknown): v is Item {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    isString(o.id) &&
    isString(o.title) &&
    (o.type === "due" || o.type === "starts") &&
    isDateString(o.dateTime) &&
    (o.source === "manual" || o.source === "import") &&
    isString(o.createdAt) &&
    isString(o.updatedAt) &&
    (o.allDay === undefined || typeof o.allDay === "boolean") &&
    (o.endDateTime === undefined || isDateString(o.endDateTime)) &&
    isOptionalString(o.location) &&
    isOptionalString(o.notes) &&
    isOptionalString(o.uid) &&
    isOptionalString(o.categoryId) &&
    (o.numberFrom === undefined || Number.isInteger(o.numberFrom)) &&
    isOptionalString(o.seriesId) &&
    (o.customTitle === undefined || typeof o.customTitle === "boolean") &&
    isOptionalString(o.categoryId) &&
    (o.completedAt === undefined || isDateString(o.completedAt))
  );
}

function isCompletion(v: unknown): v is CompletionRecord {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    isString(o.id) &&
    isString(o.itemId) &&
    isString(o.title) &&
    (o.type === "due" || o.type === "starts") &&
    isDateString(o.dateTime) &&
    isDateString(o.completedAt)
  );
}

const UNITS_SET = new Set<unknown>(["days", "hours", "minutes", "seconds"]);
const THEMES = new Set<unknown>(["system", "light", "dark"]);
const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);

export function parsePrefs(v: unknown): Prefs {
  const o = (typeof v === "object" && v !== null ? v : {}) as Record<string, unknown>;
  return {
    unit: UNITS_SET.has(o.unit) ? (o.unit as Unit) : DEFAULT_PREFS.unit,
    theme: THEMES.has(o.theme) ? (o.theme as Theme) : DEFAULT_PREFS.theme,
    palette: PALETTE_IDS.has(o.palette as string) ? (o.palette as PaletteId) : DEFAULT_PREFS.palette,
    liveIcon: bool(o.liveIcon, DEFAULT_PREFS.liveIcon),
    // Before the Overdue/Completed split, the single bottom section was "pastCollapsed".
    overdueCollapsed: bool(o.overdueCollapsed, bool(o.pastCollapsed, DEFAULT_PREFS.overdueCollapsed)),
    completedCollapsed: bool(o.completedCollapsed, DEFAULT_PREFS.completedCollapsed),
  };
}

const FREQS = new Set<unknown>(["DAILY", "WEEKLY", "MONTHLY", "YEARLY", "DATES"]);
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const isPositiveInt = (v: unknown) => Number.isInteger(v) && (v as number) > 0;

function isRule(v: unknown): v is RepeatRule {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    FREQS.has(o.freq) &&
    isPositiveInt(o.interval) &&
    (o.weekdays === undefined ||
      (Array.isArray(o.weekdays) && o.weekdays.every((d) => Number.isInteger(d) && d >= 0 && d <= 6))) &&
    // DATES needs its list; other rules must not carry one.
    (o.freq === "DATES"
      ? Array.isArray(o.dates) && o.dates.length > 0 && o.dates.length <= MAX_CUSTOM_DATES && o.dates.every((d) => isString(d) && YMD.test(d))
      : o.dates === undefined)
  );
}

function isEnd(v: unknown): v is RepeatEnd {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  if (o.type === "never") return true;
  if (o.type === "count") return isPositiveInt(o.count);
  return o.type === "until" && isString(o.date) && /^\d{4}-\d{2}-\d{2}$/.test(o.date);
}

export function isSeries(v: unknown): v is Series {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  const t = o.template as Record<string, unknown> | null;
  return (
    isString(o.id) &&
    Number.isInteger(o.epoch) &&
    isDateString(o.start) &&
    (o.allDay === undefined || typeof o.allDay === "boolean") &&
    isRule(o.rule) &&
    isEnd(o.end) &&
    typeof t === "object" &&
    t !== null &&
    isString(t.title) &&
    (t.type === "due" || t.type === "starts") &&
    isOptionalString(t.notes) &&
    (t.duration === undefined || isPositiveInt(t.duration)) &&
    isOptionalString(t.location) &&
    Number.isInteger(o.nextIndex) &&
    (o.nextIndex as number) >= 0 &&
    isOptionalString(o.uid) &&
    (o.timeZone === undefined || (isString(o.timeZone) && isValidTimeZone(o.timeZone)))
  );
}

const COLORS = new Set<unknown>(CATEGORY_COLORS);

export function isCategory(v: unknown): v is Category {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    isString(o.id) &&
    isString(o.name) &&
    o.name.length <= MAX_CATEGORY_NAME &&
    COLORS.has(o.color) &&
    (o.collapsed === undefined || typeof o.collapsed === "boolean")
  );
}

export const parseCategories = (v: unknown): Category[] => (Array.isArray(v) ? v.filter(isCategory) : []);
export const parseItems = (v: unknown): Item[] => (Array.isArray(v) ? v.filter(isItem) : []);
export const parseSeries = (v: unknown): Series[] => (Array.isArray(v) ? v.filter(isSeries) : []);
export const parseCompletions = (v: unknown): CompletionRecord[] => (Array.isArray(v) ? v.filter(isCompletion) : []);

export async function loadState(backend: StorageBackend): Promise<StoredState> {
  const raw = await backend.get();
  const state: StoredState = {
    items: parseItems(raw.items),
    completions: parseCompletions(raw.completions),
    series: parseSeries(raw.series),
    categories: parseCategories(raw.categories),
    prefs: parsePrefs(raw.prefs),
  };
  // Future schema changes migrate here, keyed on raw.schemaVersion.
  if (raw.schemaVersion !== SCHEMA_VERSION) await backend.set({ schemaVersion: SCHEMA_VERSION });
  return state;
}
