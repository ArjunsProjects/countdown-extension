import { finishOf } from "./events";
import type { Item, Row } from "./types";

const time = (item: Item) => Date.parse(item.dateTime);

export interface Sections {
  /** Soonest first (events happening now lead); recurring series collapsed into stacks. */
  upcoming: Row[];
  /** Passed (events: ended) and not completed, most recent first. */
  overdue: Item[];
  /** Most recently completed first. */
  completed: Item[];
}

/** Splits items into the three list sections. */
export function buildRows(items: readonly Item[], now: number): Sections {
  const upcomingSingles: Item[] = [];
  const series = new Map<string, Item[]>();
  const overdue: Item[] = [];
  const completed: Item[] = [];

  for (const item of items) {
    if (item.completedAt) {
      completed.push(item);
    } else if (finishOf(item) <= now) {
      overdue.push(item);
    } else if (item.seriesId) {
      const group = series.get(item.seriesId) ?? [];
      group.push(item);
      series.set(item.seriesId, group);
    } else {
      upcomingSingles.push(item);
    }
  }

  const rows: Row[] = upcomingSingles.map((item) => ({ kind: "single", item }));
  for (const [seriesId, group] of series) {
    group.sort((a, b) => time(a) - time(b));
    // A series with one occurrence left is just a tile.
    rows.push(group.length === 1 ? { kind: "single", item: group[0]! } : { kind: "stack", seriesId, items: group });
  }

  const head = (row: Row) => (row.kind === "single" ? row.item : row.items[0]!);
  rows.sort((a, b) => time(head(a)) - time(head(b)) || head(a).title.localeCompare(head(b).title));
  overdue.sort((a, b) => time(b) - time(a));
  completed.sort((a, b) => Date.parse(b.completedAt!) - Date.parse(a.completedAt!));

  return { upcoming: rows, overdue, completed };
}
