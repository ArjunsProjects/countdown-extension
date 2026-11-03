import type { Category } from "../categories";
import { finishOf } from "../events";
import { occurrenceAt, topUp, type Series } from "../recurrence";
import type { Prefs } from "../storage";
import type { Item } from "../types";
import {
  decodeCategory,
  decodeItem,
  decodePrefs,
  decodeSeries,
  derivedOccurrence,
  encodeCategory,
  encodeItem,
  encodePrefs,
  encodeSeries,
  hash,
  isDerived,
  parseOccurrenceId,
  type Content,
} from "./records";

// How this computer's list and the shared copy in Chrome sync come together.
//
// This computer's own storage stays the full, authoritative copy; Chrome
// sync holds a replica, one key per item, series or category. Each key has
// three parts that merge on their own, each with its own timestamp:
//
//   content     the latest edit wins
//   completion  done / not done; later wins, but an edit never undoes it
//   deletion    deleted / restored; later wins, and an edit never undoes it
//
// A key missing from sync is never read as "deleted elsewhere": Chrome
// itself drops keys (when a computer first connects to an account that
// already has data, it deletes what only that computer had), so missing
// keys are uploaded again. Only a deletion marker deletes, and markers are
// kept for 60 days (longer for future occurrences of a series).
//
// Everything here is pure: it takes state and returns new state, so the
// rules are tested directly, including with several simulated computers.

export const FORMAT_VERSION = 1;
const DAY_MS = 86_400_000;
/** Completed items sync for a year; older ones stay on the computer they're on. */
export const RETAIN_COMPLETED_MS = 365 * DAY_MS;
/** How long a deletion marker is kept, so computers that were offline still see it. */
export const TOMBSTONE_MS = 60 * DAY_MS;

/** A content register holding "regenerate from the series" (an occurrence's changes were undone). */
const DERIVED = "g";

export interface LocalState {
  items: Item[];
  series: Series[];
  categories: Category[];
  prefs: Prefs;
}

/** One key as stored in chrome.storage.sync. */
export interface Rec {
  /** Content and its timestamp. */
  t?: number;
  v?: Content | typeof DERIVED;
  /** Completion: when the item was completed, or 0 for "not done". */
  ct?: number;
  c?: string | 0;
  /** Deletion: 1 deleted, 0 restored. */
  dt?: number;
  d?: 0 | 1;
}

/** What this computer last published or adopted for a key. */
export interface Reg {
  h?: string;
  t: number;
  c?: string | null;
  ct?: number;
  d?: boolean;
  dt?: number;
}

export interface Meta {
  v: typeof FORMAT_VERSION;
  /** Hybrid logical clock: never behind any timestamp seen, so a fast or slow clock can't always win. */
  clock: number;
  /** Has this computer merged with the account at least once? */
  joined: boolean;
  regs: Record<string, Reg>;
  /** Occurrences present as generated (not synced) at the last publish, to notice when one is removed. */
  derived: string[];
}

export const newMeta = (): Meta => ({ v: FORMAT_VERSION, clock: 0, joined: false, regs: {}, derived: [] });

const clone = <T,>(v: T): T => structuredClone(v);

const tick = (m: Meta, now: number) => (m.clock = Math.max(now, m.clock + 1));
const observe = (m: Meta, t: number | undefined) => {
  if (t !== undefined && t > m.clock) m.clock = t;
};

/** Later wins; on a tie the larger hash, so every computer picks the same one. */
const wins = (t1: number, h1: string, t2: number, h2: string) => t1 > t2 || (t1 === t2 && h1 > h2);

export const itemKey = (id: string) => `i:${id}`;
export const seriesKey = (id: string) => `s:${id}`;
export const categoryKey = (id: string) => `c:${id}`;
export const PREFS_KEY = "p";
export const VERSION_KEY = "v";

// ── This computer's state, as records ─────────────────────────

export interface Snapshot {
  entries: Map<string, { content: Content; completion?: string | null }>;
  /** Occurrences exactly as their series generates them (not synced). */
  derived: Set<string>;
  /** Keys held back by the retention rule (completed more than a year ago). */
  retired: Set<string>;
}

