import { signal } from "@preact/signals";
import type { CategoryColor } from "../lib/categories";

// Pointer-based drag and drop for moving items into categories and
// reordering categories. A press only becomes a drag after the pointer moves
// a few pixels, so a plain click still opens the item. Keyboard users get the
// same results from the Category field in editors and Move up/down in a
// category's menu.

export type DragSubject =
  | { kind: "item" | "series"; id: string; title: string; color?: CategoryColor }
  | { kind: "category"; id: string; title: string; color: CategoryColor };

export interface DragState {
  subject: DragSubject;
  x: number;
  y: number;
  /** Item drags: the category under the pointer ("none" = Other), if any. */
  overCategory: string | null;
  /** Category drags: index the category would move to. */
  insertAt: number | null;
}

export const drag = signal<DragState | null>(null);

const THRESHOLD = 6;
const EDGE = 48;
/** Auto-scroll speed near an edge, in pixels per second. */
const SCROLL_SPEED = 840;

interface PressOptions {
  /** Scrolled while the pointer rests near its top or bottom edge (the page if not given). */
  scroller?: HTMLElement | null;
  /** The cursor while dragging (grabbing if not given). */
  cursor?: string;
  /** The pointer moved during a drag, or the view scrolled under it. */
  onDrag: (x: number, y: number) => void;
  /** Released; `dragged` is false for a plain click. */
  onRelease: (dragged: boolean, x: number, y: number) => void;
  /** Escape, or the browser took the pointer over. */
  onCancel?: () => void;
}

/**
 * Follows a press until it's released. It becomes a drag only after the
 * pointer moves a few pixels, so a plain click still clicks. While dragging,
 * text can't be selected, the view scrolls near its edges, Escape cancels,
 * and the click that would end the drag is swallowed. Touch is left to
 * scrolling. Listeners sit on the window, since what's under the pointer
 * re-renders as it moves.
 */
export function trackPress(e: PointerEvent, { scroller, cursor, onDrag, onRelease, onCancel }: PressOptions) {
  if (e.button !== 0 || e.pointerType === "touch") return;
  const startX = e.clientX;
  const startY = e.clientY;
  let x = startX;
  let y = startY;
  let active = false;
  let frame = 0;
  let last = 0;

  const autoScroll = (time: number) => {
    const dt = Math.min(time - (last || time), 50) / 1000;
    last = time;
    const r = scroller?.getBoundingClientRect() ?? { top: 0, bottom: innerHeight };
    const dir = y < r.top + EDGE ? -1 : y > r.bottom - EDGE ? 1 : 0;
    if (dir && dt) {
      (scroller ?? document.scrollingElement)?.scrollBy({ top: dir * SCROLL_SPEED * dt, behavior: "instant" });
      onDrag(x, y);
    }
    frame = requestAnimationFrame(autoScroll);
  };

  const onMove = (ev: PointerEvent) => {
    x = ev.clientX;
    y = ev.clientY;
    if (!active) {
      if (Math.hypot(x - startX, y - startY) < THRESHOLD) return;
      active = true;
      document.body.classList.add("is-dragging");
      if (cursor) document.body.style.setProperty("--drag-cursor", cursor);
      frame = requestAnimationFrame(autoScroll);
    }
    ev.preventDefault();
    onDrag(x, y);
  };

  // The release would otherwise "click" whatever was dragged.
  const swallowClick = () => {
    const swallow = (ce: MouseEvent) => {
      ce.stopPropagation();
      ce.preventDefault();
    };
    addEventListener("click", swallow, { capture: true, once: true });
    setTimeout(() => removeEventListener("click", swallow, { capture: true }), 0);
  };

  const finish = (released: boolean) => {
    removeEventListener("pointermove", onMove);
    removeEventListener("pointerup", onUp);
    removeEventListener("pointercancel", onLost);
    removeEventListener("keydown", onKey, true);
    cancelAnimationFrame(frame);
    document.body.classList.remove("is-dragging");
    document.body.style.removeProperty("--drag-cursor");
    if (released) {
      if (active) swallowClick();
      onRelease(active, x, y);
    } else {
      onCancel?.();
    }
  };
  const onUp = () => finish(true);
  const onLost = () => finish(false);
  const onKey = (ev: KeyboardEvent) => {
    if (ev.key !== "Escape" || !active) return;
    ev.preventDefault();
    ev.stopPropagation();
    // The button is still down: its release mustn't click either.
    addEventListener("pointerup", swallowClick, { capture: true, once: true });
    finish(false);
  };

  addEventListener("pointermove", onMove);
  addEventListener("pointerup", onUp);
  addEventListener("pointercancel", onLost);
  addEventListener("keydown", onKey, true);
}

interface Options {
  subject: () => DragSubject;
  /** Called on release over a valid target. */
  onDrop: (state: DragState) => void;
}

/** Drags an item onto a category, or a category to a new place. */
export function startDragOnPress(e: PointerEvent, { subject, onDrop }: Options) {
  const locate = (x: number, y: number): Pick<DragState, "overCategory" | "insertAt"> => {
    const s = drag.value?.subject ?? subject();
    if (s.kind === "category") {
      // Insert before the first category header whose middle is below the pointer.
      const heads = [...document.querySelectorAll<HTMLElement>("[data-category-head]")];
      let index = heads.length;
      for (let i = 0; i < heads.length; i++) {
        const r = heads[i]!.getBoundingClientRect();
        if (y < r.top + r.height / 2) {
          index = i;
          break;
        }
      }
      return { overCategory: null, insertAt: index };
    }
    const target = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-drop-category]");
    return { overCategory: target?.dataset.dropCategory ?? null, insertAt: null };
  };

  trackPress(e, {
    onDrag: (x, y) => {
      drag.value = { subject: drag.value?.subject ?? subject(), x, y, ...locate(x, y) };
    },
    onRelease: (dragged) => {
      const state = drag.value;
      drag.value = null;
      if (dragged && state) onDrop(state);
    },
    onCancel: () => {
      drag.value = null;
    },
  });
}
