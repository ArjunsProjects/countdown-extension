import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { useDismiss, type DismissReason } from "../hooks/useDismiss";
import { relativeLabel } from "../lib/countdown";
import { formatItemDate, formatShortDateTime } from "../lib/dates";
import { formatTime } from "../lib/parse";
import type { Item, ItemType, Unit } from "../lib/types";
import { fromYmd, nextMatchingDay } from "../lib/calendar";
import { toLocalISO } from "../lib/dates";
import { hasNumberToken, renderTitle } from "../lib/numbering";
import type { TimeParts } from "../lib/parse";
import { occurrenceIndex } from "../lib/recurrence";
import { MAX_LOCATION } from "../lib/events";
import { assignCategory, changeSeriesRule, prefs, removeItems, removeSeries, saveSeries, series, setSeriesEnd, setSeriesLocation, setSeriesReminders, setSeriesTime } from "../state/store";
import { completing, editing, focusTile, startCompletion } from "../state/ui";
import { CategoryField } from "./CategoryField";
import { Checkbox } from "./Checkbox";
import { CountdownBox } from "./CountdownBox";
import { SelectCell } from "./SelectCell";
import { Icon } from "./Icon";
import { occurrenceCount, repeatOf } from "./ItemEditor";
import { NO_REPEAT, RepeatField, ruleOf, sameRepeat, type RepeatValue } from "./RepeatField";
import { ReminderField } from "./ReminderField";
import { TimeField } from "./TimeField";
import { TitleNumbering } from "./TitleNumbering";
import { TypeToggle } from "./TypeToggle";

const partsOf = (iso: string) => {
  const d = new Date(iso);
  return { year: d.getFullYear(), month: d.getMonth(), day: d.getDate() };
};

interface Props {
  seriesId: string;
  /** Upcoming occurrences, soonest first. */
  items: Item[];
  unit: Unit;
  now: number;
}

/**
 * An expanded recurring stack: edit the series title/type, and complete or
 * remove occurrences one at a time or in bulk. Closes like the item editor.
 */