export function snapshot(state: LocalState, now: number): Snapshot {
  const seriesById = new Map(state.series.map((s) => [s.id, s]));
  const entries: Snapshot["entries"] = new Map();
  const derived = new Set<string>();
  const retired = new Set<string>();
  for (const item of state.items) {
    if (isDerived(item, seriesById)) {
      derived.add(item.id);
      continue;
    }
    if (item.completedAt && now - Date.parse(item.completedAt) > RETAIN_COMPLETED_MS) {
      retired.add(itemKey(item.id));
      continue;
    }
    entries.set(itemKey(item.id), { content: encodeItem(item), completion: item.completedAt ?? null });
  }
  for (const s of state.series) entries.set(seriesKey(s.id), { content: encodeSeries(s) });
  state.categories.forEach((c, i) => entries.set(categoryKey(c.id), { content: encodeCategory(c, i) }));
  entries.set(PREFS_KEY, { content: encodePrefs(state.prefs) });
  return { entries, derived, retired };
}

/** The record for a key, from its registers (content only when there's some to send). */
export function recordOf(r: Reg, content?: Content): Rec {
  const rec: Rec = {};
  if (!r.d) {
    if (content !== undefined) {
      rec.t = r.t;
      rec.v = content;
    } else if (r.h === DERIVED) {
      rec.t = r.t;
      rec.v = DERIVED;
    }
  }
  if (r.ct !== undefined) {
    rec.ct = r.ct;
    rec.c = r.c ?? 0;
  }
  if (r.dt !== undefined) {
    rec.dt = r.dt;
    rec.d = r.d ? 1 : 0;
  }
  return rec;
}

export interface Publish {
  meta: Meta;
  writes: Record<string, Rec>;
  removes: string[];
}

/**
 * What to upload after this computer changed: new and edited things,
 * completions, deletions (including generated occurrences you removed),
 * and occurrences whose own changes were undone.
 */
export function publish(meta: Meta, snap: Snapshot, now: number): Publish {
  const m = clone(meta);
  const writes: Record<string, Rec> = {};
  const removes: string[] = [];

  for (const [key, e] of snap.entries) {
    const h = hash(e.content);
    let r = m.regs[key];
    let dirty = false;
    if (!r) {
      r = m.regs[key] = { h, t: tick(m, now) };
      dirty = true;
    } else {
      if (r.d) {
        // Back again (Undo): a restore, newer than the deletion.
        r.d = false;
        r.dt = tick(m, now);
        dirty = true;
      }
      if (r.h !== h) {
        r.h = h;
        r.t = tick(m, now);
        dirty = true;
      }
    }
    if (e.completion !== undefined && (r.c ?? null) !== e.completion && !(r.ct === undefined && e.completion === null)) {
      r.c = e.completion;
      r.ct = tick(m, now);
      dirty = true;
    }
    if (dirty) writes[key] = recordOf(r, e.content);
  }

  const deleted = (key: string) => {
    const r = (m.regs[key] ??= { t: 0 });
    if (r.d) return;
    r.d = true;
    r.dt = tick(m, now);
    writes[key] = recordOf(r);
  };

  // Generated occurrences that were removed here.
  for (const id of m.derived) {
    const key = itemKey(id);
    if (!snap.derived.has(id) && !snap.entries.has(key)) deleted(key);
  }

  // Things that were synced and aren't in the snapshot any more.
  for (const [key, r] of Object.entries(m.regs)) {
    if (r.d || snap.entries.has(key)) continue;
    if (snap.retired.has(key)) {
      delete m.regs[key];
      removes.push(key);
      continue;
    }
    if (key.startsWith("i:") && snap.derived.has(key.slice(2))) {
      // Its own changes were undone: it's back to what the series generates.
      if (r.h !== DERIVED || (r.c ?? null) !== null) {
        r.h = DERIVED;
        r.t = tick(m, now);
        if (r.ct !== undefined && r.c) {
          r.c = null;
          r.ct = tick(m, now);
        }
        writes[key] = recordOf(r);
      }
      continue;
    }
    if (key === PREFS_KEY) continue;
    deleted(key);
  }

  m.derived = [...snap.derived];
  return { meta: m, writes, removes };
}

