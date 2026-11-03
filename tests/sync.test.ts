import { describe, expect, it } from "vitest";
import { toLocalISO } from "../src/lib/dates";
import { presetRule, topUp, type Series } from "../src/lib/recurrence";
import { DEFAULT_PREFS } from "../src/lib/storage";
import { SyncEngine, type SyncArea, type SyncStatus } from "../src/lib/sync/engine";
import { FORMAT_VERSION, itemKey, seriesKey, type LocalState, type Meta } from "../src/lib/sync/merge";
import { decodeItem, encodeItem, isDerived } from "../src/lib/sync/records";
import type { Category } from "../src/lib/categories";
import type { Item } from "../src/lib/types";

// ── A simulated Chrome sync ────────────────────────────────────
// Follows what Chromium's extension sync does (syncable_settings_storage.cc):
// each computer has its own copy of the area; writes there go to the
// account once that computer is syncing; the account keeps the last write
// per key and passes it to every other syncing computer. When a computer
// starts syncing and the account already has data for the extension, the
// computer's copy is overwritten with the account's and keys only it had
// are DELETED (not uploaded). If the account is empty, the computer's keys
// are uploaded.

class Cloud {
  data = new Map<string, unknown>();
  areas: FakeArea[] = [];
}

type Changes = Record<string, { newValue?: unknown }>;
const copy = <T,>(v: T): T => (v === undefined ? v : structuredClone(v));

class FakeArea implements SyncArea {
  data = new Map<string, unknown>();
  syncing = false;
  private listeners = new Set<(c: Changes) => void>();
  constructor(private cloud: Cloud) {
    cloud.areas.push(this);
  }
  async get() {
    return Object.fromEntries([...this.data].map(([k, v]) => [k, copy(v)]));
  }
  async set(values: Record<string, unknown>) {
    const changes: Changes = {};
    for (const [k, v] of Object.entries(values)) {
      this.data.set(k, copy(v));
      changes[k] = { newValue: copy(v) };
    }
    this.emit(changes);
    if (this.syncing) this.upload(changes);
  }
  async remove(keys: string[]) {
    const changes: Changes = {};
    for (const k of keys) {
      if (this.data.delete(k)) changes[k] = {};
    }
    this.emit(changes);
    if (this.syncing) this.upload(changes);
  }
  subscribe(cb: (c: Changes) => void) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
  /** Chrome starting sync for this extension on this computer. */
  startSyncing() {
    if (this.cloud.data.size === 0) {
      const changes: Changes = {};
      for (const [k, v] of this.data) changes[k] = { newValue: copy(v) };
      this.syncing = true;
      this.upload(changes);
      return;
    }
    const changes: Changes = {};
    for (const k of [...this.data.keys()]) {
      if (!this.cloud.data.has(k)) {
        this.data.delete(k); // "Not synced, delete local setting."
        changes[k] = {};
      }
    }
    for (const [k, v] of this.cloud.data) {
      if (JSON.stringify(this.data.get(k)) !== JSON.stringify(v)) {
        this.data.set(k, copy(v));
        changes[k] = { newValue: copy(v) };
      }
    }
    this.syncing = true;
    this.emit(changes);
  }
  private upload(changes: Changes) {
    for (const [k, c] of Object.entries(changes)) {
      if (c.newValue === undefined) this.cloud.data.delete(k);
      else this.cloud.data.set(k, copy(c.newValue));
    }
    for (const other of this.cloud.areas) if (other !== this && other.syncing) other.receive(changes);
  }
  private receive(changes: Changes) {
    for (const [k, c] of Object.entries(changes)) {
      if (c.newValue === undefined) this.data.delete(k);
      else this.data.set(k, copy(c.newValue));
    }
    this.emit(changes);
  }
  private emit(changes: Changes) {
    if (Object.keys(changes).length === 0) return;
    const snapshot = copy(changes);
    for (const cb of this.listeners) queueMicrotask(() => cb(snapshot));
  }
}

// ── A computer running Countdown ───────────────────────────────

const clock = { t: Date.UTC(2026, 10, 3, 17, 0, 0) };

