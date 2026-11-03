import { useId, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import { allDayLanes, eventsInRange, layoutDay, onDay, rangeLabel, rangeLabelShort, segmentsForDay, viewDays, type CalEvent, type CalendarView as ViewName, type Placed, type Segment } from "../lib/agenda";
import { minutesOfDay, moveBy, newRange, pointerMinutes, resizeEnd, SNAP, type Reschedule } from "../lib/gridEdit";
import { formatFullDay, sameDay, toDateParts } from "../lib/calendar";
import { formatClock, formatDay } from "../lib/dates";
import { formatClockRangeShort, phaseOf } from "../lib/events";
import type { DateParts } from "../lib/parse";
import { anchor, categoryOf, goToday, hiddenCategories, setView, step, wide } from "../state/calendar";
import { trackPress } from "../state/drag";
import { categories, items, rescheduleItem, series, skipOccurrences } from "../state/store";
import { CalendarMonth } from "./CalendarMonth";
import { CategoryFilter } from "./CategoryFilter";
import { EventDetails } from "./EventDetails";
import { IconButton } from "./IconButton";
import { QuickCreate } from "./QuickCreate";

/** Pixels per hour on the time grid (matches --cal-hour in calendar.css). */
const HOUR_PX = 48;
/** How tall a moment (a deadline, an event without an end) is drawn, in minutes. */
const MOMENT_MINUTES = 30;
const px = (minutes: number) => `${(minutes * HOUR_PX) / 60}px`;

const STEP_NAME: Record<ViewName, string> = { day: "day", days3: "3 days", week: "week", month: "month" };

const weekdayShort = new Intl.DateTimeFormat("en-GB", { weekday: "short" });
const toDate = (d: DateParts) => new Date(d.year, d.month, d.day);

/** "none" for items without a (known) category, the key the filter uses. */
const filterKey = (categoryId: string | undefined) => (categoryOf(categoryId) ? categoryId! : "none");

interface Opened {
  event: CalEvent;
  anchor: HTMLElement;
}

/**
 * The calendar: a toolbar (previous, Today, next, the range, category
 * filter) over a time grid (Day, 3 days, Week) or a month. Single-key
 * shortcuts work while focus is inside it: T today, J/N next, K/P previous,
 * D day, X 3 days, W week, M month.
 */
export function CalendarView({ view, now }: { view: ViewName; now: number }) {
  const titleId = useId();
  const a = anchor.value;
  const days = viewDays(view, a);
  const from = toDate(days[0]!).getTime();
  const to = new Date(days.at(-1)!.year, days.at(-1)!.month, days.at(-1)!.day + 1).getTime();
  const skip = skipOccurrences.value;
  const all = useMemo(() => eventsInRange(items.value, series.value, from, to, skip), [items.value, series.value, from, to, skip]);
  const hidden = hiddenCategories.value;
  const events = useMemo(() => all.filter((e) => !hidden.has(filterKey(e.item.categoryId))), [all, hidden, categories.value]);
  const [opened, setOpened] = useState<Opened | null>(null);

  const open = (event: CalEvent, el: HTMLElement) => setOpened({ event, anchor: el });
  const close = (restoreFocus: boolean) => {
    const el = opened?.anchor;
    setOpened(null);
    if (restoreFocus && el?.isConnected) el.focus();
  };
  // The opened event may have changed (completed) or gone (removed).
  const live = opened && (events.find((e) => e.id === opened.event.id) ?? null);

  const onShortcut = (e: KeyboardEvent) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    if ((e.target as HTMLElement).closest("input, textarea, select, [contenteditable], [role=dialog]")) return;
    const actions: Record<string, () => void> = {
      t: goToday,
      j: () => step(1),
      n: () => step(1),
      k: () => step(-1),
      p: () => step(-1),
      d: () => setView("day"),
      x: () => setView("days3"),
      m: () => setView("month"),
      ...(wide.value ? { w: () => setView("week") } : {}),
    };
    const run = actions[e.key.toLowerCase()];
    if (!run) return;
    e.preventDefault();
    run();
  };

  return (
    <section class={`calendar-view calendar-view--${view}`} aria-labelledby={titleId} onKeyDown={onShortcut}>
      <div class="calendar-toolbar">
        <IconButton icon="chevronLeft" label={`Previous ${STEP_NAME[view]}`} onClick={() => step(-1)} tooltipAlign="start" />
        <button type="button" class="button button--secondary calendar-toolbar__today" data-tooltip="Today (T)" onClick={goToday}>
          Today
        </button>
        <IconButton icon="chevronRight" label={`Next ${STEP_NAME[view]}`} onClick={() => step(1)} />
        <h2 id={titleId} class="calendar-toolbar__title" aria-live="polite">
          {/* Both forms are rendered; a narrow toolbar shows the short one and keeps the full one for screen readers. */}
          <span class="calendar-toolbar__range">{rangeLabel(view, a, new Date(now).getFullYear())}</span>
          <span class="calendar-toolbar__range-short" aria-hidden="true">
            {rangeLabelShort(view, a)}
          </span>
        </h2>
        {categories.value.length > 0 && <CategoryFilter />}
      </div>

      {view === "month" ? (
        <MonthView events={events} now={now} titleId={titleId} onOpen={open} />
      ) : (
        <TimeGrid key={view} days={days} events={events} now={now} onOpen={open} />
      )}

      {opened && live && <EventDetails event={live} anchor={opened.anchor} now={now} onClose={close} />}
    </section>
  );
}