// ── The account's copy, into this computer's state ────────────

export interface Merge {
  meta: Meta;
  state: LocalState;
  /** Keys to upload again: this computer's version is newer, or Chrome lost it. */
  republish: Set<string>;
  /** Keys where something was taken from the account (another computer's work). */
  adopted: Set<string>;
  /** Did anything here change? */
  changed: boolean;
}

/**
 * Applies records from the account. `remote` holds every key to consider:
 * a record, or undefined for a key that's missing from the account (which
 * is uploaded again rather than treated as deleted).
 */
export function merge(meta: Meta, state: LocalState, remote: ReadonlyMap<string, Rec | undefined>, now: number): Merge {
  const m = clone(meta);
  const republish = new Set<string>();
  const adopted = new Set<string>();
  const itemsById = new Map(state.items.map((i) => [i.id, i]));
  const seriesById = new Map(state.series.map((s) => [s.id, s]));
  const catsById = new Map(state.categories.map((c, i) => [c.id, { category: c, order: i }]));
  let prefs = state.prefs;
  const changedSeries = new Set<string>();
  const removedSeries = new Set<string>();
  let changed = false;
  let catsChanged = false;
  const retiredItem = (id: string) => {
    const item = itemsById.get(id);
    return Boolean(item?.completedAt && now - Date.parse(item.completedAt) > RETAIN_COMPLETED_MS);
  };

  for (const [key, rec] of remote) {
    if (key === VERSION_KEY) continue;
    const kind = key === PREFS_KEY ? "p" : key[0];
    const id = key === PREFS_KEY ? "" : key.slice(2);
    let r = m.regs[key];

    if (rec === undefined || typeof rec !== "object" || rec === null) {
      // Missing from the account. Upload ours again, unless it's ours to let go.
      if (r && !r.d && !(kind === "i" && retiredItem(id))) republish.add(key);
      continue;
    }
    observe(m, rec.t);
    observe(m, rec.ct);
    observe(m, rec.dt);

    let content = false;
    let completion = false;
    let deletion = false;
    /** This computer holds a register the account doesn't have, or a newer one. */
    let oursNewer = false;
    const hasContent = rec.v !== undefined && typeof rec.t === "number";

    if (hasContent) {
      const h = rec.v === DERIVED ? DERIVED : hash(rec.v);
      if (!r || wins(rec.t!, h, r.t, r.h ?? "")) {
        r = m.regs[key] ??= { t: 0 };
        r.t = rec.t!;
        r.h = h;
        content = true;
      } else if (r.t !== rec.t || r.h !== h) oursNewer = true;
    }

    if (typeof rec.ct === "number") {
      if (!r || r.ct === undefined || rec.ct > r.ct) {
        r = m.regs[key] ??= { t: 0 };
        r.ct = rec.ct;
        r.c = typeof rec.c === "string" ? rec.c : null;
        completion = true;
      } else if (r.ct > rec.ct) oursNewer = true;
    } else if (r?.ct !== undefined) oursNewer = true;

    if (typeof rec.dt === "number") {
      if (!r || r.dt === undefined || rec.dt > r.dt) {
        r = m.regs[key] ??= { t: 0 };
        r.dt = rec.dt;
        r.d = rec.d === 1;
        deletion = true;
      } else if (r.dt > rec.dt) oursNewer = true;
    } else if (r?.d) oursNewer = true;

    // Live here, but the account's record has no content (or lost a part): send ours.
    if (r && !r.d && !hasContent && r.h !== undefined) oursNewer = true;
    // A deletion just taken from the account needs no echo.
    if (oursNewer && r && !(r.d && deletion)) republish.add(key);

    if (!content && !completion && !deletion) continue;
    adopted.add(key);
    r = m.regs[key]!;

    if (kind === "i") {
      if (r.d) {
        if (itemsById.delete(id)) changed = true;
        continue;
      }
      const local = itemsById.get(id);
      let next: Item | null | undefined = local;
      if (content) {
        if (rec.v === DERIVED) {
          const parts = parseOccurrenceId(id);
          const s = parts ? seriesById.get(parts.seriesId) : undefined;
          next = s && parts && parts.epoch === s.epoch ? derivedOccurrence(s, parts.index, local?.createdAt ?? new Date(now).toISOString()) : local;
        } else {
          next = decodeItem(id, rec.v as Content, rec.t!, null) ?? local;
        }
      } else if (!local && rec.v !== undefined && rec.v !== DERIVED && typeof rec.t === "number") {
        // Restored, or completed here for the first time: its content comes with it.
        next = decodeItem(id, rec.v as Content, rec.t, null);
      }
      if (!next) continue;
      const completedAt = r.ct !== undefined ? (r.c ?? null) : (local?.completedAt ?? null);
      next = { ...next };
      if (completedAt) next.completedAt = completedAt;
      else delete next.completedAt;
      itemsById.set(id, next);
      changed = true;
    } else if (kind === "s") {
      if (r.d) {
        if (seriesById.delete(id)) {
          removedSeries.add(id);
          changed = true;
        }
        continue;
      }
      if (rec.v === undefined || rec.v === DERIVED) continue;
      // New here: generation starts after occurrence 0, which is always its own (synced) item.
      const next = decodeSeries(id, rec.v as Content, seriesById.get(id)?.nextIndex ?? 1);
      if (!next) continue;
      seriesById.set(id, next);
      changedSeries.add(id);
      changed = true;
    } else if (kind === "c") {
      if (r.d) {
        if (catsById.delete(id)) {
          catsChanged = true;
          changed = true;
        }
        continue;
      }
      if (rec.v === undefined || rec.v === DERIVED) continue;
      const next = decodeCategory(id, rec.v as Content, catsById.get(id)?.category.collapsed);
      if (!next) continue;
      catsById.set(id, next);
      catsChanged = true;
      changed = true;
    } else if (kind === "p" && content && rec.v !== DERIVED) {
      prefs = decodePrefs(rec.v as Content, state.prefs);
      changed = true;
    }
  }

  if (!changed) return { meta: m, state, republish, adopted, changed: false };

  let items = [...itemsById.values()];
  const series = [...seriesById.values()];

  // A series deleted elsewhere takes its upcoming occurrences with it, as it does here.
  if (removedSeries.size) {
    items = items.filter((i) => !(i.seriesId && removedSeries.has(i.seriesId) && !i.completedAt && finishOf(i) > now));
  }

  // A series changed elsewhere: occurrences it generated here follow it (as
  // they would have on the computer that changed it). Ones with their own
  // changes are synced separately and stay as they are.
  if (changedSeries.size) {
    const skip = skipSet(m);
    items = items.flatMap((i) => {
      if (!i.seriesId || !changedSeries.has(i.seriesId) || i.completedAt || finishOf(i) <= now) return [i];
      const reg = m.regs[itemKey(i.id)];
      if (reg && reg.h !== DERIVED) return [i];
      const s = seriesById.get(i.seriesId)!;
      const parts = parseOccurrenceId(i.id);
      if (!parts || parts.seriesId !== s.id) return [i];
      if (parts.epoch !== s.epoch) return [];
      const d = derivedOccurrence(s, parts.index, i.createdAt);
      return d ? [d] : [];
    });
    for (const s of series) {
      if (!changedSeries.has(s.id)) continue;
      const result = topUp(s, items, now, skip);
      items = [...items, ...result.added];
      if (result.series !== s) series[series.indexOf(s)] = result.series;
    }
  }

  const categories = catsChanged
    ? [...catsById.values()].sort((a, b) => a.order - b.order || a.category.id.localeCompare(b.category.id)).map((x) => x.category)
    : state.categories;

  return { meta: m, state: { items, series, categories, prefs }, republish, adopted, changed: true };
}