class Computer {
  area: FakeArea;
  state: LocalState;
  meta: Meta | null = null;
  backup: LocalState | null = null;
  skip = new Set<string>();
  status: SyncStatus | null = null;
  engine: SyncEngine;
  constructor(cloud: Cloud, initial: Partial<LocalState> = {}, public skew = 0) {
    this.area = new FakeArea(cloud);
    this.state = { items: [], series: [], categories: [], prefs: DEFAULT_PREFS, ...initial };
    this.engine = new SyncEngine({
      area: this.area,
      loadMeta: async () => copy(this.meta),
      saveMeta: async (m) => void (this.meta = copy(m)),
      backup: async (s) => void (this.backup = copy(s)),
      read: () => this.state,
      apply: (s) => void (this.state = s),
      setSkip: (ids) => void (this.skip = ids),
      status: (s) => void (this.status = s),
      now: () => clock.t + this.skew,
      later: () => {},
    });
  }
  /** A change made here (the store would then tell the engine). */
  async edit(change: (s: LocalState) => LocalState) {
    this.state = change(this.state);
    await this.engine.localChanged();
  }
  titles = () => this.state.items.map((i) => i.title).sort();
}

/** Lets every queued callback and engine step run to completion. */
async function settle(...computers: Computer[]) {
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 0));
    await Promise.all(computers.map((c) => c.engine.idle()));
  }
}

const later = (ms: number) => (clock.t += ms);

let n = 0;
const local = (days: number, h = 9, m = 0) => {
  const d = new Date(clock.t);
  d.setDate(d.getDate() + days);
  d.setHours(h, m, 0, 0);
  return toLocalISO(d);
};
const item = (title: string, days: number, extra: Partial<Item> = {}): Item => ({
  id: `${title.replace(/\W/g, "")}-${++n}-0000-0000-000000000000`,
  title,
  type: "due",
  dateTime: local(days),
  createdAt: toLocalISO(new Date(clock.t)),
  updatedAt: toLocalISO(new Date(clock.t)),
  source: "manual",
  ...extra,
});
const category = (name: string, color: Category["color"]): Category => ({ id: `${name}-${++n}`, name, color });

// ── Records ────────────────────────────────────────────────────

