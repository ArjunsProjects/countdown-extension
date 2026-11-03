import { useEffect, useId, useLayoutEffect, useRef } from "preact/hooks";
import type { CalEvent } from "../lib/agenda";
import { describeRemaining, relativeLabel } from "../lib/countdown";
import { formatShortDateTime } from "../lib/dates";
import { endOf, finishOf, formatWhen, phaseOf } from "../lib/events";
import { describeEnd, describeRule } from "../lib/recurrence";
import { completeItem, items, prefs, series, setPrefs, uncompleteItem, updateCategory } from "../state/store";
import { categoryOf } from "../state/calendar";
import { editing } from "../state/ui";
import { Icon } from "./Icon";
import { IconButton } from "./IconButton";
import { Popover } from "./Popover";

interface Props {
  event: CalEvent;
  anchor: HTMLElement;
  now: number;
  onClose: (restoreFocus: boolean) => void;
}

/** "Starts in 8 days", "Happening now · ends in 40 minutes", "Ended", "Completed Mon 2 Nov, 3:00 PM"… */
function statusOf({ item }: CalEvent, now: number): string {
  if (item.completedAt) return `Completed ${formatShortDateTime(new Date(item.completedAt), false, new Date(now))}`;
  const phase = phaseOf(item, now);
  if (phase === "upcoming") return `${item.type === "due" ? "Due" : "Starts"} ${relativeLabel(Date.parse(item.dateTime), now)}`;
  if (phase === "now") return `Happening now · ends in ${describeRemaining(endOf(item)!, now)}`;
  return item.type === "due" ? "Overdue" : endOf(item) === null ? "Started" : "Ended";
}

/**
 * Opens an item's editor in the list (the calendar comes back when it
 * closes). Makes sure its row is on screen first: a collapsed category or
 * Overdue section would otherwise hide the editor.
 */
function edit({ item, virtual }: CalEvent) {
  if (virtual) {
    // A later occurrence: edit the series it comes from.
    const upcoming = items.value.filter((i) => i.seriesId === item.seriesId && !i.completedAt && finishOf(i) > Date.now());
    if (upcoming.length >= 2) editing.value = { kind: "series", seriesId: item.seriesId! };
    else if (upcoming[0]) editing.value = { kind: "item", id: upcoming[0].id };
    return;
  }
  const c = categoryOf(item.categoryId);
  if (c?.collapsed) updateCategory(c.id, { collapsed: false });
  if (finishOf(item) <= Date.now() && prefs.value.overdueCollapsed) setPrefs({ overdueCollapsed: false });
  editing.value = { kind: "item", id: item.id };
}

/** Details of an event opened from the calendar, with Edit and Complete. */
export function EventDetails({ event, anchor, now, onClose }: Props) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<HTMLElement | null>(anchor);
  anchorRef.current = anchor;
  const { item, virtual } = event;
  const cat = categoryOf(item.categoryId);
  const owner = item.seriesId ? series.value.find((s) => s.id === item.seriesId) : undefined;
  const repeat = owner ? [describeRule(owner.rule, new Date(owner.start)), describeEnd(owner.end)].filter(Boolean).join(" · ") : null;
  const canEdit = !item.completedAt && (!virtual || items.value.some((i) => i.seriesId === item.seriesId && !i.completedAt && finishOf(i) > now));

  useLayoutEffect(() => {
    ref.current?.querySelector<HTMLElement>(".event-details__actions button, .icon-button")?.focus();
  }, [event.id]);

  // A click anywhere else closes it.
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !anchor.contains(t)) onClose(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [anchor]);

  return (
    <Popover
      anchor={anchorRef}
      align="start"
      popoverRef={ref}
      class="popover--event"
      role="dialog"
      aria-labelledby={`${id}-title`}
      onKeyDown={(e: KeyboardEvent) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onClose(true);
        }
      }}
    >
      <div class="event-details__head">
        <span class={`tag tag--${item.type}`}>{item.type === "due" ? "Due" : "Starts"}</span>
        {cat && (
          <span class={`event-details__category category--${cat.color}`}>
            <span class="category__dot" aria-hidden="true" />
            {cat.name}
          </span>
        )}
        <IconButton icon="close" label="Close" onClick={() => onClose(true)} tooltipAlign="end" />
      </div>
      <h2 id={`${id}-title`} class="event-details__title">
        {item.title}
      </h2>
      <p class="event-details__when">{formatWhen(item)}</p>
      <p class="event-details__status">{statusOf(event, now)}</p>
      {item.location && (
        <p class="event-details__line">
          <Icon name="pin" />
          {item.location}
        </p>
      )}
      {repeat && (
        <p class="event-details__line">
          <Icon name="repeat" />
          {repeat}
        </p>
      )}
      {item.notes && <p class="event-details__notes">{item.notes}</p>}
      <div class="event-details__actions">
        {item.completedAt ? (
          <button type="button" class="button button--quiet" onClick={() => uncompleteItem(item.id)}>
            <Icon name="undo" />
            Mark as not done
          </button>
        ) : (
          !virtual && (
            <button type="button" class="button button--quiet" onClick={() => completeItem(item.id)}>
              <Icon name="check" />
              Complete
            </button>
          )
        )}
        {canEdit && (
          <button
            type="button"
            class="button button--secondary"
            onClick={() => {
              onClose(false);
              edit(event);
            }}
          >
            <Icon name="edit" />
            {virtual ? "Edit series" : "Edit"}
          </button>
        )}
      </div>
    </Popover>
  );
}