/** Generated occurrences deleted somewhere: never regenerate them. */
export function skipSet(meta: Meta): Set<string> {
  const out = new Set<string>();
  for (const [key, r] of Object.entries(meta.regs)) if (r.d && key.startsWith("i:") && parseOccurrenceId(key.slice(2))) out.add(key.slice(2));
  return out;
}

/**
 * Deletion markers old enough to let go. Markers for future occurrences of
 * a series stay until the date passes, so a computer joining later doesn't
 * regenerate an occurrence you removed.
 */
export function expiredTombstones(meta: Meta, state: LocalState, now: number): string[] {
  const seriesById = new Map(state.series.map((s) => [s.id, s]));
  const out: string[] = [];
  for (const [key, r] of Object.entries(meta.regs)) {
    if (!r.d || r.dt === undefined || now - r.dt < TOMBSTONE_MS) continue;
    const parts = key.startsWith("i:") ? parseOccurrenceId(key.slice(2)) : null;
    const s = parts ? seriesById.get(parts.seriesId) : undefined;
    if (s && parts && parts.epoch === s.epoch) {
      const date = occurrenceAt(s, parts.index);
      if (date && date.getTime() > now) continue;
    }
    out.push(key);
  }
  return out;
}

// ── When two computers' lists first meet ──────────────────────

