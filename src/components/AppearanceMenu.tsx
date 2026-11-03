import { useEffect, useId, useRef, useState } from "preact/hooks";
import { PALETTES, paletteById, type Palette, type PaletteId } from "../lib/palettes";
import type { Theme } from "../lib/storage";
import { remindersDenied, remindersOn, setRemindersOn } from "../state/reminders";
import { prefs, setPrefs } from "../state/store";
import { backupAt, restoreBackup, setSyncEnabled, syncEnabled, syncStatus, syncSupported } from "../state/sync";
import { setAppearance, shownAppearance, systemDark, THEME_LABEL } from "../state/theme";
import { Icon } from "./Icon";
import { Popover } from "./Popover";
import { ReminderField } from "./ReminderField";

const THEMES: Theme[] = ["system", "light", "dark"];

const clockTime = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" });

/** What sync is doing, in a line. */
function syncHint(): string {
  if (!syncSupported) return "Sync works in the installed extension.";
  if (!syncEnabled.value) return "Off. This computer's list stays here.";
  const { state, at } = syncStatus.value;
  switch (state) {
    case "update":
      return "Another computer has a newer Countdown. Update it here to keep syncing.";
    case "full":
      return "Chrome's sync space is full, so older completed items stay on this computer.";
    case "error":
      return "Couldn't sync just now. It'll try again.";
    case "syncing":
      return "Syncing…";
    default:
      return `Through Chrome sync, to computers signed in to the same Chrome profile.${at ? ` Up to date as of ${clockTime.format(at)}.` : ""}`;
  }
}

/** Whether reminders are on, in a line. */
function reminderHint(): string {
  if (remindersOn.value) return "Before deadlines and events, on this computer while Chrome is open. Any item can set its own in its editor.";
  if (remindersDenied.value) return "Chrome didn't allow notifications. Switch this on to ask again.";
  return "A notification before deadlines and events. Chrome asks first.";
}

/**
 * A palette's swatch in the current scheme: its gradient with a check in the
 * colour its buttons use for text. Clear is a solid surface ringed in its accent.
 */
function swatchStyle(p: Palette): Record<string, string> {
  const ld = (l: string, d: string) => `light-dark(${l}, ${d})`;
  if (p.solid) {
    const accent = ld(p.light.accent, p.dark.accent);
    return { background: ld("#ffffff", "#1d1f27"), color: accent, "--swatch-ring": accent };
  }
  const [l1, l2] = p.light.gradient;
  const [d1, d2] = p.dark.gradient;
  return {
    background: `linear-gradient(135deg, ${ld(l1, d1)}, ${ld(l2, d2)})`,
    color: ld(p.light.onAccent ?? "#ffffff", p.dark.onAccent ?? "#0d0f1a"),
  };
}

/**
 * The header's Appearance button and its menu: light/dark mode, colour
 * theme, whether the toolbar icon shows the time left, reminders and sync.
 * New settings go here too; when it outgrows a popover it becomes a bottom
 * sheet.
 */