export function StackEditorRow({ seriesId, items, unit, now }: Props) {
  const head = items[0]!;
  const [owner] = useState(() => series.value.find((x) => x.id === seriesId));
  // A numbered series edits its template ("Chapter {n}"), not the head's title.
  const [title, setTitle] = useState(owner?.numberFrom !== undefined ? owner.template.title : head.title);
  const [type, setType] = useState<ItemType>(head.type);
  const [numberFrom, setNumberFrom] = useState(owner?.numberFrom ?? 1);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [initialRepeat] = useState<RepeatValue>(() => repeatOf(owner, head));
  const [repeat, setRepeat] = useState(initialRepeat);
  const latestRepeat = useRef(repeat);
  latestRepeat.current = repeat;
  const latestFrom = useRef(numberFrom);
  latestFrom.current = numberFrom;

  // One time for the whole stack. Starts from the next occurrence's time.
  const timeOf = (i: Item): TimeParts | null => {
    if (i.allDay) return null;
    const d = new Date(i.dateTime);
    return { hour: d.getHours(), minute: d.getMinutes() };
  };
  const [time, setTime] = useState<TimeParts | null>(() => timeOf(head));
  const [timeTouched, setTimeTouched] = useState(false);
  const [categoryId, setCategoryId] = useState<string | null>(head.categoryId ?? null);
  const latestCategory = useRef(categoryId);
  latestCategory.current = categoryId;
  // One end time and one place for the whole stack, like the time above.
  const endTimeOf = (i: Item): TimeParts | null => {
    if (i.allDay || !i.endDateTime) return null;
    const d = new Date(i.endDateTime);
    return { hour: d.getHours(), minute: d.getMinutes() };
  };
  const [endTime, setEndTime] = useState<TimeParts | null>(() => endTimeOf(head));
  const [endTouched, setEndTouched] = useState(false);
  const [place, setPlace] = useState(head.location ?? owner?.template.location ?? "");
  const [placeTouched, setPlaceTouched] = useState(false);
  // Reminders too: the series', or (a stack with no stored rule) the next occurrence's.
  const [reminders, setReminders] = useState(() => (owner ? owner.template.reminders : head.reminders));
  const [remindersTouched, setRemindersTouched] = useState(false);
  const latestTime = useRef({ time, timeTouched, endTime, endTouched, place, placeTouched, reminders, remindersTouched });
  latestTime.current = { time, timeTouched, endTime, endTouched, place, placeTouched, reminders, remindersTouched };
  const mixedTimes = new Set(items.map((i) => JSON.stringify(timeOf(i)))).size > 1;

  /** An occurrence's title as it will read with the title being edited. */
  const liveTitle = (occ: Item) => {
    if (occ.customTitle || !owner) return occ.customTitle ? occ.title : title.trim() || occ.title;
    const template = title.trim() || owner.template.title;
    return hasNumberToken(template) ? renderTitle(template, occurrenceIndex(owner, occ), numberFrom) : template;
  };
  const ref = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const latest = useRef({ title, type });
  latest.current = { title, type };

  useLayoutEffect(() => {
    titleRef.current?.focus();
    ref.current?.scrollIntoView({ block: "nearest" });
  }, []);

  // Drop selections for occurrences that were removed or completed meanwhile.
  const ids = new Set(items.map((i) => i.id));
  const selectedHere = [...selected].filter((id) => ids.has(id));

  const close = (reason: DismissReason | "enter") => {
    const r = latestRepeat.current;
    const from = latestFrom.current;
    const { title: t, type: ty } = latest.current;
    const template = t.trim() || (owner?.template.title ?? head.title);
    // Only series with a stored rule can be restarted; others just get renamed.
    if (owner && !sameRepeat(r, initialRepeat) && initialRepeat !== NO_REPEAT) {
      const rule = ruleOf(r);
      // Restart from the next occurrence, which keeps its number. With custom
      // dates it moves to the earliest chosen day (same time of day).
      let anchor: Item = { ...head, type: ty };
      const at = new Date(head.dateTime);
      const moveTo = (day: { year: number; month: number; day: number }) => {
        anchor = { ...anchor, dateTime: toLocalISO(new Date(day.year, day.month, day.day, at.getHours(), at.getMinutes())) };
      };
      if (rule?.freq === "DATES" && rule.dates?.length) moveTo(fromYmd(rule.dates[0]!));
      if (rule?.freq === "WEEKLY" && rule.weekdays?.length) {
        moveTo(nextMatchingDay({ year: at.getFullYear(), month: at.getMonth(), day: at.getDate() }, rule.weekdays));
      }
      changeSeriesRule(seriesId, anchor, rule, r.end, new Date(), { template, numberFrom: from + occurrenceIndex(owner, head) });
    } else {
      saveSeries(seriesId, { title: template, type: ty, numberFrom: from });
    }
    const tm = latestTime.current;
    if (tm.timeTouched) setSeriesTime(seriesId, tm.time);
    if (tm.endTouched && tm.time) setSeriesEnd(seriesId, tm.endTime);
    if (tm.placeTouched) setSeriesLocation(seriesId, tm.place);
    if (tm.remindersTouched) setSeriesReminders(seriesId, tm.reminders);
    if ((head.categoryId ?? null) !== latestCategory.current) {
      assignCategory({ kind: "series", id: seriesId }, latestCategory.current, true);
    }
    editing.value = null;
    if (reason !== "outside") focusTile(items[0]!.id);
  };

  useDismiss(ref, close);

  const toggle = (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const allChecked = selectedHere.length === items.length;

  return (
    <li class="row grid-row row--editing row--stack-open">
      <SelectCell />
      <CountdownBox item={head} unit={unit} now={now} />
      <div ref={ref} class="editor editor--stack" role="group" aria-label={`Edit series ${head.title}`}>
        <input
          ref={titleRef}
          class="editor__title"
          aria-label="Series title"
          maxLength={200}
          value={title}
          onInput={(e) => setTitle(e.currentTarget.value)}
          onKeyDown={(e) => {
            // The Enter that confirms Japanese, Chinese or Korean input isn't a save.
            if (e.key === "Enter" && !e.isComposing) {
              e.preventDefault();
              close("enter");
            }
          }}
        />
        <TitleNumbering
          title={title}
          onTitleChange={setTitle}
          from={numberFrom}
          onFromChange={setNumberFrom}
          repeating={owner !== undefined}
          count={occurrenceCount(repeat)}
          offset={owner && sameRepeat(repeat, initialRepeat) ? occurrenceIndex(owner, head) : 0}
          hidePreview
          inputRef={titleRef}
        />
        <TypeToggle value={type} onChange={setType} />
        <CategoryField value={categoryId} onChange={setCategoryId} />
        <div class="stack-time">
          <div class="stack-time__row">
            <TimeField
              value={time}
              label="Time for every occurrence"
              onChange={(t) => {
                setTime(t);
                setTimeTouched(true);
              }}
            />
            {type === "starts" && time && (
              <>
                <span class="stack-time__dash" aria-hidden="true">
                  –
                </span>
                <TimeField
                  value={endTime}
                  label="End time for every occurrence"
                  placeholder="End time"
                  onChange={(t) => {
                    setEndTime(t);
                    setEndTouched(true);
                  }}
                />
              </>
            )}
          </div>
          <p class="field-hint">
            {timeTouched
              ? "Applies to every upcoming occurrence when you close."
              : mixedTimes
                ? "Times differ. Set one to use it for every occurrence."
                : "Change to move every occurrence."}
          </p>
        </div>
        <div class="field-button field-button--input editor__location">
          <Icon name="pin" />
          <input
            class="editor__location-input"
            aria-label="Location for every occurrence"
            placeholder="Add location"
            maxLength={MAX_LOCATION}
            autoComplete="off"
            enterKeyHint="done"
            value={place}
            onInput={(e) => {
              setPlace(e.currentTarget.value);
              setPlaceTouched(true);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.isComposing) {
                e.preventDefault();
                close("enter");
              }
            }}
          />
        </div>
        <ReminderField
          value={reminders}
          onChange={(v) => {
            setReminders(v);
            setRemindersTouched(true);
          }}
          item={{ type, allDay: time === null }}
          fallback={prefs.value.reminders[type]}
          label="Remind me, for every occurrence"
          offerTurnOn
        />
        {initialRepeat !== NO_REPEAT && (
          <RepeatField date={partsOf(head.dateTime)} value={repeat} onChange={setRepeat} />
        )}

        <div class="occurrences">
          <div class="occurrences__head">
            <Checkbox
              checked={allChecked}
              indeterminate={selectedHere.length > 0 && !allChecked}
              onChange={(on) => setSelected(on ? new Set(ids) : new Set())}
              label="Select all"
            />
            <span class="occurrences__count">{items.length} upcoming</span>
          </div>

          <ul class="occurrences__list" role="list" aria-label="Occurrences">
            {items.map((occ) => {
              const date = new Date(occ.dateTime);
              const isCompleting = completing.value.has(occ.id);
              return (
                <li key={occ.id} class={`occurrence${isCompleting ? " occurrence--completing" : ""}`}>
                  <Checkbox
                    checked={selected.has(occ.id)}
                    onChange={(on) => toggle(occ.id, on)}
                    label={`${liveTitle(occ)}, ${formatItemDate(date, occ.allDay)}`}
                    hideLabel
                  />
                  <span class="occurrence__text">
                    <span class="occurrence__title">{liveTitle(occ)}</span>
                    <span class="occurrence__rel">
                      {formatShortDateTime(date, true, new Date(now))} ·{" "}
                      {occ.allDay ? "All day" : formatTime({ hour: date.getHours(), minute: date.getMinutes() })} ·{" "}
                      {relativeLabel(date.getTime(), now)}
                    </span>
                  </span>
                  <button
                    type="button"
                    class="icon-button icon-button--sm"
                    aria-label={`Edit ${occ.title}, ${formatItemDate(date, occ.allDay)}`}
                    data-tooltip="Edit this one"
                    data-tooltip-align="end"
                    disabled={isCompleting}
                    onClick={() => {
                      // Save series edits first, then open just this occurrence.
                      close("outside");
                      editing.value = { kind: "item", id: occ.id };
                    }}
                  >
                    <Icon name="edit" />
                  </button>
                  <button
                    type="button"
                    class="icon-button icon-button--sm icon-button--complete"
                    aria-label={`Complete ${formatItemDate(date, occ.allDay)}`}
                    data-tooltip="Complete"
                    data-tooltip-align="end"
                    disabled={isCompleting}
                    onClick={() => startCompletion(occ.id)}
                  >
                    <Icon name="check" />
                  </button>
                  <button
                    type="button"
                    class="icon-button icon-button--sm icon-button--danger"
                    aria-label={`Remove ${formatItemDate(date, occ.allDay)}`}
                    data-tooltip="Remove"
                    data-tooltip-align="end"
                    disabled={isCompleting}
                    onClick={() => removeItems([occ.id])}
                  >
                    <Icon name="close" />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        <div class="editor__actions">
          <button
            type="button"
            class="button button--danger-quiet"
            disabled={selectedHere.length === 0}
            onClick={() => {
              // Removing every upcoming occurrence means stopping the series;
              // otherwise new occurrences would be generated to replace them.
              if (allChecked && initialRepeat !== NO_REPEAT) {
                editing.value = null;
                removeSeries(seriesId);
              } else {
                removeItems(selectedHere);
              }
              setSelected(new Set());
            }}
          >
            {allChecked && initialRepeat !== NO_REPEAT
              ? "Remove series"
              : `Remove selected${selectedHere.length > 0 ? ` (${selectedHere.length})` : ""}`}
          </button>
        </div>
      </div>
    </li>
  );
}