// ── Time grid ─────────────────────────────────────────────────

interface GridProps {
  days: DateParts[];
  events: CalEvent[];
  now: number;
  onOpen: (e: CalEvent, el: HTMLElement) => void;
}

/** What's being dragged, and where it would land (for the preview). */
type Gesture =
  | { kind: "move" | "resize"; event: CalEvent; patch: Reschedule }
  | { kind: "create"; day: number; start: Date; end: Date };

/** A new item's time on the grid, while the quick-create popover is open. */
interface Draft {
  day: number;
  start: Date;
  end: Date;
}

const sameTime = (a: string | undefined, b: string | undefined) => (a && b ? Date.parse(a) === Date.parse(b) : a === b);
const unchanged = (item: CalEvent["item"], patch: Reschedule) => sameTime(item.dateTime, patch.dateTime) && sameTime(item.endDateTime, patch.endDateTime);

/** Two previews look alike (the pointer moved within one 15-minute step), so the grid needn't redraw. */
function samePreview(a: Gesture, b: Gesture) {
  if (a.kind === "create") return b.kind === "create" && a.day === b.day && a.start.getTime() === b.start.getTime() && a.end.getTime() === b.end.getTime();
  return b.kind !== "create" && a.kind === b.kind && sameTime(a.patch.dateTime, b.patch.dateTime) && sameTime(a.patch.endDateTime, b.patch.endDateTime);
}

/** Alt+arrow keys on a focused event. */
const KEY_MINUTES: Record<string, number> = { ArrowUp: -SNAP, ArrowDown: SNAP };
const KEY_DAYS: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1 };

