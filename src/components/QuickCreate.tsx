import { useEffect, useId, useLayoutEffect, useRef, useState } from "preact/hooks";
import { formatWhen } from "../lib/events";
import { newItem } from "../lib/items";
import { toLocalISO } from "../lib/dates";
import type { Item, ItemType } from "../lib/types";
import { categoryOf, hiddenCategories } from "../state/calendar";
import { addFromCalendar, categories, updateCategory } from "../state/store";
import { editing } from "../state/ui";
import { CategoryField } from "./CategoryField";
import { Popover } from "./Popover";
import { TypeToggle } from "./TypeToggle";

interface Props {
  start: Date;
  end: Date;
  anchor: { current: HTMLElement | null };
  onClose: () => void;
}

/**
 * A small popover for adding an item where you clicked (or dragged) on the
 * calendar: title, Due/Starts, category, and Save. More options opens the
 * full editor with the same details.
 */
export function QuickCreate({ start, end, anchor, onClose }: Props) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [type, setType] = useState<ItemType>("starts");
  // A new item lands where it can be seen: no category, unless that's hidden on the calendar.
  const [categoryId, setCategoryId] = useState<string | null>(() =>
    hiddenCategories.value.has("none") ? (categories.value.find((c) => !hiddenCategories.value.has(c.id))?.id ?? null) : null,
  );
  const [error, setError] = useState(false);

  const draft = (): Item => {
    const item = newItem(new Date());
    item.title = title.trim();
    item.type = type;
    item.dateTime = toLocalISO(start);
    if (type === "starts") item.endDateTime = toLocalISO(end);
    if (categoryId && categoryOf(categoryId)) item.categoryId = categoryId;
    return item;
  };

  const save = () => {
    // Read the live value: state can lag a render behind fast typing + Enter.
    const text = (inputRef.current?.value ?? title).trim();
    if (!text) {
      setError(true);
      inputRef.current?.focus();
      return;
    }
    const item = addFromCalendar({ title: text, type, start, end: type === "starts" ? end : null, categoryId });
    onClose();
    // Land on the new event, where it's now drawn.
    setTimeout(() => document.querySelector<HTMLElement>(`[data-event-id="${CSS.escape(item.id)}"]`)?.focus());
  };

  useLayoutEffect(() => {
    inputRef.current?.focus();
  }, []);

  // A click anywhere else closes it without adding anything.
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, []);

  return (
    <Popover
      anchor={anchor}
      align="start"
      popoverRef={ref}
      class="popover--quick"
      role="dialog"
      aria-labelledby={`${id}-title`}
      onKeyDown={(e: KeyboardEvent) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <h2 id={`${id}-title`} class="visually-hidden">
        New item
      </h2>
      <input
        ref={inputRef}
        class={`text-input quick-create__title${error ? " text-input--invalid" : ""}`}
        aria-label="Title"
        aria-invalid={error}
        aria-describedby={error ? `${id}-error` : undefined}
        placeholder="What's coming up?"
        maxLength={200}
        enterKeyHint="done"
        value={title}
        onInput={(e) => {
          setTitle(e.currentTarget.value);
          if (error) setError(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.isComposing) {
            e.preventDefault();
            save();
          }
        }}
      />
      {error && (
        <p id={`${id}-error`} class="field-error" role="alert">
          Add a title
        </p>
      )}
      <p class="quick-create__when">{formatWhen({ type, dateTime: toLocalISO(start), endDateTime: type === "starts" ? toLocalISO(end) : undefined })}</p>
      <TypeToggle value={type} onChange={setType} />
      {categories.value.length > 0 && <CategoryField value={categoryId} onChange={setCategoryId} />}
      <div class="quick-create__actions">
        <button
          type="button"
          class="button button--quiet"
          onClick={() => {
            const item = draft();
            onClose();
            // The editor opens in the list, inside its category: make sure that's open.
            const c = categoryOf(item.categoryId);
            if (c?.collapsed) updateCategory(c.id, { collapsed: false });
            editing.value = { kind: "new", draft: item };
          }}
        >
          More options
        </button>
        <button type="button" class="button button--primary" onClick={save}>
          Save
        </button>
      </div>
    </Popover>
  );
}
