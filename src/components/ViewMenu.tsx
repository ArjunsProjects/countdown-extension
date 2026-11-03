import { useEffect, useRef, useState } from "preact/hooks";
import { inTab, openInTab, setView, shownView, wide, type View } from "../state/calendar";
import { Icon } from "./Icon";
import { Popover } from "./Popover";

const OPTIONS: { view: View; label: string; wideOnly?: boolean }[] = [
  { view: "list", label: "List" },
  { view: "day", label: "Day" },
  { view: "days3", label: "3 days" },
  { view: "week", label: "Week", wideOnly: true },
  { view: "month", label: "Month" },
];

export const VIEW_LABEL: Record<View, string> = { list: "List", day: "Day", days3: "3 days", week: "Week", month: "Month" };

/** How long a checked item shows its new check mark before the menu closes. */
const CHECK_MS = 300;

/**
 * The header's View button: the list or a calendar view, and opening the
 * calendar in a tab. Week needs room, so it's offered only when the page is
 * wide (the tab, or a side panel dragged wider).
 *
 * Keyboard follows menu-button conventions: Enter, Space or ArrowDown on the
 * button opens the menu with focus on the current view; a pointer opens it
 * leaving focus on the button. Arrows, Home and End move; Escape closes and
 * returns focus; Tab leaves.
 */
export function ViewMenu({ disabled }: { disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const enter = useRef(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const current = shownView.value;

  const close = (restore: boolean, fromPointer = false) => {
    setOpen(false);
    // No focus ring after a pointer choice; keyboard users keep theirs.
    if (restore) buttonRef.current?.focus({ focusVisible: !fromPointer } as FocusOptions);
  };

  useEffect(() => {
    if (!open) return;
    if (enter.current) menuRef.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
    const outside = (e: Event) => {
      const t = e.target as Node;
      if (!menuRef.current?.contains(t) && !buttonRef.current?.contains(t)) close(false);
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("focusin", outside);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("focusin", outside);
    };
  }, [open]);

  const openWith = (keyboard: boolean) => {
    enter.current = keyboard;
    setOpen(true);
  };

  const onMenuKey = (e: KeyboardEvent) => {
    const items = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const go = (i: number) => {
      e.preventDefault();
      items[(i + items.length) % items.length]?.focus();
    };
    if (e.key === "ArrowDown") go(at + 1);
    else if (e.key === "ArrowUp") go(at - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(items.length - 1);
    else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close(true);
    } else if (e.key === "Tab") close(false);
  };

  const choose = (v: View, e: MouseEvent) => {
    setView(v);
    const fromPointer = e.detail !== 0;
    setTimeout(() => close(true, fromPointer), CHECK_MS);
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        class="icon-button"
        aria-label={`View: ${VIEW_LABEL[current]}`}
        aria-haspopup="menu"
        aria-expanded={open}
        data-tooltip="View"
        disabled={disabled}
        onClick={(e) => (open ? close(false) : openWith(e.detail === 0))}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            openWith(true);
          }
        }}
      >
        <Icon name={current === "list" ? "list" : "calendar"} />
      </button>
      {open && (
        <Popover anchor={buttonRef} align="end" popoverRef={menuRef} class="popover--menu" role="menu" aria-label="View" onKeyDown={onMenuKey}>
          <div role="group" aria-label="Show as" class="menu-group">
            {OPTIONS.filter((o) => !o.wideOnly || wide.value).map((o) => (
              <button
                key={o.view}
                type="button"
                role="menuitemradio"
                aria-checked={current === o.view}
                class="menu-item menu-item--check"
                onClick={(e) => choose(o.view, e)}
              >
                {o.label}
              </button>
            ))}
          </div>
          {!inTab && (
            <>
              <div class="menu-separator" role="separator" />
              <button
                type="button"
                role="menuitem"
                class="menu-item"
                onClick={(e) => {
                  close(true, e.detail !== 0);
                  openInTab();
                }}
              >
                <Icon name="externalLink" />
                Open calendar in a tab
              </button>
            </>
          )}
        </Popover>
      )}
    </>
  );
}