export function AppearanceMenu() {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const reducedTransparency = matchMedia("(prefers-reduced-transparency: reduce)").matches;
  const { theme, palette } = shownAppearance.value;
  const { liveIcon, reminders } = prefs.value;

  const close = (returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLInputElement>("input:checked")?.focus();
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!menuRef.current?.contains(t) && !buttonRef.current?.contains(t)) close(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [open]);

  const modeLabel = (t: Theme) => (t === "system" ? `System (${systemDark.value ? "dark" : "light"})` : THEME_LABEL[t]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        class="icon-button"
        aria-label="Appearance"
        aria-haspopup="dialog"
        aria-expanded={open}
        data-tooltip="Appearance"
        data-tooltip-align="end"
        onClick={() => (open ? close(false) : setOpen(true))}
      >
        <Icon name="palette" />
      </button>
      {open && (
        <Popover
          anchor={buttonRef}
          align="end"
          popoverRef={menuRef}
          class="popover--appearance"
          role="dialog"
          aria-labelledby={`${id}-title`}
          onKeyDown={(e: KeyboardEvent) => {
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              close(true);
            }
          }}
        >
          <h2 id={`${id}-title`} class="appearance__title">
            Appearance
          </h2>

          <fieldset class="appearance__group">
            <legend class="field-label">Mode</legend>
            <div class="segmented segmented--three">
              {THEMES.map((t) => (
                <label key={t} class="segmented__option">
                  <input type="radio" name={`${id}-mode`} checked={theme === t} onChange={() => setAppearance({ theme: t })} />
                  <span>{modeLabel(t)}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset class="appearance__group">
            <legend class="field-label">
              Colour <span class="appearance__current">{paletteById(palette).name}</span>
            </legend>
            <div class="palette-swatches">
              {PALETTES.map((p) => (
                <label key={p.id} class="palette-swatch" data-tooltip={p.name}>
                  <input
                    type="radio"
                    name={`${id}-palette`}
                    class="visually-hidden"
                    aria-label={p.name}
                    checked={palette === p.id}
                    onChange={() => setAppearance({ palette: p.id as PaletteId })}
                  />
                  <span class="palette-swatch__dot" style={swatchStyle(p)}>
                    {palette === p.id && <Icon name="check" />}
                  </span>
                </label>
              ))}
            </div>
            {reducedTransparency && <p class="field-hint">Reduce transparency is on, so every colour uses solid surfaces.</p>}
          </fieldset>

          <div class="appearance__group appearance__switch-row">
            <label class="appearance__switch-label" for={`${id}-live`}>
              Time left on toolbar icon
            </label>
            {/* Chrome has no native switch yet: a checkbox with role="switch", styled as one. */}
            <input
              id={`${id}-live`}
              type="checkbox"
              role="switch"
              class="switch"
              aria-describedby={`${id}-live-hint`}
              checked={liveIcon}
              onChange={(e) => setPrefs({ liveIcon: e.currentTarget.checked })}
            />
            <p id={`${id}-live-hint`} class="field-hint">
              {liveIcon
                ? "The icon's sweep shrinks as your next item gets closer, with a short badge like 3d."
                : "The icon stays still, with no badge."}
            </p>
          </div>

          <div class="appearance__group appearance__switch-row">
            <label class="appearance__switch-label" for={`${id}-remind`}>
              Reminders
            </label>
            {/* Switching on asks Chrome for the notifications permission, so it runs straight from the click. */}
            <input
              id={`${id}-remind`}
              type="checkbox"
              role="switch"
              class="switch"
              aria-describedby={`${id}-remind-hint`}
              checked={remindersOn.value}
              onChange={(e) => setRemindersOn(e.currentTarget.checked)}
            />
            <p id={`${id}-remind-hint`} class="field-hint" aria-live="polite">
              {reminderHint()}
            </p>
            {remindersOn.value && (
              <div class="appearance__reminders">
                <span class="field-label" aria-hidden="true">
                  Deadlines
                </span>
                <ReminderField
                  value={reminders.due}
                  onChange={(v) => setPrefs({ reminders: { ...reminders, due: v ?? [] } })}
                  item={{ type: "due" }}
                  label="Remind me before deadlines"
                />
                <span class="field-label" aria-hidden="true">
                  Events
                </span>
                <ReminderField
                  value={reminders.starts}
                  onChange={(v) => setPrefs({ reminders: { ...reminders, starts: v ?? [] } })}
                  item={{ type: "starts" }}
                  label="Remind me before events"
                />
              </div>
            )}
          </div>

          <div class="appearance__group appearance__switch-row">
            <label class="appearance__switch-label" for={`${id}-sync`}>
              Sync with your other computers
            </label>
            <input
              id={`${id}-sync`}
              type="checkbox"
              role="switch"
              class="switch"
              aria-describedby={`${id}-sync-hint`}
              checked={syncSupported && syncEnabled.value}
              disabled={!syncSupported}
              onChange={(e) => setSyncEnabled(e.currentTarget.checked)}
            />
            <p id={`${id}-sync-hint`} class="field-hint" aria-live="polite">
              {syncHint()}
            </p>
            {syncSupported && backupAt.value !== null && (
              <button type="button" class="button button--quiet appearance__restore" onClick={() => void restoreBackup()}>
                Restore this computer's list from before sync
              </button>
            )}
          </div>
        </Popover>
      )}
    </>
  );
}
