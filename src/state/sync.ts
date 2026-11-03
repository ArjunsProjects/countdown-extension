import { effect, signal } from "@preact/signals";
import { SyncEngine, type EngineDeps, type SyncArea, type SyncStatus } from "../lib/sync/engine";
import type { LocalState, Meta } from "../lib/sync/merge";
import type { CompletionRecord } from "../lib/types";
import { applySyncState, categories, completions, items, prefs, replaceState, series, skipOccurrences } from "./store";
import { showToast } from "./toast";

// Sync across computers through Chrome sync (chrome.storage.sync): the
// list goes to the user's other computers signed in to the same Chrome
// profile, never to a server of ours. See lib/sync for how merging works.
//
// One Countdown page at a time runs it (a Web Lock picks which: the side
// panel, or the calendar tab), so this computer's merges have one writer.
// Every page reads the status and the on/off setting from local storage.
// When no page is open nothing is lost: Chrome keeps other computers'
// changes, and they're merged as soon as Countdown opens.

const META_KEY = "syncMeta";
const BACKUP_KEY = "syncBackup";
const ENABLED_KEY = "syncEnabled";
const STATUS_KEY = "syncStatus";
/** Local changes are uploaded this long after the last one (several quick edits go together). */
const DEBOUNCE_MS = 1000;
/** How long the list from before the first sync can be restored. */
export const BACKUP_DAYS = 30;

export const syncSupported = typeof chrome !== "undefined" && Boolean(chrome.storage?.sync);
export const syncEnabled = signal(true);
export const syncStatus = signal<SyncStatus>({ state: "off", at: 0 });
/** When the list from before sync was saved, if it can still be restored. */
export const backupAt = signal<number | null>(null);

interface Backup {
  at: number;
  state: LocalState & { completions: CompletionRecord[] };
}

const chromeArea: SyncArea = {
  get: () => chrome.storage.sync.get(null),
  set: (values) => chrome.storage.sync.set(values),
  remove: (keys) => chrome.storage.sync.remove(keys),
  subscribe(onChange) {
    const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === "sync") onChange(changes);
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  },
};

const freshBackup = (b: Backup | undefined) => (b && Date.now() - b.at < BACKUP_DAYS * 86_400_000 ? b : undefined);

/** Reads the setting and status, follows changes from other pages, and runs sync if this page is chosen to. */
export async function startSync() {
  if (!syncSupported) return;
  const stored = await chrome.storage.local.get([ENABLED_KEY, STATUS_KEY, BACKUP_KEY]);
  syncEnabled.value = stored[ENABLED_KEY] !== false;
  if (stored[STATUS_KEY]) syncStatus.value = stored[STATUS_KEY] as SyncStatus;
  backupAt.value = freshBackup(stored[BACKUP_KEY] as Backup | undefined)?.at ?? null;
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (ENABLED_KEY in changes) syncEnabled.value = changes[ENABLED_KEY]!.newValue !== false;
    if (STATUS_KEY in changes && changes[STATUS_KEY]!.newValue) syncStatus.value = changes[STATUS_KEY]!.newValue as SyncStatus;
    if (BACKUP_KEY in changes) backupAt.value = freshBackup(changes[BACKUP_KEY]!.newValue as Backup | undefined)?.at ?? null;
  });
  // Held until this page closes; then the next open page takes over.
  void navigator.locks.request("countdown-sync", () => new Promise<void>(() => lead()));
}

/** Runs sync for this computer, from this page. */
function lead() {
  let engine: SyncEngine | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const deps: EngineDeps = {
    area: chromeArea,
    loadMeta: async () => ((await chrome.storage.local.get(META_KEY))[META_KEY] as Meta | undefined) ?? null,
    saveMeta: (meta) => chrome.storage.local.set({ [META_KEY]: meta }),
    async backup(state) {
      // Only the first time: the list as it was before any merge.
      const existing = (await chrome.storage.local.get(BACKUP_KEY))[BACKUP_KEY];
      if (!existing) await chrome.storage.local.set({ [BACKUP_KEY]: { at: Date.now(), state: { ...state, completions: completions.value } } satisfies Backup });
    },
    read: () => ({ items: items.value, series: series.value, categories: categories.value, prefs: prefs.value }),
    apply: (next) => applySyncState(next),
    setSkip: (ids) => {
      skipOccurrences.value = ids;
    },
    status: (status) => {
      const changed = status.state !== syncStatus.value.state;
      syncStatus.value = status;
      // Shared with other open pages; written when it changes, and after each sync.
      if (changed || status.state === "ok") void chrome.storage.local.set({ [STATUS_KEY]: status });
    },
    now: Date.now,
  };

  effect(() => {
    if (syncEnabled.value) {
      engine ??= new SyncEngine(deps);
      void engine.start();
    } else if (engine) {
      engine.stop();
      engine = null;
    }
  });

  // Anything changed here (in this page, or another page's change read from storage): upload it shortly.
  effect(() => {
    void [items.value, series.value, categories.value, prefs.value];
    clearTimeout(timer);
    timer = setTimeout(() => void engine?.localChanged(), DEBOUNCE_MS);
  });
  // Closing or hiding the page: upload now rather than in a second.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && engine) {
      clearTimeout(timer);
      void engine.localChanged();
    }
  });
}

export function setSyncEnabled(on: boolean) {
  syncEnabled.value = on;
  void chrome.storage.local.set({ [ENABLED_KEY]: on });
}

/**
 * Puts back this computer's list from before sync first merged it, and turns
 * sync off here. Sync's memory of what it shared is cleared too, so turning
 * it back on merges afresh (adding, never deleting) rather than sending the
 * restore to other computers as deletions.
 */
export async function restoreBackup() {
  const backup = freshBackup((await chrome.storage.local.get(BACKUP_KEY))[BACKUP_KEY] as Backup | undefined);
  if (!backup) return;
  setSyncEnabled(false);
  await chrome.storage.local.remove([META_KEY]);
  skipOccurrences.value = new Set();
  replaceState(backup.state);
  showToast({ message: "Restored your list from before sync. Sync is off on this computer." });
}
