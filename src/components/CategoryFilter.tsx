import { useEffect, useId, useRef, useState } from "preact/hooks";
import { hiddenCategories, setCategoryShown } from "../state/calendar";
import { categories } from "../state/store";
import { Checkbox } from "./Checkbox";
import { Icon } from "./Icon";
import { Popover } from "./Popover";

/**
 * Show or hide each category on the calendar, like a calendar app's list of
 * calendars. The list view is unaffected (categories collapse there instead).
 */
export function CategoryFilter() {
  const [open, setOpen] = useState(false);
  const id = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const ref = useRef<HTMLDivElement>(null);
  const hidden = hiddenCategories.value;
  const hiddenCount = [...categories.value.map((c) => c.id), "none"].filter((k) => hidden.has(k)).length;

  const close = (restore: boolean) => {
    setOpen(false);
    if (restore) buttonRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    ref.current?.querySelector<HTMLInputElement>("input")?.focus();
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !buttonRef.current?.contains(t)) close(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        class={`icon-button calendar-toolbar__filter${hiddenCount ? " calendar-toolbar__filter--active" : ""}`}
        aria-label={hiddenCount ? `Categories shown: ${hiddenCount} hidden` : "Categories shown: all"}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-tooltip="Categories"
        data-tooltip-align="end"
        onClick={() => (open ? close(false) : setOpen(true))}
      >
        <Icon name="filter" />
      </button>
      {open && (
        <Popover
          anchor={buttonRef}
          align="end"
          popoverRef={ref}
          class="popover--filter"
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
          <h2 id={`${id}-title`} class="filter__title">
            Show on calendar
          </h2>
          <ul role="list" class="filter__list">
            {categories.value.map((c) => (
              <li key={c.id} class={`filter__row category--${c.color}`}>
                <span class="category__dot" aria-hidden="true" />
                <Checkbox checked={!hidden.has(c.id)} onChange={(on) => setCategoryShown(c.id, on)} label={c.name} />
              </li>
            ))}
            <li class="filter__row">
              <span class="category__dot" aria-hidden="true" />
              <Checkbox checked={!hidden.has("none")} onChange={(on) => setCategoryShown("none", on)} label="Other" />
            </li>
          </ul>
        </Popover>
      )}
    </>
  );
}
