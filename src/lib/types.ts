export type ItemType = "due" | "starts";
export type ItemSource = "manual" | "import";
export type Unit = "days" | "hours" | "minutes" | "seconds";

export interface Item {
  id: string;
  title: string;
  type: ItemType;
  /** ISO 8601 with UTC offset, e.g. 2026-10-29T15:00:00-07:00. For all-day items, local midnight. */
  dateTime: string;
  allDay?: boolean;
  /**
   * Events only: when it ends, as ISO 8601 with UTC offset. Exclusive, like
   * iCalendar's DTEND: an all-day event ending on the 12th stores local
   * midnight at the start of the 13th. Absent: the event is a point in time.
   */
  endDateTime?: string;
  /** Where it happens, e.g. "Wesbrook Building". */
  location?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  source: ItemSource;
  /** iCalendar UID: kept from imports, generated on first export. */
  uid?: string;
  /** Occurrences of one recurring event share a seriesId and render as a stack. */
  seriesId?: string;
  /** This occurrence was renamed on its own; series renames leave its title alone. */
  customTitle?: boolean;
  /** Category (section) the item belongs to. */
  categoryId?: string;
  /** Set when the user marks the item done; completed items leave the list. */
  completedAt?: string;
}

/** Written when an item is completed. Kept separately so stats survive item removal. */
export interface CompletionRecord {
  id: string;
  itemId: string;
  title: string;
  type: ItemType;
  dateTime: string;
  completedAt: string;
}

/** A row in the main list: one item, or the upcoming occurrences of a series. */
export type Row =
  | { kind: "single"; item: Item }
  | { kind: "stack"; seriesId: string; items: Item[] };
