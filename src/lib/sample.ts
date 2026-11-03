import { toLocalISO } from "./dates";
import type { Item } from "./types";

// Development sample data, positioned relative to "now" so every state
// (soon, far, happening now, overdue, started, ended) is visible. "sample-planning" is made into a
// weekly series by the seed code in main.tsx, which produces a stack.
export function sampleItems(now = new Date()): Item[] {
  const at = (days: number, hour: number, minute = 0) => {
    const d = new Date(now);
    d.setDate(d.getDate() + days);
    d.setHours(hour, minute, 0, 0);
    return toLocalISO(d);
  };
  const inHours = (hours: number) => toLocalISO(new Date(now.getTime() + hours * 3_600_000));
  const stamp = toLocalISO(now);
  const base = { createdAt: stamp, updatedAt: stamp };

  const daysToMonday = ((8 - now.getDay()) % 7) || 7;
  // First occurrence of a weekly series; the app generates the rest.
  const planning: Item = {
    ...base,
    id: "sample-planning",
    title: "Weekly planning",
    type: "starts",
    dateTime: at(daysToMonday, 10),
    endDateTime: at(daysToMonday, 11),
    location: "Room 204",
    source: "manual",
  };

  return [
    { ...base, id: "sample-1", title: "Grant application", type: "due", dateTime: inHours(3.5), source: "manual" },
    { ...base, id: "sample-2", title: "Design review deck", type: "due", dateTime: at(2, 17), source: "manual" },
    {
      ...base,
      id: "sample-now",
      title: "Team standup",
      type: "starts",
      dateTime: inHours(-0.25),
      endDateTime: inHours(0.5),
      location: "Video call",
      source: "manual",
    },
    { ...base, id: "sample-3", title: "Flight to Lisbon", type: "starts", dateTime: at(9, 7, 45), endDateTime: at(9, 11, 5), source: "manual" },
    { ...base, id: "sample-4", title: "Q4 estimated tax payment", type: "due", dateTime: at(41, 23, 59), source: "manual" },
    { ...base, id: "sample-5", title: "Conference talk proposal for the spring developer summit", type: "due", dateTime: at(160, 12), source: "manual" },
    planning,
    { ...base, id: "sample-6", title: "Return library books", type: "due", dateTime: at(-2, 18), source: "manual" },
    { ...base, id: "sample-7", title: "Dentist", type: "starts", dateTime: at(-1, 9, 30), endDateTime: at(-1, 10, 15), source: "manual" },
  ];
}