describe("sync records", () => {
  it("round-trip an item, and keep fields a newer version added", () => {
    const original = item("Lecture", 3, {
      type: "starts",
      endDateTime: local(3, 10, 30),
      location: "Swing Space",
      notes: "Bring laptop",
      categoryId: "c1",
      ...({ futureField: { a: 1 } } as object),
    });
    const back = decodeItem(original.id, encodeItem(original), clock.t, null)!;
    expect(back).toMatchObject({ title: "Lecture", type: "starts", location: "Swing Space", notes: "Bring laptop", categoryId: "c1" });
    expect(Date.parse(back.dateTime)).toBe(Date.parse(original.dateTime));
    expect(Date.parse(back.endDateTime!)).toBe(Date.parse(original.endDateTime!));
    expect((back as unknown as { futureField: unknown }).futureField).toEqual({ a: 1 });
  });

  it("send all-day dates as dates, so they stay on the same day in another time zone", () => {
    const holiday = item("Remembrance Day", 8, { type: "starts", allDay: true, dateTime: local(8, 0) });
    expect(encodeItem(holiday).s).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("spot occurrences that are exactly what their series makes", () => {
    const s: Series = { id: "s1", epoch: 0, start: local(1, 12), rule: presetRule("weekly"), end: { type: "never" }, template: { title: "Lab", type: "starts", duration: 60 }, nextIndex: 1 };
    const { added } = topUp(s, [], clock.t);
    const byId = new Map([[s.id, s]]);
    expect(added.every((i) => isDerived(i, byId))).toBe(true);
    expect(isDerived({ ...added[0]!, title: "Moved lab" }, byId)).toBe(false);
    expect(isDerived({ ...added[0]!, completedAt: toLocalISO(new Date(clock.t)) }, byId)).toBe(false);
  });
});

// ── Several computers ──────────────────────────────────────────

describe("two computers with different lists", () => {
  it("end up with both lists, duplicates kept once, even when Chrome deletes the second computer's upload", async () => {
    const cloud = new Cloud();
    const cpscA = category("CPSC 213", "violet");
    const cpscB = category("cpsc 213 ", "teal");
    const essay = item("Essay", 5);
    const laptop = new Computer(cloud, { categories: [cpscA], items: [item("Midterm", 2, { categoryId: cpscA.id }), essay] });
    const desktop = new Computer(cloud, {
      categories: [cpscB],
      items: [item("Lab 4", 3, { categoryId: cpscB.id }), { ...essay, id: "same-essay-on-desktop-0000-000000000000" }],
    });

    // The laptop updates first.
    laptop.area.startSyncing();
    await laptop.engine.start();
    await settle(laptop);

    // The desktop's Countdown runs before Chrome has started syncing it, so
    // its upload lands locally; then Chrome starts and deletes those keys.
    await desktop.engine.start();
    await settle(desktop);
    desktop.area.startSyncing();
    await settle(laptop, desktop);

    for (const c of [laptop, desktop]) {
      expect(c.titles()).toEqual(["Essay", "Lab 4", "Midterm"]);
      expect(c.state.categories.map((x) => x.name)).toEqual(["CPSC 213"]);
      // Lab 4 moved into the account's CPSC 213 category.
      expect(c.state.items.every((i) => i.title === "Essay" || i.categoryId === cpscA.id)).toBe(true);
    }
    expect(desktop.backup?.items.map((i) => i.title).sort()).toEqual(["Essay", "Lab 4"]);
    // Three live items; the dropped duplicate is a deletion marker.
    const records = [...cloud.data].filter(([k]) => k.startsWith("i:"));
    expect(records.filter(([, v]) => (v as { d?: number }).d !== 1)).toHaveLength(3);
    expect(records.filter(([, v]) => (v as { d?: number }).d === 1)).toHaveLength(1);
    expect(cloud.data.get("v")).toBe(FORMAT_VERSION);
  });
});

async function pair() {
  const cloud = new Cloud();
  const a = new Computer(cloud);
  const b = new Computer(cloud);
  for (const c of [a, b]) {
    c.area.startSyncing();
    await c.engine.start();
  }
  await settle(a, b);
  return { cloud, a, b };
}

describe("edits on two computers", () => {
  it("passes new items and edits across", async () => {
    const { a, b } = await pair();
    const quiz = item("Quiz", 4);
    await a.edit((s) => ({ ...s, items: [...s.items, quiz] }));
    await settle(a, b);
    expect(b.titles()).toEqual(["Quiz"]);
    later(1000);
    await b.edit((s) => ({ ...s, items: s.items.map((i) => ({ ...i, title: "Quiz 3" })) }));
    await settle(a, b);
    expect(a.titles()).toEqual(["Quiz 3"]);
  });

  it("lets the later edit of the same item win on both", async () => {
    const { a, b } = await pair();
    const quiz = item("Quiz", 4);
    await a.edit((s) => ({ ...s, items: [quiz] }));
    await settle(a, b);
    // Both edit before hearing from the other.
    b.area.syncing = false;
    later(1000);
    await a.edit((s) => ({ ...s, items: s.items.map((i) => ({ ...i, title: "From laptop" })) }));
    later(1000);
    await b.edit((s) => ({ ...s, items: s.items.map((i) => ({ ...i, title: "From desktop" })) }));
    b.area.startSyncing();
    await b.engine.start();
    await settle(a, b);
    expect(a.titles()).toEqual(["From desktop"]);
    expect(b.titles()).toEqual(["From desktop"]);
  });

  it("never lets an edit undo a completion made elsewhere", async () => {
    const { a, b } = await pair();
    const quiz = item("Quiz", 4);
    await a.edit((s) => ({ ...s, items: [quiz] }));
    await settle(a, b);
    b.area.syncing = false;
    later(1000);
    await a.edit((s) => ({ ...s, items: s.items.map((i) => ({ ...i, completedAt: toLocalISO(new Date(clock.t)) })) }));
    later(5000);
    await b.edit((s) => ({ ...s, items: s.items.map((i) => ({ ...i, notes: "Chapters 4–6" })) }));
    b.area.startSyncing();
    await b.engine.start();
    await settle(a, b);
    for (const c of [a, b]) {
      expect(c.state.items[0]!.completedAt).toBeDefined();
      expect(c.state.items[0]!.notes).toBe("Chapters 4–6");
    }
  });

  it("keeps a deletion even if the other computer edited it meanwhile, and Undo brings it back everywhere", async () => {
    const { a, b } = await pair();
    const quiz = item("Quiz", 4);
    await a.edit((s) => ({ ...s, items: [quiz] }));
    await settle(a, b);
    b.area.syncing = false;
    later(1000);
    await a.edit((s) => ({ ...s, items: [] }));
    later(1000);
    await b.edit((s) => ({ ...s, items: s.items.map((i) => ({ ...i, notes: "edited" })) }));
    b.area.startSyncing();
    await b.engine.start();
    await settle(a, b);
    expect(a.titles()).toEqual([]);
    expect(b.titles()).toEqual([]);

    later(1000);
    await a.edit((s) => ({ ...s, items: [quiz] }));
    await settle(a, b);
    expect(b.titles()).toEqual(["Quiz"]);
  });

  it("can't be beaten by a computer whose clock is an hour behind", async () => {
    const cloud = new Cloud();
    const a = new Computer(cloud);
    const b = new Computer(cloud, {}, -3_600_000);
    for (const c of [a, b]) {
      c.area.startSyncing();
      await c.engine.start();
    }
    const quiz = item("Quiz", 4);
    await a.edit((s) => ({ ...s, items: [quiz] }));
    await settle(a, b);
    later(1000);
    await b.edit((s) => ({ ...s, items: s.items.map((i) => ({ ...i, title: "Edited on the slow computer" })) }));
    await settle(a, b);
    expect(a.titles()).toEqual(["Edited on the slow computer"]);
  });

  it("puts back a key Chrome lost", async () => {
    const { cloud, a, b } = await pair();
    await a.edit((s) => ({ ...s, items: [item("Quiz", 4)] }));
    await settle(a, b);
    const key = [...cloud.data.keys()].find((k) => k.startsWith("i:"))!;
    await b.area.remove([key]);
    await settle(a, b);
    expect(cloud.data.has(key)).toBe(true);
    expect(a.titles()).toEqual(["Quiz"]);
  });

  it("syncs settings, but not which sections are collapsed", async () => {
    const { a, b } = await pair();
    await a.edit((s) => ({ ...s, prefs: { ...s.prefs, theme: "dark", palette: "fern", overdueCollapsed: true } }));
    await settle(a, b);
    expect(b.state.prefs.theme).toBe("dark");
    expect(b.state.prefs.palette).toBe("fern");
    expect(b.state.prefs.overdueCollapsed).toBe(DEFAULT_PREFS.overdueCollapsed);
  });
});

describe("repeating series across computers", () => {
  const weekly = (): { s: Series; first: Item } => {
    const first = item("CPSC 213 lecture", 1, { type: "starts", dateTime: local(1, 12, 30), endDateTime: local(1, 14), location: "Swing Space" });
    const s: Series = {
      id: `series-${++n}-0000-0000-000000000000`,
      epoch: 0,
      start: first.dateTime,
      rule: presetRule("weekly"),
      end: { type: "never" },
      template: { title: first.title, type: "starts", duration: 90, location: "Swing Space" },
      nextIndex: 1,
    };
    return { s, first: { ...first, seriesId: s.id } };
  };
  const withOccurrences = (state: LocalState, s: Series, first: Item): LocalState => {
    const { series, added } = topUp(s, [first], clock.t);
    return { ...state, series: [...state.series, series], items: [...state.items, first, ...added] };
  };

  it("sends the rule, not the generated occurrences; the other computer generates the same ones", async () => {
    const { cloud, a, b } = await pair();
    const { s, first } = weekly();
    await a.edit((st) => withOccurrences(st, s, first));
    await settle(a, b);
    expect([...cloud.data.keys()].filter((k) => k.startsWith("i:"))).toEqual([itemKey(first.id)]);
    expect(cloud.data.has(seriesKey(s.id))).toBe(true);
    expect(b.state.items.map((i) => i.id).sort()).toEqual(a.state.items.map((i) => i.id).sort());
    expect(b.state.items.every((i) => i.location === "Swing Space")).toBe(true);
  });

  it("removes an occurrence everywhere, and doesn't regenerate it", async () => {
    const { a, b } = await pair();
    const { s, first } = weekly();
    await a.edit((st) => withOccurrences(st, s, first));
    await settle(a, b);
    const third = a.state.items.find((i) => i.id.endsWith("~0~2"))!;
    later(1000);
    await a.edit((st) => ({ ...st, items: st.items.filter((i) => i.id !== third.id) }));
    await settle(a, b);
    expect(b.state.items.some((i) => i.id === third.id)).toBe(false);
    expect(b.skip.has(third.id)).toBe(true);
    // A third computer joining later doesn't bring it back either.
    const c = new Computer(a.area["cloud"] as Cloud);
    c.area.startSyncing();
    await c.engine.start();
    await settle(a, b, c);
    expect(c.state.items.some((i) => i.id === third.id)).toBe(false);
    expect(c.state.items.length).toBe(a.state.items.length);
  });

  it("carries a completed or moved occurrence, and a renamed series", async () => {
    const { a, b } = await pair();
    const { s, first } = weekly();
    await a.edit((st) => withOccurrences(st, s, first));
    await settle(a, b);
    const second = a.state.items.find((i) => i.id.endsWith("~0~1"))!;
    later(1000);
    await a.edit((st) => ({ ...st, items: st.items.map((i) => (i.id === second.id ? { ...i, completedAt: toLocalISO(new Date(clock.t)) } : i)) }));
    await settle(a, b);
    expect(b.state.items.find((i) => i.id === second.id)?.completedAt).toBeDefined();

    later(1000);
    // Renaming the series renames its upcoming, uncompleted occurrences (as saveSeries does).
    await a.edit((st) => ({
      ...st,
      series: st.series.map((x) => ({ ...x, template: { ...x.template, title: "CPSC 213 101 Lecture" } })),
      items: st.items.map((i) => (i.seriesId === s.id && !i.completedAt && Date.parse(i.dateTime) > clock.t ? { ...i, title: "CPSC 213 101 Lecture" } : i)),
    }));
    await settle(a, b);
    const titles = new Set(b.state.items.filter((i) => !i.completedAt).map((i) => i.title));
    expect(titles).toEqual(new Set(["CPSC 213 101 Lecture"]));
  });
});

describe("limits and safety", () => {
  it("holds completed items over a year old on the computer they're on", async () => {
    const { cloud, a } = await pair();
    const old = item("Old essay", -500, { completedAt: local(-499) });
    await a.edit((s) => ({ ...s, items: [old, item("New quiz", 3)] }));
    await settle(a);
    expect([...cloud.data.keys()].filter((k) => k.startsWith("i:"))).toHaveLength(1);
    expect(a.titles()).toEqual(["New quiz", "Old essay"]);
  });

  it("stops, rather than guess, when a newer Countdown wrote the account", async () => {
    const cloud = new Cloud();
    cloud.data.set("v", FORMAT_VERSION + 1);
    const a = new Computer(cloud, { items: [item("Quiz", 2)] });
    a.area.startSyncing();
    await a.engine.start();
    await settle(a);
    expect(a.status?.state).toBe("update");
    expect([...cloud.data.keys()]).toEqual(["v"]);
    expect(a.titles()).toEqual(["Quiz"]);
  });
});

describe("convergence under random use", () => {
  /** Deterministic pseudo-random numbers, so a failure can be replayed. */
  const rng = (seed: number) => () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const view = (c: Computer) =>
    c.state.items
      .map((i) => `${i.id}|${i.title}|${i.notes ?? ""}|${i.completedAt ? "done" : ""}`)
      .sort()
      .join("\n");

  it.each([1, 2, 3, 4, 5])("three computers agree after 300 random changes (seed %i)", async (seed) => {
    const random = rng(seed);
    const pick = <T,>(list: readonly T[]) => list[Math.floor(random() * list.length)]!;
    const cloud = new Cloud();
    const computers = [new Computer(cloud), new Computer(cloud), new Computer(cloud, {}, -90_000)];
    const removed = new Map<Computer, Item[]>(computers.map((c) => [c, []]));
    for (const c of computers) {
      c.area.startSyncing();
      await c.engine.start();
    }
    await settle(...computers);

    for (let step = 0; step < 300; step++) {
      later(1 + Math.floor(random() * 5000));
      const c = pick(computers);
      const roll = random();
      if (roll < 0.08) {
        // Offline for a while, or back online (Chrome reconnects: the account's copy overwrites ours).
        if (c.area.syncing) c.area.syncing = false;
        else {
          c.area.startSyncing();
          await c.engine.start();
        }
      } else if (roll < 0.35 || c.state.items.length === 0) {
        await c.edit((s) => ({ ...s, items: [...s.items, item(`Task ${step}`, Math.floor(random() * 20))] }));
      } else if (roll < 0.6) {
        const target = pick(c.state.items);
        const notes = `edit ${step}`;
        await c.edit((s) => ({ ...s, items: s.items.map((i) => (i.id === target.id ? (random() < 0.5 ? { ...i, title: `${i.title}*` } : { ...i, notes }) : i)) }));
      } else if (roll < 0.75) {
        const target = pick(c.state.items);
        const done = target.completedAt ? undefined : toLocalISO(new Date(clock.t));
        await c.edit((s) => ({
          ...s,
          items: s.items.map((i) => {
            if (i.id !== target.id) return i;
            const { completedAt: _, ...rest } = i;
            return done ? { ...rest, completedAt: done } : rest;
          }),
        }));
      } else if (roll < 0.92) {
        const target = pick(c.state.items);
        removed.get(c)!.push(target);
        await c.edit((s) => ({ ...s, items: s.items.filter((i) => i.id !== target.id) }));
      } else {
        // Undo a removal made on this computer.
        const back = removed.get(c)!.pop();
        if (back && !c.state.items.some((i) => i.id === back.id)) await c.edit((s) => ({ ...s, items: [...s.items, back] }));
      }
      if (step % 7 === 0) await settle(...computers);
    }

    for (const c of computers) {
      if (!c.area.syncing) {
        c.area.startSyncing();
        await c.engine.start();
      }
    }
    await settle(...computers);
    const [first, ...rest] = computers.map(view);
    for (const other of rest) expect(other).toBe(first);
    expect(computers[0]!.state.items.length).toBeGreaterThan(0);
  });
});
