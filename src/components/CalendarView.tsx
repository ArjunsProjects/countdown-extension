import { useId, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import { allDayLanes, eventsInRange, layoutDay, onDay, rangeLabel, rangeLabelShort, segmentsForDay, viewDays, type CalEvent, type CalendarView as ViewName, type Placed } from "../lib/agenda";
import { formatFullDay, sameDay, toDateParts } from "../lib/calendar";
import { formatClock, formatDay } from "../lib/dates";
import { formatClockRangeShort, phaseOf } from "../lib/events";
import type { DateParts } from "../lib/parse";
import { anchor, categoryOf, goToday, hiddenCategories, setView, step, wide } from "../state/calendar";
import { categories, items, series } from "../state/store";
import { CalendarMonth } from "./CalendarMonth";
import { CategoryFilter } from "./CategoryFilter";
import { EventDetails } from "./EventDetails";
import { IconButton } from "./IconButton";

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
  const all = useMemo(() => eventsInRange(items.value, series.value, from, to), [items.value, series.value, from, to]);
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

function TimeGrid({ days, events, now, onOpen }: GridProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const today = toDateParts(new Date(now));
  const todayIndex = days.findIndex((d) => sameDay(d, today));
  const nowMinutes = new Date(now).getHours() * 60 + new Date(now).getMinutes();
  // Open on the morning, or an hour before now when today is shown.
  const [startMinute] = useState(() => (todayIndex >= 0 ? Math.max(0, nowMinutes - 60) : 7 * 60));
  const lanes = allDayLanes(events, days);
  const laneCount = lanes.reduce((n, l) => Math.max(n, l.lane + 1), 0);

  // scroll-initial-target (Chrome 133+) places the grid on first render;
  // older versions get the same position from script.
  useLayoutEffect(() => {
    if (!CSS.supports("scroll-initial-target", "nearest") && scrollRef.current) {
      scrollRef.current.scrollTop = (startMinute * HOUR_PX) / 60;
    }
  }, []);

  return (
    <div class="time-grid" style={{ "--days": days.length }}>
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
        <div class="time-grid__body">
          <div class="time-grid__hours" aria-hidden="true">
            {Array.from({ length: 23 }, (_, h) => (
              <span key={h} class="time-grid__hour" style={{ top: px((h + 1) * 60) }}>
                {formatClock(new Date(2000, 0, 1, h + 1)).replace(":00", "")}
              </span>
            ))}
          </div>
          {days.map((d, i) => {
            const placed = layoutDay(segmentsForDay(events, d), MOMENT_MINUTES);
            return (
              <section key={i} class="time-grid__col" aria-label={`${formatDay(toDate(d))}${i === todayIndex ? ", today" : ""}`}>
                <ul role="list" class="time-grid__events">
                  {placed.map((p) => (
                    <li
                      key={p.event.id}
                      class="time-grid__slot"
                      style={{
                        // A late moment (11:59 PM) is drawn ending at midnight, not past it.
                        top: px(Math.min(p.top, 1440 - Math.max(p.bottom - p.top, MOMENT_MINUTES))),
                        height: px(Math.max(p.bottom - p.top, MOMENT_MINUTES)),
                        left: `${(p.col / p.cols) * 100}%`,
                        width: `${100 / p.cols}%`,
                      }}
                    >
                      <EventButton event={p.event} now={now} onOpen={onOpen} placed={p} />
                    </li>
                  ))}
                </ul>
                {i === todayIndex && <div class="time-grid__now" style={{ top: px(nowMinutes) }} aria-hidden="true" />}
              </section>
            );
          })}
          <div class="time-grid__start" style={{ top: px(startMinute) }} aria-hidden="true" />
        </div>
      </div>
    </div>
  );
}

// ── An event on the grid, in the all-day row, or in a day's agenda ──

interface EventButtonProps {
  event: CalEvent;
  now: number;
  onOpen: (e: CalEvent, el: HTMLElement) => void;
  placed?: Placed;
  variant?: "block" | "chip" | "row";
}

function EventButton({ event, now, onOpen, placed, variant = "block" }: EventButtonProps) {
  const { item } = event;
  const cat = categoryOf(item.categoryId);
  const moment = event.start === event.end;
  const phase = item.completedAt ? "done" : phaseOf(item, now);
  const start = new Date(event.start);
  const time = event.allDay ? "All day" : moment ? formatClock(start).replace(":00", "") : formatClockRangeShort(start, new Date(event.end));
  const status = item.completedAt ? "Completed" : phase === "now" ? "Happening now" : item.type === "due" ? "Due" : "";
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

  return (
    <button type="button" class={classes} onClick={(e) => onOpen(event, e.currentTarget)}>
      {variant === "row" && <span class="cal-event__when">{time}</span>}
      <span class="cal-event__title">{item.title}</span>
      {variant === "block" && <span class="cal-event__time">{time}</span>}
      {variant !== "chip" && item.location && <span class="cal-event__place">{item.location}</span>}
      {status && <span class="visually-hidden">, {status}</span>}
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
