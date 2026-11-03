import { abbreviate, describeRemaining, unitsRemaining } from "../lib/countdown";
import { endOf, phaseOf } from "../lib/events";
import { cycleItemUnit, unitOverrides } from "../state/ui";
import type { Item, Unit } from "../lib/types";

interface Props {
  item: Item;
  unit: Unit;
  now: number;
  /** Plays the completion animation: the box turns into a check mark. */
  completing?: boolean;
  /** Clicking cycles this item's own unit (list rows; not editor previews). */
  interactive?: boolean;
}

const SHORT_UNIT = { days: "days", hours: "hrs", minutes: "min", seconds: "sec" } as const;

const BURST = [0, 60, 120, 180, 240, 300];

export function CountdownBox({ item, unit: globalUnit, now, completing = false, interactive = false }: Props) {
  const override = interactive ? unitOverrides.value.get(item.id) : undefined;
  const unit = override ?? globalUnit;
  if (completing) {
    return (
      <div class="countdown countdown--done" role="img" aria-label="Completed">
        <svg class="countdown__check" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M5 12.5 10 17.5 19 7" pathLength={1} />
        </svg>
        {BURST.map((deg) => (
          <span key={deg} class="countdown__spark" style={{ "--angle": `${deg}deg` }} aria-hidden="true" />
        ))}
      </div>
    );
  }

  const target = Date.parse(item.dateTime);
  const phase = phaseOf(item, now);

  if (phase === "now") {
    // Happening: the box says so; the time left until it ends is in the tooltip.
    const left = describeRemaining(endOf(item)!, now);
    return (
      <div class="countdown countdown--now" role="img" aria-label={`Happening now, ends in ${left}`} data-tooltip={`Ends in ${left}`} data-tooltip-align="start">
        <span class="countdown__label">Now</span>
      </div>
    );
  }

  const value = unitsRemaining(target, now, unit);
  if (value === null) {
    const overdue = item.type === "due";
    return (
      <div class={`countdown countdown--past ${overdue ? "countdown--overdue" : "countdown--started"}`}>
        <span class="countdown__label">{overdue ? "Overdue" : endOf(item) === null ? "Started" : "Ended"}</span>
      </div>
    );
  }

  const full = describeRemaining(target, now);
  const text = abbreviate(value);
  const classes = `countdown${text.length >= 5 ? " countdown--long" : ""}${override ? " countdown--own-unit" : ""}`;
  // Keyed by unit so switching units replays a short fade; per-second ticks don't.
  const number = (
    <span key={unit} class="countdown__value">
      {text}
    </span>
  );

  if (!interactive) {
    return (
      <div class={classes} role="img" aria-label={`${full} left`} data-tooltip={`${full} left`} data-tooltip-align="start">
        {number}
      </div>
    );
  }

  return (
    <button
      type="button"
      class={classes}
      data-tooltip={`${full} left · click to change unit`}
      data-tooltip-align="start"
      onClick={() => cycleItemUnit(item.id, globalUnit)}
    >
      {number}
      {/* A box in its own unit says which; otherwise the header's label applies. */}
      {override && <span class="countdown__unit">{SHORT_UNIT[unit]}</span>}
      <span class="visually-hidden">
        {override ? "" : ` ${unit}`} left, exactly {full}. Change unit for this item
      </span>
    </button>
  );
}
