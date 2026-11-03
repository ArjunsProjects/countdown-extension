import type { ComponentChildren } from "preact";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "preact/hooks";
import { CATEGORY_COLORS, COLOR_NAMES, MAX_CATEGORY_NAME, type Category } from "../lib/categories";
import { relativeLabel } from "../lib/countdown";
import type { Row } from "../lib/types";
import { drag, startDragOnPress } from "../state/drag";
import { categories, moveCategory, removeCategory, updateCategory } from "../state/store";
import { editingCategory } from "../state/ui";
import { Icon } from "./Icon";
import { Popover } from "./Popover";

interface Props {
  /** null: the "Other" section for items without a category. */
  category: Category | null;
  rows: Row[];
  now: number;
  onNewItem: (categoryId: string | null) => void;
  /** Render the list even when empty (e.g. a new item is being added here). */
  showList?: boolean;
  children: ComponentChildren;
}

const headOf = (row: Row) => (row.kind === "single" ? row.item : row.items[0]!);

/**
 * One category's section: a header (color, name, count, collapse, add, menu)
 * that can be dragged to reorder categories, and its rows. The whole section
 * is a drop target for tiles dragged from elsewhere.
 */
export function CategorySection({ category, rows, now, onNewItem, showList = false, children }: Props) {
  const headingId = useId();
  const listId = useId();
  const menuRef = useRef<HTMLButtonElement>(null);
  const d = drag.value;
  const dropKey = category?.id ?? "none";
  const isTarget = d !== null && d.subject.kind !== "category" && d.overCategory === dropKey;
  const index = category ? categories.value.findIndex((c) => c.id === category.id) : -1;
  const insertBefore = d?.subject.kind === "category" && d.insertAt === index && d.subject.id !== category?.id;
  const insertAfterLast =
    d?.subject.kind === "category" && category !== null && index === categories.value.length - 1 && d.insertAt === categories.value.length;
  const collapsed = category?.collapsed ?? false;
  const next = rows[0] ? headOf(rows[0]) : undefined;
  const count = rows.length;

  const classes = [
    "category",
    category ? `category--${category.color}` : "category--none",
    isTarget && "category--drop-target",
    insertBefore && "category--insert-before",
    insertAfterLast && "category--insert-after",
    d?.subject.kind === "category" && d.subject.id === category?.id && "category--dragging",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <section class={classes} data-drop-category={dropKey} aria-labelledby={headingId}>
      <div
        class="category__head"
        data-category-head={category ? "" : undefined}
        onPointerDown={(e) => {
          // Dragging a category's header reorders categories (not "Other").
          if (!category || (e.target as Element).closest("input, .category__actions")) return;
          startDragOnPress(e, {
            subject: () => ({ kind: "category", id: category.id, title: category.name, color: category.color }),
            onDrop: (s) => {
              if (s.insertAt === null) return;
              const from = categories.value.findIndex((c) => c.id === category.id);
              moveCategory(category.id, s.insertAt > from ? s.insertAt - 1 : s.insertAt);
            },
          });
        }}
      >
        <h2 class="category__title-wrap">
          <button
            type="button"
            id={headingId}
            class="category__toggle"
            aria-expanded={!collapsed}
            aria-controls={listId}
            disabled={!category}
            onClick={() => category && updateCategory(category.id, { collapsed: !collapsed })}
          >
            {category && <Icon name="chevronDown" />}
            <span class="category__dot" aria-hidden="true" />
            <span class="category__name">{category ? category.name : "Other"}</span>
            <span class="category__count">{count}</span>
            {collapsed && next && (
              <span class="category__summary">· next {relativeLabel(Date.parse(next.dateTime), now)}</span>
            )}
          </button>
        </h2>
        <div class="category__actions">
          <button
            type="button"
            class="icon-button icon-button--sm"
            aria-label={category ? `New item in ${category.name}` : "New item"}
            data-tooltip={category ? `New item in ${category.name}` : "New item"}
            onClick={() => onNewItem(category?.id ?? null)}
          >
            <Icon name="plus" />
          </button>
          {category && (
            <button
              ref={menuRef}
              type="button"
              class="icon-button icon-button--sm"
              aria-label={`${category.name} options`}
              aria-haspopup="dialog"
              aria-expanded={editingCategory.value === category.id}
              data-tooltip="Rename, color, order"
              data-tooltip-align="end"
              onClick={() => (editingCategory.value = editingCategory.value === category.id ? null : category.id)}
            >
              <Icon name="more" />
            </button>
          )}
        </div>
        {category && editingCategory.value === category.id && <CategoryEditor category={category} anchor={menuRef} />}
      </div>

      {!collapsed && (
        <div id={listId}>
          {count === 0 && !showList ? (
            <p class="category__empty">Drag items here, or use + to add one.</p>
          ) : (
            <ul role="list" class="list list--flush">
              {children}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

/** Popover to rename, recolor, reorder or delete a category. */
function CategoryEditor({ category, anchor }: { category: Category; anchor: { current: HTMLButtonElement | null } }) {
  const [name, setName] = useState(category.name);
  const nameId = useId();
  const ref = useRef<HTMLDivElement>(null);
  const index = categories.value.findIndex((c) => c.id === category.id);
  const last = categories.value.length - 1;

  const inputRef = useRef<HTMLInputElement>(null);
  const close = (returnFocus = true) => {
    // The live value: state can lag a render behind fast typing + Enter.
    const n = (inputRef.current?.value ?? name).trim();
    if (n && n !== category.name) updateCategory(category.id, { name: n });
    editingCategory.value = null;
    if (returnFocus) setTimeout(() => anchor.current?.focus());
  };

  // Focus the name once the popover is showing (autofocus fires while it's still hidden).
  useLayoutEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  // A click anywhere else closes it (the menu button toggles it itself).
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !anchor.current?.contains(t)) close(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, []);

  return (
    <Popover
      anchor={anchor}
      align="end"
      popoverRef={ref}
      class="popover--category"
      role="dialog"
      aria-label={`${category.name} options`}
      onKeyDown={(e: KeyboardEvent) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          close();
        }
      }}
    >
      <label for={nameId} class="field-label">
        Name
      </label>
      <input
        ref={inputRef}
        id={nameId}
        class="text-input"
        maxLength={MAX_CATEGORY_NAME}
        value={name}
        onInput={(e) => setName(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.isComposing) {
            e.preventDefault();
            close();
          }
        }}
      />

      <p class="field-label category-editor__label" id={`${nameId}-colors`}>
        Color
      </p>
      <div class="swatches" role="radiogroup" aria-labelledby={`${nameId}-colors`}>
        {CATEGORY_COLORS.map((color) => (
          <button
            key={color}
            type="button"
            role="radio"
            aria-checked={category.color === color}
            aria-label={COLOR_NAMES[color]}
            class={`swatch category--${color}`}
            onClick={() => updateCategory(category.id, { color })}
          >
            {category.color === color && <Icon name="check" />}
          </button>
        ))}
      </div>

      <div class="category-editor__row">
        <button type="button" class="button button--subtle" disabled={index <= 0} onClick={() => moveCategory(category.id, index - 1)}>
          Move up
        </button>
        <button type="button" class="button button--subtle" disabled={index >= last} onClick={() => moveCategory(category.id, index + 1)}>
          Move down
        </button>
      </div>
      <button
        type="button"
        class="button button--danger-quiet category-editor__delete"
        onClick={() => {
          editingCategory.value = null;
          removeCategory(category.id);
          // Keep keyboard focus nearby: the category that took its place, else the one above.
          setTimeout(() => {
            const toggles = [...document.querySelectorAll<HTMLButtonElement>(".category__toggle:not(:disabled)")];
            (toggles[index] ?? toggles[index - 1] ?? document.querySelector<HTMLElement>(".add-menu__toggle"))?.focus();
          }, 0);
        }}
      >
        <Icon name="trash" />
        Delete category
      </button>
      <p class="field-hint">Items in it move to Other. You can undo.</p>
    </Popover>
  );
}
