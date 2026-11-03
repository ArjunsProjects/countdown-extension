import { batch, effect } from "@preact/signals";
import { render } from "preact";
import "@fontsource-variable/inter";
import "../styles/tokens.css";
import "../styles/base.css";
import "../styles/components.css";
import "../styles/calendar.css";
import { now, startClock } from "../state/clock";
import { startSync } from "../state/sync";
import { addItem, ensureOccurrences, initStore, items, makeRepeating } from "../state/store";
import { syncTheme } from "../state/theme";
import { App } from "./App";

await initStore();
syncTheme();
startClock();
void startSync();
// Keep repeating items topped up as time passes and occurrences complete.
effect(() => ensureOccurrences(now.value));

// Development builds only: open the panel with ?seed to load sample data into an empty list.
if (import.meta.env.MODE === "development" && new URLSearchParams(location.search).has("seed") && items.value.length === 0) {
  const { sampleItems } = await import("../lib/sample");
  const { presetRule } = await import("../lib/recurrence");
  batch(() => {
    for (const item of sampleItems()) {
      addItem(item.id === "sample-planning" ? makeRepeating(item, presetRule("weekly"), { type: "never" }) : item);
    }
  });
}

render(<App />, document.getElementById("root")!);
