import { choicesFor, cleanReminders, describeReminders, fitReminder, reminderLabel, type Kind } from "../lib/reminders";
import { remindersDenied, remindersOn, setRemindersOn } from "../state/reminders";
import { Icon } from "./Icon";

interface Props {
  /** Undefined: the fallback (the defaults); empty: none. */
  value: number[] | undefined;
  onChange: (value: number[] | undefined) => void;
  item: Kind;
  /** What "Default" stands for. Without it there's no Default choice (the defaults themselves). */
  fallback?: readonly number[];
  label?: string;
  /** Offer to turn reminders on when they're off on this computer. */
  offerTurnOn?: boolean;
}

/**
 * "Remind me" as one select, and a second once the first is set, like
 * Apple Calendar's Alert and Second Alert. The choices fit the item: whole
 * days at 9 AM for all-day items.
 */
export function ReminderField({ value, onChange, item, fallback, label = "Remind me", offerTurnOn = false }: Props) {
  // In the order chosen (scheduling doesn't mind), shown the way they apply to this item.
  const valid = new Set(cleanReminders(value));
  const list = Array.isArray(value) ? [...new Set(value.filter((m) => valid.has(m)).map((m) => fitReminder(m, item)))] : undefined;
  const [first, second] = list ?? [];
  const choices = (taken?: number) => {
    const all = new Set([...choicesFor(item), ...(list ?? [])]);
    return [...all].filter((m) => m !== taken).sort((a, b) => a - b);
  };

  return (
    <div class="reminder-field">
      <div class="reminder-field__selects">
        <div class="select-field">
          <Icon name="bell" />
          <select
            aria-label={label}
            value={list === undefined ? "default" : first === undefined ? "none" : String(first)}
            onChange={(e) => {
              const v = e.currentTarget.value;
              onChange(v === "default" ? undefined : v === "none" ? [] : [Number(v), ...(second !== undefined && second !== Number(v) ? [second] : [])]);
            }}
          >
            {fallback && <option value="default">Default: {describeReminders(fallback, item)}</option>}
            <option value="none">No reminder</option>
            {choices().map((m) => (
              <option key={m} value={m}>
                {reminderLabel(m, item)}
              </option>
            ))}
          </select>
          <Icon name="chevronDown" />
        </div>
        {first !== undefined && (
          <div class="select-field select-field--compact">
            <select
              aria-label={`${label}, second reminder`}
              value={second === undefined ? "none" : String(second)}
              onChange={(e) => {
                const v = e.currentTarget.value;
                onChange(v === "none" ? [first] : [first, Number(v)]);
              }}
            >
              <option value="none">No second reminder</option>
              {choices(first).map((m) => (
                <option key={m} value={m}>
                  {reminderLabel(m, item)}
                </option>
              ))}
            </select>
            <Icon name="chevronDown" />
          </div>
        )}
      </div>
      {offerTurnOn && !remindersOn.value && (list === undefined || list.length > 0) && (
        <p class="field-hint reminder-field__off">
          {remindersDenied.value ? "Chrome didn't allow notifications for Countdown." : "Reminders are off on this computer."}
          <button type="button" class="button button--quiet reminder-field__turn-on" onClick={() => setRemindersOn(true)}>
            Turn on
          </button>
        </p>
      )}
    </div>
  );
}
