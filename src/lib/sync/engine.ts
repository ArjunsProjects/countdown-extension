import { finishOf } from "../events";
import {
  dedupeFirstJoin,
  expiredTombstones,
  FORMAT_VERSION,
  merge,
  newMeta,
  publish,
  recordOf,
  skipSet,
  snapshot,
  VERSION_KEY,
  type LocalState,
  type Meta,
  type Rec,
} from "./merge";
import type { Item } from "../types";

// Runs sync for one computer: merges the account's copy into this
// computer's state, uploads what changed here, and reacts to changes from
// other computers. Storage and state come in as dependencies, so tests run
// it against simulated computers that follow Chrome's own sync rules.

export interface SyncArea {
  get(): Promise<Record<string, unknown>>;
  set(values: Record<string, unknown>): Promise<void>;
  remove(keys: string[]): Promise<void>;
  /** Changes to the area, from this computer or another. Returns an unsubscribe function. */
  subscribe(onChange: (changes: Record<string, { newValue?: unknown }>) => void): () => void;
}

export type SyncState = "off" | "syncing" | "ok" | "full" | "update" | "error";

export interface SyncStatus {
  state: SyncState;
  /** When it last finished a sync. */
  at: number;
}

export interface EngineDeps {
  area: SyncArea;
  loadMeta(): Promise<Meta | null>;
  saveMeta(meta: Meta): Promise<void>;
  /** Called once, before the first merge, with this computer's state as it was. */
  backup(state: LocalState): Promise<void>;
  read(): LocalState;
  apply(next: LocalState): void;
  /** Occurrences removed on some computer, which occurrence top-up must not regenerate. */
  setSkip(ids: Set<string>): void;
  status(status: SyncStatus): void;
  now(): number;
  /** Retry later after Chrome's write limit (default: setTimeout). */
  later?(run: () => void, ms: number): void;
}

/** Keys per write. Well under Chrome's limits whether it counts calls or keys. */
const CHUNK = 50;
const RETRY_MS = 60_000;

export class SyncEngine {
  private meta: Meta = newMeta();
  private queue: Promise<void> = Promise.resolve();
  private unsubscribe: (() => void) | null = null;
  private stopped = false;
  private paused = false;

  constructor(private deps: EngineDeps) {}

  /** Merges with the account and starts listening for changes from other computers. */
  start(): Promise<void> {
    return this.run(() => this.reconcile());
  }

  /** Something changed on this computer: upload it. */
  localChanged(): Promise<void> {
    return this.run(() => this.upload(new Set()));
  }

  /** Resolves when everything queued so far has run. */
  idle(): Promise<void> {
    return this.queue;
  }

  stop() {
    this.stopped = true;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.deps.status({ state: "off", at: this.deps.now() });
  }

  /** One step at a time, so merges and uploads never interleave. */
  private run(task: () => Promise<void>): Promise<void> {
    const next = this.queue.then(() => (this.stopped || this.paused ? undefined : task())).catch((error: unknown) => this.fail(error));
    this.queue = next;
    return next;
  }

  private async reconcile() {
    const now = this.deps.now();
    this.meta = (await this.deps.loadMeta()) ?? newMeta();
    const all = await this.deps.area.get();
    if (this.tooNew(all[VERSION_KEY])) return;

    const firstJoin = !this.meta.joined;
    if (firstJoin) await this.deps.backup(this.deps.read());

    // Every key in the account, plus every key this computer knows (missing ones are uploaded again).
    const remote = new Map<string, Rec | undefined>();
    for (const [key, value] of Object.entries(all)) remote.set(key, value as Rec);
    for (const key of Object.keys(this.meta.regs)) if (!remote.has(key)) remote.set(key, undefined);

    const merged = merge(this.meta, this.deps.read(), remote, now);
    this.meta = merged.meta;
    const state = this.firstContact(merged.state, merged.adopted);
    if (merged.changed || state !== merged.state) this.deps.apply(state);

    this.unsubscribe ??= this.deps.area.subscribe((changes) => void this.run(() => this.remoteChanged(changes)));
    await this.upload(merged.republish, all[VERSION_KEY] === undefined);
  }