function TimeGrid({ days, events, now, onOpen }: GridProps) {
  const helpId = useId();
  const scrollRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const draftRef = useRef<HTMLDivElement>(null);
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const today = toDateParts(new Date(now));
  const todayIndex = days.findIndex((d) => sameDay(d, today));
  const nowMinutes = new Date(now).getHours() * 60 + new Date(now).getMinutes();
  // Open on the morning, or an hour before now when today is shown.
  const [startMinute] = useState(() => (todayIndex >= 0 ? Math.max(0, nowMinutes - 60) : 7 * 60));
  const lanes = allDayLanes(events, days);
  const laneCount = lanes.reduce((n, l) => Math.max(n, l.lane + 1), 0);
  // Laid out when the events change, not on every pointer move of a drag.
  const placedByDay = useMemo(() => days.map((d) => layoutDay(segmentsForDay(events, d), MOMENT_MINUTES)), [days, events]);

  // scroll-initial-target (Chrome 133+) places the grid on first render;
  // older versions get the same position from script.
  useLayoutEffect(() => {
    if (!CSS.supports("scroll-initial-target", "nearest") && scrollRef.current) {
      scrollRef.current.scrollTop = (startMinute * HOUR_PX) / 60;
    }
  }, []);

  /** The time of day at a height on the screen, and the day column at a point across. */
  const minutesAt = (y: number) => pointerMinutes(y - bodyRef.current!.getBoundingClientRect().top, HOUR_PX);
  const dayAt = (x: number) => {
    const cols = [...bodyRef.current!.querySelectorAll<HTMLElement>(".time-grid__col")];
    const i = cols.findIndex((c) => x < c.getBoundingClientRect().right);
    return i < 0 ? cols.length - 1 : i;
  };

  const show = (next: Gesture) => setGesture((current) => (current && samePreview(current, next) ? current : next));

  /** Pressing an event: drag it to move it, or drag its bottom edge to change its end. */
  const pressEvent = (e: PointerEvent, event: CalEvent) => {
    const resize = (e.target as Element).closest(".cal-event__resize") !== null;
    const downDay = dayAt(e.clientX);
    const downMinutes = minutesAt(e.clientY);
    const patchAt = (x: number, y: number): Reschedule =>
      resize
        ? { dateTime: event.item.dateTime, endDateTime: resizeEnd(event.item, days[dayAt(x)]!, minutesAt(y)) }
        : moveBy(event.item, dayOffset(days, downDay, dayAt(x)), minutesAt(y) - downMinutes);
    trackPress(e, {
      scroller: scrollRef.current,
      cursor: resize ? "ns-resize" : undefined,
      onDrag: (x, y) => show({ kind: resize ? "resize" : "move", event, patch: patchAt(x, y) }),
      onRelease: (dragged, x, y) => {
        setGesture(null);
        const patch = patchAt(x, y);
        if (dragged && !unchanged(event.item, patch)) rescheduleItem(event.item, patch, event.virtual);
      },
      onCancel: () => setGesture(null),
    });
  };

  /** Pressing empty space: a click makes an hour there; a drag covers the time it crosses. */
  const pressColumn = (e: PointerEvent, day: number) => {
    if ((e.target as Element).closest(".cal-event")) return;
    const from = minutesAt(e.clientY);
    const rangeTo = (y?: number): Draft => ({ day, ...newRange(days[day]!, from, y === undefined ? undefined : minutesAt(y)) });
    trackPress(e, {
      scroller: scrollRef.current,
      cursor: "ns-resize",
      onDrag: (_, y) => show({ kind: "create", ...rangeTo(y) }),
      onRelease: (dragged, _, y) => {
        setGesture(null);
        setDraft(rangeTo(dragged ? y : undefined));
      },
      onCancel: () => setGesture(null),
    });
  };

  /** Touch has no drags here (a drag scrolls), but a tap on empty space makes an hour there. */
  const tapColumn = (e: MouseEvent, day: number) => {
    if ((e as PointerEvent).pointerType !== "touch" || (e.target as Element).closest(".cal-event")) return;
    setDraft({ day, ...newRange(days[day]!, minutesAt(e.clientY)) });
  };

  /** Alt+arrows on a focused event: move it 15 minutes or a day; with Shift, change its end. */
  const keyEvent = (e: KeyboardEvent, event: CalEvent) => {
    const minutes = KEY_MINUTES[e.key] ?? 0;
    const deltaDays = KEY_DAYS[e.key] ?? 0;
    if (!e.altKey || e.ctrlKey || e.metaKey || (!minutes && !deltaDays)) return;
    e.preventDefault();
    e.stopPropagation();
    const { item } = event;
    let patch: Reschedule;
    if (e.shiftKey) {
      if (!item.endDateTime || !minutes) return;
      const end = new Date(Date.parse(item.endDateTime) + minutes * 60_000);
      patch = { dateTime: item.dateTime, endDateTime: resizeEnd(item, toDateParts(end), minutesOfDay(end)) };
    } else {
      patch = moveBy(item, deltaDays, minutes);
    }
    if (unchanged(item, patch)) return;
    rescheduleItem(item, patch, event.virtual);
    // Follow it to the next days when it leaves the ones shown, and keep focus on it where it's redrawn.
    const landed = toDate(toDateParts(new Date(patch.dateTime)));
    if (landed < toDate(days[0]!)) step(-1);
    else if (landed > toDate(days.at(-1)!)) step(1);
    setTimeout(() => document.querySelector<HTMLElement>(`[data-event-id="${CSS.escape(item.id)}"]`)?.focus());
  };

  /** The event as it would be after the gesture, for the preview. */
  const previewEvent: CalEvent | null =
    gesture && gesture.kind !== "create"
      ? (() => {
          const item = { ...gesture.event.item, ...gesture.patch };
          const start = Date.parse(item.dateTime);
          return { ...gesture.event, item, start, end: item.endDateTime ? Date.parse(item.endDateTime) : start };
        })()
      : null;
  const lifted = gesture && gesture.kind !== "create" ? gesture.event.id : null;
  const block = gesture?.kind === "create" ? gesture : draft;

  return (
    <div class="time-grid" style={{ "--days": days.length }}>
      <p id={helpId} class="visually-hidden">
        Drag to move. Drag the bottom edge to change the end. Alt and arrow keys move it by 15 minutes or a day; add Shift to change the end.
      </p>
      {/* Column headings repeat each day section's own name, so they're hidden from screen readers. */}
      <div class="time-grid__head" aria-hidden="true">
        <span />
        {days.map((d, i) => (
          <span key={i} class={`time-grid__day${i === todayIndex ? " time-grid__day--today" : ""}`}>
            <span class="time-grid__weekday">{weekdayShort.format(toDate(d))}</span>
            <span class="time-grid__date">{d.day}</span>
          </span>
        ))}
      </div>

      {laneCount > 0 && (
        <ul class="time-grid__allday" role="list" aria-label="All day" style={{ "--lanes": laneCount }}>
          {lanes.map((l) => (
            <li key={l.event.id} style={{ gridColumn: `${l.first + 2} / span ${l.span}`, gridRow: l.lane + 1 }}>
              <EventButton event={l.event} now={now} onOpen={onOpen} variant="chip" />
            </li>
          ))}
        </ul>
      )}

      <div ref={scrollRef} class="time-grid__scroll">
        <div ref={bodyRef} class="time-grid__body">
          <div class="time-grid__hours" aria-hidden="true">
            {Array.from({ length: 23 }, (_, h) => (
              <span key={h} class="time-grid__hour" style={{ top: px((h + 1) * 60) }}>
                {formatClock(new Date(2000, 0, 1, h + 1)).replace(":00", "")}
              </span>
            ))}
          </div>
          {days.map((d, i) => (
            <section
              key={i}
              class="time-grid__col"
              aria-label={`${formatDay(toDate(d))}${i === todayIndex ? ", today" : ""}`}
              onPointerDown={(e) => pressColumn(e, i)}
              onClick={(e) => tapColumn(e, i)}
            >
              <ul role="list" class="time-grid__events">
                {placedByDay[i]!.map((p) => (
                  <li key={p.event.id} class={`time-grid__slot${lifted === p.event.id ? " time-grid__slot--lifted" : ""}`} style={slotStyle(p)}>
                    <EventButton event={p.event} now={now} onOpen={onOpen} placed={p} describedBy={helpId} onPress={pressEvent} onKey={keyEvent} />
                  </li>
                ))}
              </ul>
              {previewEvent &&
                segmentsForDay([previewEvent], d).map((g) => (
                  <div key="preview" class="time-grid__slot time-grid__slot--preview" style={slotStyle({ ...g, col: 0, cols: 1 })} aria-hidden="true">
                    <EventButton event={g.event} now={now} onOpen={onOpen} placed={{ ...g, col: 0, cols: 1 }} preview />
                  </div>
                ))}
              {block?.day === i && (
                <div
                  ref={block === draft ? draftRef : undefined}
                  class="time-grid__slot time-grid__slot--preview"
                  style={slotStyle({ top: minutesOfDay(block.start), bottom: minutesOfDay(block.end) || 1440, col: 0, cols: 1 })}
                  aria-hidden="true"
                >
                  <span class="cal-event cal-event--block">
                    <span class="cal-event__title">New item</span>
                    <span class="cal-event__time">{formatClockRangeShort(block.start, block.end)}</span>
                  </span>
                </div>
              )}
              {i === todayIndex && <div class="time-grid__now" style={{ top: px(nowMinutes) }} aria-hidden="true" />}
            </section>
          ))}
          <div class="time-grid__start" style={{ top: px(startMinute) }} aria-hidden="true" />
        </div>
      </div>
      {draft && <QuickCreate start={draft.start} end={draft.end} anchor={draftRef} onClose={() => setDraft(null)} />}
    </div>
  );
}

