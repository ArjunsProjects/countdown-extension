import { useEffect, useId, useLayoutEffect, useRef, useState } from "preact/hooks";
import { formatTime, nearestTimeOption, parseTime, TIME_OPTIONS, type TimeParts } from "../lib/parse";
import { Icon } from "./Icon";
import { Popover } from "./Popover";

interface Props {
  /** null means all-day. */
  value: TimeParts | null;
  onChange: (value: TimeParts | null) => void;
  /** Accessible name (default "Time"). */
  label?: string;
  /** Placeholder when empty (default "All day"). */
  placeholder?: string;
}

const TIME_ERROR = "Try a time like 3pm or 15:00";
const DEFAULT_ACTIVE = nearestTimeOption({ hour: 9, minute: 0 });

/**
 * Editable combobox: type any time ("3pm", "15:00", "noon") or pick from a
 * 15-minute list. Clearing the field makes the item all-day.
 */
export function TimeField({ value, onChange, label = "Time", placeholder = "All day" }: Props) {
  const [text, setText] = useState(value ? formatTime(value) : "");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<number>(value ? nearestTimeOption(value) : DEFAULT_ACTIVE);
  const [navigated, setNavigated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const fieldRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const ids = { list: useId(), error: useId(), option: useId() };

  // Reflect outside changes (e.g. undo) when not mid-edit.
  useEffect(() => {
    if (!open) setText(value ? formatTime(value) : "");
  }, [value?.hour, value?.minute, value === null]);

  // Keep the active option visible by scrolling the list itself (not the page).
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!open || !list) return;
    const option = list.querySelector<HTMLElement>(`#${CSS.escape(`${ids.option}-${active}`)}`);
    if (!option) return;
    if (!navigated) {
      list.scrollTop = option.offsetTop - (list.clientHeight - option.offsetHeight) / 2;
    } else if (option.offsetTop < list.scrollTop) {
      list.scrollTop = option.offsetTop;
    } else if (option.offsetTop + option.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = option.offsetTop + option.offsetHeight - list.clientHeight;
    }
  }, [open, active]);

  const show = () => {
    if (open) return;
    setActive(value ? nearestTimeOption(value) : DEFAULT_ACTIVE);
    setNavigated(false);
    setOpen(true);
  };

  const choose = (t: TimeParts) => {
    onChange(t);
    setText(formatTime(t));
    setError(null);
    setOpen(false);
  };

  const commitText = () => {
    // Read the live input value: state may lag a render behind fast typing.
    const t = (inputRef.current?.value ?? text).trim();
    if (!t) {
      onChange(null);
      setError(null);
    } else {
      const parsed = parseTime(t);
      if (parsed) choose(parsed);
      else setError(TIME_ERROR);
    }
    setOpen(false);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    switch (e.key) {
      case "ArrowDown":
      case "ArrowUp": {
        e.preventDefault();
        if (!open) return show();
        const delta = e.key === "ArrowDown" ? 1 : -1;
        setActive((i) => Math.min(Math.max(i + delta, 0), TIME_OPTIONS.length - 1));
        setNavigated(true);
        return;
      }
      case "Enter":
        e.preventDefault();
        // Confirming Japanese, Chinese or Korean input, not choosing a time.
        if (e.isComposing) return;
        if (open && navigated) choose(TIME_OPTIONS[active]!);
        else commitText();
        return;
      case "Escape":
        if (!open) return; // let the editor close
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
        setText(value ? formatTime(value) : "");
        setError(null);
        return;
    }
  };

  return (
    <div class="time-field">
      <div ref={fieldRef} class={`field-button field-button--input${error ? " field-button--invalid" : ""}`}>
        <Icon name="clock" />
        <input
          ref={inputRef}
          class="time-field__input"
          role="combobox"
          aria-label={label}
          aria-expanded={open}
          aria-controls={ids.list}
          aria-autocomplete="none"
          aria-activedescendant={open ? `${ids.option}-${active}` : undefined}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? ids.error : undefined}
          autoComplete="off"
          placeholder={placeholder}
          value={text}
          onFocus={show}
          onClick={show}
          onBlur={commitText}
          onKeyDown={onKeyDown}
          onInput={(e) => {
            const next = e.currentTarget.value;
            setText(next);
            setError(null);
            if (!open) show();
            const parsed = parseTime(next);
            if (parsed) {
              setActive(nearestTimeOption(parsed));
              setNavigated(false);
            }
          }}
        />
      </div>
      {open && (
        <Popover anchor={fieldRef} matchWidth class="popover--list">
        <ul ref={listRef} id={ids.list} class="listbox" role="listbox" aria-label="Times">
          {TIME_OPTIONS.map((t, i) => (
            <li
              key={i}
              id={`${ids.option}-${i}`}
              role="option"
              aria-selected={value !== null && value.hour === t.hour && value.minute === t.minute}
              class={`option${i === active ? " option--active" : ""}`}
              // Keep focus in the input so blur doesn't fire before the click.
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => choose(t)}
            >
              {formatTime(t)}
            </li>
          ))}
        </ul>
        </Popover>
      )}
      {error && (
        <p id={ids.error} class="field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