  private async remoteChanged(changes: Record<string, { newValue?: unknown }>) {
    if (VERSION_KEY in changes && this.tooNew(changes[VERSION_KEY]!.newValue)) return;
    const remote = new Map<string, Rec | undefined>();
    for (const [key, change] of Object.entries(changes)) remote.set(key, change.newValue as Rec | undefined);
    const merged = merge(this.meta, this.deps.read(), remote, this.deps.now());
    this.meta = merged.meta;
    const state = this.firstContact(merged.state, merged.adopted);
    if (merged.changed || state !== merged.state) this.deps.apply(state);
    // The version marker itself went missing: put it back.
    await this.upload(merged.republish, VERSION_KEY in changes && changes[VERSION_KEY]!.newValue === undefined);
  }

  /**
   * The first time another computer's things arrive (at start, or later if
   * Chrome connects after Countdown starts), matching things are kept once.
   */
  private firstContact(state: LocalState, adopted: Set<string>): LocalState {
    if (this.meta.joined || adopted.size === 0) return state;
    this.meta.joined = true;
    return dedupeFirstJoin(state, adopted);
  }

  /** A newer Countdown wrote this account's data: stop, rather than risk misreading it. */
  private tooNew(version: unknown): boolean {
    if (typeof version !== "number" || version <= FORMAT_VERSION) return false;
    this.paused = true;
    this.deps.status({ state: "update", at: this.deps.now() });
    return true;
  }

  private async upload(republish: Set<string>, writeVersion = false) {
    const now = this.deps.now();
    const state = this.deps.read();
    const snap = snapshot(state, now);
    const pub = publish(this.meta, snap, now);
    this.meta = pub.meta;

    const writes: Record<string, unknown> = { ...pub.writes };
    for (const key of republish) {
      const r = this.meta.regs[key];
      if (r && !(key in writes)) writes[key] = recordOf(r, r.d ? undefined : snap.entries.get(key)?.content);
    }
    const expired = expiredTombstones(this.meta, state, now);
    for (const key of expired) delete this.meta.regs[key];
    const removes = [...pub.removes, ...expired].filter((key) => !(key in writes));
    if (writeVersion) writes[VERSION_KEY] = FORMAT_VERSION;

    this.deps.setSkip(skipSet(this.meta));
    // Saved first: if this page closes mid-upload, keys missing from the
    // account are uploaded again next time.
    await this.deps.saveMeta(this.meta);

    const byId = new Map(state.items.map((i) => [i.id, i]));
    const rank = (key: string) => priority(key, writes[key], byId, now);
    const keys = Object.keys(writes).sort((a, b) => rank(a) - rank(b));
    if (keys.length || removes.length) this.deps.status({ state: "syncing", at: now });
    for (let i = 0; i < keys.length; i += CHUNK) {
      const chunk = keys.slice(i, i + CHUNK);
      await this.deps.area.set(Object.fromEntries(chunk.map((k) => [k, writes[k]])));
    }
    if (removes.length) await this.deps.area.remove(removes);
    this.deps.status({ state: "ok", at: this.deps.now() });
  }

  private fail(error: unknown) {
    const message = String(error instanceof Error ? error.message : error);
    if (/QUOTA_BYTES|MAX_ITEMS/.test(message)) {
      // Full: what fitted (the most important first) is synced; the rest stays here.
      this.deps.status({ state: "full", at: this.deps.now() });
    } else if (/MAX_WRITE_OPERATIONS/.test(message)) {
      this.deps.status({ state: "error", at: this.deps.now() });
      (this.deps.later ?? ((run, ms) => setTimeout(run, ms)))(() => void this.localChanged(), RETRY_MS);
    } else {
      console.error("Countdown: sync failed", error);
      this.deps.status({ state: "error", at: this.deps.now() });
    }
  }
}

/**
 * Upload order, most important first, so a full account still has what
 * matters: the version marker, settings, categories, series, then items
 * still to come, deletions, and finally past and completed items.
 */
function priority(key: string, rec: unknown, items: ReadonlyMap<string, Item>, now: number): number {
  if (key === VERSION_KEY) return 0;
  if (key === "p") return 1;
  if (key.startsWith("c:")) return 2;
  if (key.startsWith("s:")) return 3;
  if ((rec as Rec | undefined)?.d === 1) return 5;
  const item = items.get(key.slice(2));
  return item && !item.completedAt && finishOf(item) > now ? 4 : 6;
}
