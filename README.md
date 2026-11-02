# Countdown

**See exactly how long you have left until every deadline and event, right in Chrome's side panel.**

**[Add Countdown to Chrome](https://chromewebstore.google.com/detail/countdown/feeppdmbpeckhalnfnaflppcjadpceia)** · free, on the Chrome Web Store

![Countdown docked beside a course page in Chrome](store-assets/screenshot-1.png)

## Why I made this

If your brain works a bit like mine (a little ADHD, maybe), it's hard to feel how close something really is when it's just a block on a calendar. "Due Friday" doesn't land the way "2 days left" does.

So I built a simple panel that sits beside whatever I'm working on, pulls in my calendar, and turns every deadline and exam into a live countdown. No more digging through my calendar to work out how much time I've got. I hope it helps you as much as it helps me.

## What it does

- **Live countdowns** in days, hours, minutes or seconds, for deadlines (**Due**) and events (**Starts**)
- **Brings in your calendar:** `.ics` files or Google, Apple and Outlook calendar links, with duplicates spotted for you
- **Colour-coded categories** for each course, project or trip, with drag and drop
- **Repeating items,** like weekly homework numbered "Chapter 4, 5, 6…"
- **A toolbar icon** that shows the time left until your next deadline (switch it off in Appearance if it stresses you out)
- **Seven colour themes** in light and dark, full keyboard support, and screen reader friendly

## Your privacy

Everything you add stays in Chrome on your own device. None of it is sent to me or anyone else, and there's no account, server, analytics or tracking. Countdown asks for no access to websites when you install it. If you import a calendar link, Chrome asks whether Countdown may read that one site, and that's the only site it ever contacts. The full policy is in [PRIVACY.md](PRIVACY.md).

## Get Countdown

Install it from the **[Chrome Web Store](https://chromewebstore.google.com/detail/countdown/feeppdmbpeckhalnfnaflppcjadpceia)**, then pin it and click its icon to open the side panel. It updates itself whenever I publish a new version.

If you'd rather build it from source, the steps are below.

## Made by one person

Countdown is a one-person project, built and looked after by me. If something's broken or you have an idea, I'd love to hear it: [open an issue](https://github.com/ArjunsProjects/countdown-extension/issues).

---

## Building it yourself

The rest of this page is for running Countdown from source, and a full reference of how everything behaves. Design tokens, components and motion are documented in [DESIGN.md](DESIGN.md).

### Requirements

- **Chrome 123 or later** (side panel, `light-dark()` colors, the Popover API)
- **Node 24 LTS** with npm 11, to build

### Install and build

```bash
npm ci
npm run build
```

This writes the unpacked extension to `dist/`.

> With older Node versions bundled with npm 10, `npm install` can fail with `Cannot read properties of null (reading 'edgesOut')` (an npm bug). `npm ci` still works; upgrading to Node 24 fixes it.

### Load the extension in Chrome

1. Run `npm run build`.
2. Open `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose the `dist/` folder.
4. Pin **Countdown** from the puzzle-piece menu, then click its icon. The side panel opens.

**After changing the code:** run `npm run build` again (or keep `npm run dev` running, which rebuilds on save), click the reload icon on Countdown's card in `chrome://extensions`, then reopen the panel.

## Using Countdown

A quick guide to everything you can do.


| To… | Do this |
|---|---|
| Add an item | **+** in the header. Type a title, choose **Due** or **Starts**, a date and a time. Changes save when you press Escape or Enter in the title, or click outside. |
| Edit an item | Click its tile. **Complete** and **Remove** are at the bottom of the editor. |
| Change the countdown unit | Click **Days** (top left) to cycle every box through Days → Hours → Minutes → Seconds. Click a single countdown box to cycle just that item; it shows a small unit label (HRS, MIN, SEC) until it cycles back to the header's unit. |
| Repeat an item | In the editor, **Repeat**: daily, weekdays, weekly, weekly on chosen days, every 2 weeks, monthly, yearly, or **Custom dates…**. Then choose when it ends. |
| Number repeating titles | With Repeat set, **# Number each occurrence** (select the "1" in "Chapter 1" first to replace it). |
| Manage a repeating stack | Click the stack to rename the series, set one **Time** for every occurrence, change its rule, or complete/remove occurrences one at a time or all at once. Each row shows the occurrence's title and date. The pencil on an occurrence edits just that one (its date, time, or its own title via **Rename: Only this one**). |
| Add a category | The **▾** next to **+** → **New category**. Name it, pick one of eight colours, press Enter. The menu also offers **New item in…** each category. |
| Put items in a category | Drag a tile or a whole stack onto a category's section (drop on **Other** to take it out). Or use the **Category** field in the item or stack editor; to move several at once, tick them under **Export** and choose **Move to category**. New items made with a category's own **+** start in it. |
| Reorder categories | Drag a category's header up or down, or use **Move up / Move down** in its **⋯** menu. |
| Rename, recolour or delete a category | Its **⋯** menu. Deleting moves its items to Other, with Undo. Click a category's name to collapse it; a collapsed category shows its count and when its next item is due. |
| Undo | Every remove, complete, clear and import shows **Undo** for 5 seconds (or press Cmd/Ctrl+Z). |
| Export, or act on several at once | **Export** (header) → tick items → Google Calendar, Download .ics, Remove, or **Move to category** (shown once you have categories). |
| Import | **Import** (header), or drop an `.ics` file anywhere on the panel. Or paste a calendar link and press **Fetch**. Review the preview, optionally choose a **Category** for everything you're adding, then **Add selected**. |
| Change the look | The palette button at the end of the header opens **Appearance**: **Mode** (System, Light or Dark), **Colour** (seven themes), and **Time left on toolbar icon**. |

**Calendar links:** in Google Calendar, use *Settings › your calendar › Secret address in iCal format*; in Apple Calendar, share the calendar as a Public Calendar and copy its `webcal://` link.

### Keyboard

Everything works without a mouse. Tab moves between controls; Enter or Space activates. In the calendar, arrows move by day or week, Home/End to the week's ends, PageUp/PageDown by month (with Shift: by year). In the time field, arrows move through the list and Enter picks. Escape closes the innermost popover, editor or sheet, and cancels a drag. Cmd/Ctrl+Z undoes while the toast is showing. Dragging is mouse-only; the **Category** field in editors and **Move up / Move down** in a category's menu do the same jobs from the keyboard.

## Permissions, in detail

Countdown stores everything locally in `chrome.storage.local`; there is no account, server or analytics. It requests `sidePanel`, `storage`, `alarms` (to redraw the toolbar icon on time) and `offscreen` (a hidden page that tells the toolbar icon whether Chrome is in dark mode); none of these shows a warning or prompt at install. When you fetch a calendar link, Chrome asks for permission to read that site (and its subdomains, because calendar servers redirect); nothing else on the web is accessed. Exports are files you download.

## Development

| Command | What it does |
|---|---|
| `npm run build` | Typecheck, then build to `dist/` |
| `npm run dev` | Development build to `dist/`, rebuilt on every change |
| `npm test` | Unit tests (Vitest) |
| `npm run coverage` | Tests with coverage for `src/lib` and `src/state` |
| `npm run typecheck` | TypeScript only |
| `npm run icons` | Regenerate `public/icons/*.png` from `scripts/make-icons.mjs` |
| `npm run package` | Production build, checked and zipped to `release/countdown-v<version>.zip` for the Chrome Web Store |
| `npm run check:extension` | Loads the built `dist/` into headless Chrome and checks the worker, toolbar icon and permissions before an upload |
| `bash scripts/screenshots.sh` | Re-render the store images (five 1280×800 screenshots, promo tile, marquee) from the real panel; needs a build on `vite preview --port 4173` |

**Publishing:** Countdown is [live on the Chrome Web Store](https://chromewebstore.google.com/detail/countdown/feeppdmbpeckhalnfnaflppcjadpceia). [CHROMEWEBSTORE.md](CHROMEWEBSTORE.md) holds the listing copy, permission justifications, privacy disclosures, version history and the steps for releasing an update; [PRIVACY.md](PRIVACY.md) is the privacy policy.

**Sample data:** in a development build (`npm run dev`), open `chrome-extension://<extension-id>/sidepanel/index.html?seed` while the list is empty to load sample items, including a repeating stack. Production builds strip this out.

### Project layout

```
public/            manifest.json and icons (copied to dist/ as-is)
src/background/    MV3 service worker: opens the side panel and draws the toolbar icon
src/offscreen/     hidden page that reports Chrome's light/dark mode to the worker
src/sidepanel/     panel page, entry point and root component
src/components/    UI components (Preact)
src/hooks/         shared hooks: dismissal, presence animations, sheet height
src/lib/           pure logic, unit-tested: dates, parsing, calendar, countdowns,
                   recurrence, numbering, categories, time zones,
                   .ics import/export, duplicate detection, storage
                   validation, positioning, palettes, toolbar icon
src/state/         signals and actions: items, series, categories, prefs,
                   selection, import, drag and drop, clock, theme, toast
src/styles/        tokens.css (every design token), base.css, components.css
tests/             Vitest unit tests
```

### How it fits together

- **UI:** Preact components with `@preact/signals` for state. Components read signals directly, so only what changed re-renders.
- **Data model:** `Item` (title, type, `dateTime` as ISO with UTC offset, optional all-day, notes, source, `seriesId`, completion) and `Series` (rule, end, title template, numbering, next index to generate, optional source time zone). Completions are also stored as separate records so stats survive removal. `Category` (name, colour from a fixed palette, collapsed) lives in an ordered list; items and series point to one by `categoryId`, and a series passes it on to every occurrence it generates.
- **Repeating items:** a series keeps its next 6 occurrences generated (deterministic ids), topping up as they are completed or pass. Rules are a subset of RRULE plus hand-picked dates.
- **Storage:** `chrome.storage.local` with a versioned schema; everything read back is validated. Writes from one action are coalesced into a single write so other open panels never see half a change, and panels never write back in reaction to another panel's change.
- **Themes:** `<html data-palette>` swaps a handful of `--p-*` colours in `tokens.css`; every accent-derived colour is computed from them with `color-mix()`. `src/lib/palettes.ts` holds the same colours for the toolbar icon and the swatches, and a test keeps the two identical.
- **Toolbar icon:** the service worker redraws it (canvas, 16 and 32px) whenever items, the theme or Chrome's light/dark mode change, and at the time the badge or sweep would next visibly change (`chrome.alarms`). It reads everything from storage on each event, since workers stop when idle.
- **Floating UI:** popovers, lists and tooltips use the browser's top layer (Popover API), so the glass layering can't hide them.

### Testing

`npm test` runs 275 unit tests covering countdown math and formatting, date and time parsing, the calendar, recurrence (DST, month ends, leap years), numbering, categories (grouping, order, assignment, undo), `.ics` export and import (round trips, time zones, RRULE mapping, EXDATE and moved occurrences, RFC 5545 line rules), duplicate detection, calendar links, storage validation and backends, the store's actions and undo, multi-panel sync, selection and import. Exported rules are cross-checked by expanding them with ical.js. The suite is run in several time zones (`TZ=Europe/London npm test`, `TZ=Asia/Kolkata npm test`, …) because date bugs hide there.

Accessibility is checked with axe-core against every main screen in light and dark mode (WCAG 2.2 AA: 0 violations).

## Troubleshooting

- **The panel doesn't open:** make sure the extension is enabled, then click its toolbar icon (pin it first). Chrome 123+ is required.
- **Changes don't show up:** rebuild, click reload on the extension's card, and reopen the panel.
- **A calendar link won't import:** use the *iCal* address, not the calendar's web page; private Google calendars need the *Secret address in iCal format*. If you declined Chrome's permission prompt, try again and choose Allow.
- **Times look off after importing:** check the source calendar's time zone; Countdown converts each event to your local time.

## Known limitations

- Share links would need a server, so they aren't built. Keeping everything on your device matters more to me.
- Notifications and account sync are out of scope.
- Calendars are imported once; there is no automatic refresh of a subscribed link.
- Exotic recurrence rules ("second Tuesday", hourly) import as a fixed stack of their next 6 occurrences.

## Behaviour reference

- **Bottom sections.** Two collapsible sections sit below the upcoming list, and each remembers whether it was open:
  - **Overdue:** items whose time has passed without being completed. Due items show "Overdue" in red; Starts items show "Started". Started events go here rather than in Completed so the completion stats only count things you actually checked off.
  - **Completed:** newest first, each showing the exact time it was completed and its original date. **Mark as not done** moves an item back to the list and drops its completion record. **Clear** removes completed items from the list but keeps their records for stats. Both can be undone. The list shows 20 at a time.
- **Appearance.** Mode follows the system by default; System's label says what it currently resolves to. Seven colour themes: Indigo (default), Lagoon, Fern, Orchid, Dune, Graphite and Clear. Each was measured before it went in: countdown numbers stay above 4.5:1 over the worst case of the theme's own background glows, button text passes on its gradient, and the accent stays well away from the red that means Overdue. Dune (amber) needed two adjustments for that: dark text on its buttons, and Overdue in crimson instead of red. Clear uses solid surfaces with no glass; every theme switches to solid surfaces automatically when the system's Reduce transparency setting is on.
- **Toolbar icon.** The icon is the Sweep mark in your colour theme, drawn light or dark to match Chrome's toolbar. With **Time left on toolbar icon** on (the default), its wedge shows the share of time left until your next upcoming item, measured from when you added it (or, for a repeating item, from its previous occurrence), with a badge such as `3d`, `5h` or `45m` and a hover title like "Assignment 3 due in 2 days". It never shrinks to nothing, so "almost due" stays visible. Turn it off in Appearance if a shrinking countdown is stressful; the icon then stays still with no badge. The store and extensions-page icons are fixed Indigo images.
- **Categories.** With no categories the panel is one list, as before. Once you add one, the upcoming list splits into sections in your chosen order, each sorted soonest first, with uncategorised items under **Other** at the end. Overdue and Completed stay as single lists across all categories, with each row keeping its category's colour.
  - A category colours its rows' countdown boxes and adds a stripe to each tile. The eight colours are tuned so every one meets WCAG AA in both themes; there's no free colour picker because arbitrary colours can't guarantee that.
  - Moving a stack moves the whole series, including occurrences generated later. A category belongs to the whole series, so changing it from any occurrence (its editor, dragging it, or Move to category) moves them all. Overdue occurrences are the exception: they move on their own.
  - Categories aren't exported to .ics; calendar apps have no shared field for them.
- **Per-item units.** Clicking a countdown box cycles that item's unit (Days → Hours → Minutes → Seconds, then back to the header's unit). A box in its own unit shows a small label. These choices are for quick checks and last for the session; the header unit stays the default. The clock ticks every second whenever any box shows seconds.
- **Live countdowns.** Click the unit label (**Days → Hours → Minutes → Seconds**) to change every box at once; the choice is remembered. Boxes update every second in Seconds mode and on each minute boundary otherwise. Items move to Overdue the moment their time passes.
- **Countdown values.** Countdowns round down to whole units. Under one unit, the box shows `<1`. Values up to 9,999 show in full with commas; larger values are abbreviated (`12.4K`, `2.6M`). The tooltip shows the exact time left.
- **Repeating items.** Any item can repeat: Daily, Every weekday, Weekly, Every 2 weeks, Monthly or Annually. It can end never, on a date, or after a number of times. Occurrences are grouped into one stacked tile headed by the next occurrence, labelled with the rule (e.g. "Weekly on Monday · until 31 December").
  - The panel keeps the next 6 occurrences generated and adds more as earlier ones are completed or pass. Occurrences that fell in the past while the panel was closed are skipped rather than flooding Overdue.
  - Monthly on the 29th–31st, and Annually on 29 February, fall on the last day of shorter months. Google Calendar skips those months instead.
  - Editing an occurrence's date or time changes only that occurrence. Changing the title or type updates the series, but not past or completed occurrences. Changing the repeat rule restarts the series from the next occurrence, and "Does not repeat" keeps just that occurrence.
  - Removing one occurrence skips it. Selecting all of a stack's occurrences turns the button into **Remove series**, which stops the series (with undo).
  - Rules are a subset of iCalendar RRULE, so they map directly to .ics import and export.
- **Custom dates.** Repeat › **Custom dates…** replaces the date button with chips for the chosen days, plus a calendar where clicking toggles a day and Shift-click adds a range. You can also type a date and press Enter. Past days can't be chosen. Every occurrence uses the item's time, and the stack reads "On N custom dates".
- **Weekly on chosen days.** Repeat › **Weekly on…** shows seven weekday toggles (at least one stays on). If the item's date isn't one of them, the first occurrence moves to the next chosen day.
- **Renaming one occurrence.** In an open stack, the pencil on an occurrence opens it on its own. Editing an occurrence of a repeating item shows **Rename: All upcoming | Only this one**. "Only this one" gives that occurrence its own title; later series renames and renumbering leave it alone, and it exports as its own event. Switching back to "All upcoming" returns it to the series title.
- **Previewing a repeat.** While creating a repeating item (or changing an item's repeat), a scrollable list shows every occurrence it will create, with its title and date: up to 50, or the next 10 for an endless series.
- **One time for a stack.** The open stack's **Time** field moves every upcoming occurrence to that time when the stack closes, including occurrences whose time was changed on their own, and future occurrences follow. Clearing it makes the series all-day.
- **Ends.** The Ends menu offers **Never ends**, **Until a date** (inclusive) and **After a number of times**.
- **Numbered titles.** When an item repeats, **# Number each occurrence** inserts `{n}` into the title, e.g. "Chapter {n} Homework" becomes Chapter 1, 2, 3… Hand-picked dates work too.
  - Select a number in the title first and the button replaces it and starts counting from it. You can also change **Numbered from** directly.
  - A live preview shows the next titles.
  - Numbers follow schedule position, so removing Chapter 2 leaves Chapter 3 as Chapter 3.
  - Editing a numbered series edits its template, and every upcoming occurrence is renumbered. Changing the rule restarts the series from the next occurrence, which keeps its number.
  - Custom-date and numbered series export as separate events, because one RRULE can't carry hand-picked days or changing titles. An endless numbered series exports its next 104.
- **Completing items.** "Complete" sits next to "Remove" in a tile's edit state and plays a short completion animation. Each completion is saved as its own record, so stats survive even if the item is later removed.
- **New items.** A new item defaults to tomorrow at 9:00 AM. If you leave it with an empty title, it's discarded.
- **Editing.** Changes save when the editor closes: press Escape, press Enter in the title, or click anywhere outside it. Clearing the time makes an item all-day. The time list runs in 15-minute steps and ends with 11:59 PM for end-of-day deadlines. Typed times accept `3pm`, `3:30 p.m.`, `15:00`, `1500`, `noon` and `midnight`; a bare number such as `9` is read as 24-hour time.
- **Undo.** Removing or completing shows a toast with Undo for 5 seconds. The timer pauses while you hover over or focus the toast, and Cmd/Ctrl+Z also undoes. A new toast replaces the previous one, and the earlier change stands.
- **Open stacks.** An expanded stack spans the full row. You can rename the series, switch Due/Starts for every occurrence at once, and complete or remove occurrences one at a time or in bulk with Select all and Remove selected.
- **Selection and export.** The Export button enters selection mode: a checkbox column slides in, Select all appears beside the unit label, and a bottom sheet slides up. Cancel, Done, Escape or the Export button again leave it.
  - Upcoming items and overdue items can be selected. A repeating stack is selected as a whole series. Completed items can't be selected.
  - **Google Calendar:** for one selected entry, opens Google's prefilled "new event" page. For several, it downloads an `.ics` file and links to Google's import page, because Google's link can only create one event.
  - **Download .ics:** works with Apple Calendar, Outlook and any RFC 5545 calendar.
  - **Move to category** (once categories exist): moves every selected item and stack, with a single Undo.
  - **Remove:** removes the selected items, and whole series, with a single Undo.
- **Importing.** Import opens selection mode with an import sheet. Drop an `.ics` file anywhere on the panel, use **browse**, or paste a calendar link (`webcal://` or `https://`; Google's "Secret address in iCal format", Apple's public calendar link, Outlook's published `.ics`).
  - Countdown asks for permission to read a link's site only when you fetch it, covering that host and its parent domain's subdomains, since calendar servers often redirect, e.g. to `pNN-caldav.icloud.com`. Plain `http://` links are upgraded to `https://`.
  - Upcoming events appear in the list, pre-checked, with an **Import** badge. Past events are hidden and counted. **Add selected** imports them with one Undo; Cancel or Escape discards the preview.
  - **Duplicates:** an event with the same title (ignoring case and spacing) and the same moment, or the same calendar UID, shows greyed out as **Already added**, unchecked. The UID check also catches re-importing a file this app exported.
  - **Times:** time zones defined in the file (Outlook) are applied exactly. Standard zone names without a definition (often Google) are converted using the browser's time-zone data. Common Windows zone names are mapped to standard ones.
  - Events become Starts items, to-dos with a due date become Due items, and Countdown's own exports restore Due vs. Starts.
  - **Repeating events:** a rule the app can represent (daily, weekdays, weekly on chosen days, monthly, yearly, with an end) becomes a real series that keeps generating. Skipped and moved occurrences are honoured for the imported occurrences. Other rules, such as "second Tuesday", become a fixed stack of their next 6 occurrences.
  - **Series from another time zone:** these follow that zone's clock, so a 9:30 IST meeting stays at 9:30 IST through your daylight-saving changes. They export with a `TZID` plus a generated `VTIMEZONE`.
  - Calendars up to 10 MB, showing the first 300 upcoming events.
- **Exported files.** Valid RFC 5545: CRLF line endings, lines folded at 75 bytes, a UID and DTSTAMP on every event.
  - Deadlines and start times are points in time, so events have no end time. All-day items are exported as all-day events.
  - One-off times are written in UTC. Repeating series use floating local time, so "10:00 every Monday" stays at 10:00 across daylight-saving changes. Due vs. Starts is kept in an `X-COUNTDOWN-TYPE` property so a later re-import can restore it.
  - A series exports as one repeating event from its next occurrence. Removed occurrences become `EXDATE`s, and moved occurrences become separate events.
  - Month-end rules use the simplest, most widely supported form. The 31st becomes "last day of the month" and 29 February becomes "last day of February", both exact. For the 29th or 30th, other calendars skip months without that day, whereas the app uses the last day.
- **Look and theme.** Surfaces use a frosted-glass material (translucent fill, backdrop blur, bright hairline edge) over a soft fixed gradient. Mode and colour are chosen in **Appearance**; the choice is saved, and the panel cross-fades between looks. Text contrast is checked against the most saturated part of the gradient. With *Reduce transparency* turned on in the OS, surfaces become solid.
- **Dates.** Dates always display as `Thursday, 29 October 2026, 3:00 PM`; typed dates use MM/DD/YYYY. Times are stored with their UTC offset and exported in UTC.
- **All-day events.** Items imported as all-day events show no time and count down to the start of that day.