/** Whole days between two shown columns (columns are consecutive days). */
const dayOffset = (days: DateParts[], from: number, to: number) =>
  Math.round((toDate(days[to]!).getTime() - toDate(days[from]!).getTime()) / 86_400_000);

/** Where a laid-out event sits in its column. */
function slotStyle(p: { top: number; bottom: number; col: number; cols: number }) {
  const height = Math.max(p.bottom - p.top, MOMENT_MINUTES);
  return {
    // A late moment (11:59 PM) is drawn ending at midnight, not past it.
    top: px(Math.min(p.top, 1440 - height)),
    height: px(height),
    left: `${(p.col / p.cols) * 100}%`,
    width: `${100 / p.cols}%`,
  };
}

// ── An event on the grid, in the all-day row, or in a day's agenda ──

interface EventButtonProps {
  event: CalEvent;
  now: number;
  onOpen: (e: CalEvent, el: HTMLElement) => void;
  placed?: Placed | (Segment & { col: number; cols: number });
  variant?: "block" | "chip" | "row";
  /** Grid events: the drag and keyboard hints. */
  describedBy?: string;
  onPress?: (e: PointerEvent, event: CalEvent) => void;
  onKey?: (e: KeyboardEvent, event: CalEvent) => void;
  /** Drawn as a drag preview (not interactive). */
  preview?: boolean;
}

