import type { ComponentChildren } from "preact";
import { formatWhen } from "../lib/events";
import type { Item } from "../lib/types";
import { Icon } from "./Icon";

interface Props {
  item: Item;
  past?: boolean;
  /** Extra line under the date, e.g. a stack's occurrence count. */
  meta?: ComponentChildren;
  onOpen?: () => void;
  /** In selection mode the tile toggles its checkbox; the checkbox is the accessible control. */
  selecting?: boolean;
  selected?: boolean;
  /** Small label after the type tag, e.g. "Import" or "Already added". */
  badge?: { text: string; tone: "accent" | "muted" };
  /** Starts a drag (moving the item into a category). */
  onPointerDown?: (e: PointerEvent) => void;
}

export function ItemTile({ item, past = false, meta, onOpen, selecting = false, selected = false, badge, onPointerDown }: Props) {
  const date = formatWhen(item);
  // No aria-label: the button is named by its visible content (title, tag,
  // date, notes, meta), so speech-input users can say what they see. Its
  // parts are block-level, so the computed name has word breaks between them.
  return (
    <button
      type="button"
      class={`tile${past ? " tile--past" : ""}${selected ? " tile--selected" : ""}`}
      data-tile-id={item.id}
      tabIndex={selecting ? -1 : undefined}
      aria-hidden={selecting || undefined}
      onClick={onOpen}
      onPointerDown={onPointerDown}
    >
      <span class="tile__top">
        <span class="tile__title">
          {item.title}
        </span>
        <span class={`tag tag--${item.type}`}>
          {item.type === "due" ? "Due" : "Starts"}
        </span>
      </span>
      <span class="tile__date">
        {date}
      </span>
      {item.location && (
        <span class="tile__location">
          <Icon name="pin" />
          {item.location}
        </span>
      )}
      {item.notes && (
        <span class="tile__notes">
          {item.notes}
        </span>
      )}
      {(meta || badge) && (
        <span class="tile__meta">
          {/* The badge sits on the meta line so long titles keep their room. */}
          {badge && <span class={`badge badge--${badge.tone}`}>{badge.text}</span>}
          {meta}
        </span>
      )}
    </button>
  );
}