const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
const itemDupKey = (i: Item) => `${norm(i.title)}|${Date.parse(i.dateTime)}|${i.type}|${i.allDay ? 1 : 0}`;
const seriesDupKey = (s: Series) => `${norm(s.template.title)}|${Date.parse(s.start)}|${s.template.type}|${JSON.stringify(s.rule)}|${JSON.stringify(s.end)}`;

/**
 * Groups things that came from another computer (`adopted` keys) with
 * matching things from this one, and keeps one of each: the smallest id.
 * Every computer picks the same one, so whichever computer merges first,
 * they agree, and the other copy is deleted everywhere as an ordinary
 * deletion. Nothing is lost: duplicates match on what you see (title,
 * time, kind), and a completion on the dropped copy moves to the kept one.
 *
 *   one-off items  same title, moment and Due/Starts
 *   categories     same name; their items move to the kept one
 *   series         same title, start, kind, rule and end; the dropped
 *                  one's upcoming occurrences go with it
 */
export function dedupeFirstJoin(state: LocalState, adopted: ReadonlySet<string>): LocalState {
  /** For each group with things from both computers: the kept id for every member. */
  const winners = <T extends { id: string }>(list: readonly T[], keyOf: (x: T) => string | null, keyFor: (id: string) => string) => {
    const groups = new Map<string, T[]>();
    for (const x of list) {
      const k = keyOf(x);
      if (k !== null) groups.set(k, [...(groups.get(k) ?? []), x]);
    }
    const map = new Map<string, string>();
    for (const group of groups.values()) {
      const foreign = group.some((x) => adopted.has(keyFor(x.id)));
      const ours = group.some((x) => !adopted.has(keyFor(x.id)));
      if (group.length < 2 || !foreign || !ours) continue;
      const kept = group.map((x) => x.id).sort()[0]!;
      for (const x of group) if (x.id !== kept) map.set(x.id, kept);
    }
    return map;
  };

  const catMap = winners(state.categories, (c) => norm(c.name), categoryKey);
  const remap = <T extends { categoryId?: string }>(x: T): T => {
    const to = x.categoryId ? catMap.get(x.categoryId) : undefined;
    return to ? { ...x, categoryId: to } : x;
  };
  const series = state.series.map(remap);
  const seriesMap = winners(series, seriesDupKey, seriesKey);
  const items = state.items.map(remap);
  const itemMap = winners(items, (i) => (i.seriesId ? null : itemDupKey(i)), itemKey);

  if (!catMap.size && !seriesMap.size && !itemMap.size) return state;

  const completedOn = new Map<string, string>();
  for (const i of items) {
    const kept = itemMap.get(i.id);
    if (kept && i.completedAt) completedOn.set(kept, i.completedAt);
  }
  return {
    items: items
      .filter((i) => !itemMap.has(i.id) && !(i.seriesId && seriesMap.has(i.seriesId) && !i.completedAt))
      .map((i) => (completedOn.has(i.id) && !i.completedAt ? { ...i, completedAt: completedOn.get(i.id)! } : i)),
    series: series.filter((s) => !seriesMap.has(s.id)),
    categories: state.categories.filter((c) => !catMap.has(c.id)),
    prefs: state.prefs,
  };
}