function EventButton({ event, now, onOpen, placed, variant = "block", describedBy, onPress, onKey, preview = false }: EventButtonProps) {
  const { item } = event;
  const cat = categoryOf(item.categoryId);
  const moment = event.start === event.end;
  const phase = item.completedAt ? "done" : phaseOf(item, now);
  const start = new Date(event.start);
  const time = event.allDay ? "All day" : moment ? formatClock(start).replace(":00", "") : formatClockRangeShort(start, new Date(event.end));
  const status = item.completedAt ? "Completed" : phase === "now" ? "Happening now" : item.type === "due" ? "Due" : "";
  const resizable = variant === "block" && !moment && !placed?.endsAfter && onPress !== undefined;
  const classes = [
    "cal-event",
    `cal-event--${variant}`,
    `cal-event--${phase}`,
    moment && "cal-event--moment",
    item.type === "due" && "cal-event--due",
    placed?.startsBefore && "cal-event--continued",
    cat && `cal-event--cat category--${cat.color}`,
  ]
    .filter(Boolean)
    .join(" ");

  if (preview) {
    return (
      <span class={classes}>
        <span class="cal-event__title">{item.title}</span>
        <span class="cal-event__time">{time}</span>
      </span>
    );
  }

  return (
    <button
      type="button"
      class={classes}
      data-event-id={item.id}
      aria-describedby={onPress ? describedBy : undefined}
      onClick={(e) => onOpen(event, e.currentTarget)}
      onPointerDown={onPress ? (e) => onPress(e, event) : undefined}
      onKeyDown={onKey ? (e) => onKey(e, event) : undefined}
    >
      {variant === "row" && <span class="cal-event__when">{time}</span>}
      <span class="cal-event__title">{item.title}</span>
      {variant === "block" && <span class="cal-event__time">{time}</span>}
      {variant !== "chip" && item.location && <span class="cal-event__place">{item.location}</span>}
      {status && <span class="visually-hidden">, {status}</span>}
      {resizable && <span class="cal-event__resize" aria-hidden="true" />}
    </button>
  );
}

// ── Month ─────────────────────────────────────────────────────

const MAX_MARKS = 3;

function MonthView({ events, now, titleId, onOpen }: { events: CalEvent[]; now: number; titleId: string; onOpen: (e: CalEvent, el: HTMLElement) => void }) {
  const a = anchor.value;
  const byDay = (d: DateParts) => events.filter((e) => onDay(e, d));
  const selected = byDay(a);

  return (
    <div class="month-view">
      <CalendarMonth
        view={a}
        onViewChange={(p) => (anchor.value = p)}
        focusDay={a}
        onFocusDayChange={(p) => (anchor.value = p)}
        isSelected={(d) => sameDay(d, a)}
        onPick={(d) => (anchor.value = d)}
        hideHeader
        labelledBy={titleId}
        autoFocus={false}
        class="calendar--month"
        dayLabel={(d) => {
          const n = byDay(d).length;
          return `${formatFullDay(d)}${n ? `, ${n} ${n === 1 ? "item" : "items"}` : ""}`;
        }}
        renderDay={(d) => {
          const list = byDay(d);
          if (list.length === 0) return null;
          return (
            <span class="month-day" aria-hidden="true">
              {/* Dots in a narrow panel, titled chips where there's room (see calendar.css). */}
              <span class="month-day__dots">
                {list.slice(0, MAX_MARKS).map((e) => (
                  <span key={e.id} class={`month-day__dot${cat(e)}`} />
                ))}
              </span>
              <span class="month-day__chips">
                {list.slice(0, MAX_MARKS).map((e) => (
                  <span key={e.id} class={`month-day__chip${cat(e)}`}>
                    {e.item.title}
                  </span>
                ))}
                {list.length > MAX_MARKS && <span class="month-day__more">+{list.length - MAX_MARKS}</span>}
              </span>
            </span>
          );
        }}
      />
      <section class="month-agenda" aria-label={formatDay(toDate(a))}>
        <h3 class="month-agenda__title">{formatDay(toDate(a))}</h3>
        {selected.length > 0 ? (
          <ul role="list" class="month-agenda__list">
            {selected.map((e) => (
              <li key={e.id}>
                <EventButton event={e} now={now} onOpen={onOpen} variant="row" />
              </li>
            ))}
          </ul>
        ) : (
          <p class="month-agenda__empty">Nothing on this day.</p>
        )}
      </section>
    </div>
  );
}

const cat = (e: CalEvent) => {
  const c = categoryOf(e.item.categoryId);
  return c ? ` category--${c.color} month-day__mark--cat` : "";
};
