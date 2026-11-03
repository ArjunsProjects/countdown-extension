# Countdown design system

This document describes the visual language of Countdown so it can be rebuilt in Figma (or any tool) and kept in sync with the code. Every value here lives in [`src/styles/tokens.css`](src/styles/tokens.css); components reference tokens only, never raw values.

**Figma setup:** create one variable collection, *Countdown*, with two modes, **Light** and **Dark**. Each `--color-*` / `--glass-*` row below becomes a color variable with a value per mode; type, spacing, radius and size rows become number variables (single mode). Name variables after the token without the leading dashes (e.g. `color/text-muted`).

## Principles

- **Calm and legible first.** One accent color, neutral greys, and red only for overdue and destructive actions.
- **Glass over a soft gradient.** Floating surfaces are frosted and translucent; the background is a fixed, low-saturation gradient that the glass blurs.
- **Every state has a shape, not just a color.** Overdue items also move to their own section and say "Overdue"; selected tiles get a ring and a checked box.
- **Motion explains change** (things slide in from where they come from) and is short; with *Reduce motion* it is removed, never required.

## Color

Semantic tokens, written once as `light-dark(<light>, <dark>)`. Light/dark follows the system unless the user picks a theme in the header.

### Text

| Token | Light | Dark | Use |
|---|---|---|---|
| `color-text` | `#1b1c1f` | `#eceef2` | Titles, body text |
| `color-text-muted` | `#474b54` | `#b9bcc4` | Dates, secondary labels |
| `color-text-subtle` | `#585c66` | `#a9adb6` | Meta lines, hints, placeholders |
| `color-text-disabled` | `#8b8f98` | `#6e727a` | Disabled controls (exempt from contrast rules) |

### Colour themes (palettes)

Seven palettes, chosen in the Appearance menu. Each sets a handful of primitives in `tokens.css` (`--p-accent-*`, `--p-grad-*`, `--p-bg-*`, `--p-glow-*`, plus `--p-on-accent-*` and `--p-danger-*` where they differ); everything else is derived. Values below are light / dark.

| Palette | Accent | Gradient | Countdown numbers (worst case) | Buttons | Notes |
|---|---|---|---|---|---|
| Indigo (default) | `#3451d1` / `#a3b2ff` | `#3a54d6 → #6a46d4` / `#8fa2ff → #b79cff` | 4.57 / 4.90 | 6.1 | |
| Lagoon | `#0a6378` / `#7fd3e6` | `#0b7d96 → #2f5fcf` / `#7fd8ea → #97b4ff` | 4.91 / 5.47 | 4.8 | Furthest from Overdue red (171°) |
| Fern | `#256b45` / `#8fd8ad` | `#2a8458 → #11737a` / `#8fdcae → #7ccfd0` | 4.75 / 5.42 | 4.6 | |
| Orchid | `#7a2ec4` / `#d4aaff` | `#7a3ae6 → #b0349c` / `#c7a3ff → #f0a6dc` | 4.80 / 5.14 | 5.5 | 92° from Overdue red |
| Dune | `#8a5200` / `#f2c27c` | `#e09a2c → #c9772a` / `#f5cd86 → #f2a77a` | 4.80 / 5.43 | 5.0 (dark text) | On-accent `#1b1c1f`; Overdue crimson `#a3124f` / `#ff9dbc` |
| Graphite | `#3f4a5c` / `#c8d0dc` | `#4f5a6e → #262d3a` / `#dfe4ec → #a7b2c4` | 6.28 / 5.99 | 6.9 | |
| Clear | Indigo's | Indigo's | 5.58 / 6.12 | 6.1 | Solid surfaces, no glows |

Rules a new palette must pass (measured the same way as the rest of this page): accent on its 10%/14% tint over glass over every combination of its glows ≥ 4.5:1; on-accent text on both gradient stops ≥ 4.5:1; the light/dark accent on the opposite mode's toast (the Undo link) ≥ 4.5:1; and the accent hue at least ~60° from the danger red, or the palette moves danger instead (as Dune does). Rejected: red and pink accents (they compete with Overdue) and yellow (can't reach contrast in light mode without turning brown).

### Accent, danger, focus

| Token | Light | Dark | Use |
|---|---|---|---|
| `color-accent` | `#3451d1` | `#a3b2ff` | Countdown numbers, links, quiet buttons, selection |
| `color-accent-hover` | accent + 18% black | accent + 25% white | Hover on accent text |
| `color-accent-edge` | accent @ 30% | accent @ 32% | Accent hairlines (import badge, candidate tiles) |
| `color-accent-subtle` | `#3451d1` @ 10% | `#a3b2ff` @ 14% | Countdown box tint, chips, Due tag |
| `color-accent-subtle-hover` | `#3451d1` @ 16% | `#a3b2ff` @ 22% | Hover on subtle accent |
| `color-on-accent` | `#ffffff` | `#0d0f1a` | Text/icons on accent fills and the accent gradient |
| `color-danger` | `#b3261f` | `#ff9d94` | "Overdue", Remove, errors |
| `color-danger-hover` | `#931e18` | `#ffb8b1` | Hover on danger text |
| `color-danger-subtle` | `#b3261f` @ 10% | `#ff9d94` @ 14% | Overdue box tint, error banners |
| `color-focus` | = accent | = accent | Focus ring |

### Categories

Eight colours for user categories. Each has a text/stripe colour (`--cat-<name>`) and a 10% (light) / 14% (dark) tint of it (`--cat-<name>-subtle`). A `.category--<name>` class sets `--cat` and `--cat-subtle`, and everything inside picks them up. The palette is fixed so every option passes AA; a free picker couldn't promise that.

| Name | Light | Dark | Countdown box, worst case (light / dark) |
|---|---|---|---|
| indigo | `#3451d1` | `#a3b2ff` | 4.57 / 4.76 |
| violet | `#7438c4` | `#c8a8ff` | 4.75 / 4.82 |
| pink | `#a0225e` | `#ff9fcd` | 5.04 / 5.10 |
| orange | `#954300` | `#ffb277` | 4.78 / 5.41 |
| amber | `#735400` | `#f0cc62` | 4.94 / 5.97 |
| green | `#22672e` | `#90d89c` | 4.86 / 5.56 |
| teal | `#09616b` | `#80d4de` | 5.03 / 5.50 |
| slate | `#4c5666` | `#b9c2cf` | 5.24 / 5.25 |

Measured like the rest of the palette: the colour on its own tint over glass over every combination of the three gradient glows. The 3px tile stripe is ≥ 5.25:1 against the tile (non-text needs 3:1). New categories take the first colour not already in use.

### Neutrals

| Token | Light | Dark | Use |
|---|---|---|---|
| `color-bg` | `#eef0f6` | `#0c0d12` | Page background (under the gradient) |
| `color-border` | `#141828` @ 8% | `#ffffff` @ 8% | Hairlines, input borders |
| `color-border-strong` | `#141828` @ 16% | `#ffffff` @ 16% | Hovered borders, drop zone dash |
| `color-surface-hover` | `#141828` @ 5% | `#ffffff` @ 7% | Hover on icon buttons and toggles |
| `color-surface-sunken` | `#141828` @ 4.5% | `#ffffff` @ 5% | Segmented control track, muted badges |
| `color-field` | `#ffffff` @ 70% | `#ffffff` @ 5% | Inputs and controls sitting on glass |
| `color-field-strong` | `#ffffff` | `#ffffff` @ 14% | Selected segment |
| `color-inverse-bg` | `#1b1c21` @ 90% | `#eceef2` @ 94% | Toast and tooltip |
| `color-inverse-text` | `#f4f5f7` | `#15161a` | Text on inverse surfaces |
| `color-accent-inverse` | `#a6b4ff` | `#2f49c4` | Toast "Undo" |

### Glass material

Every floating surface (tile, countdown box, editor, popover, sheet) uses the same recipe; only the fill strength varies.

| Token | Light | Dark |
|---|---|---|
| `glass-fill` (tiles, countdown boxes) | `#ffffff` @ 62% | `#1e202a` @ 55% |
| `glass-fill-hover` | `#ffffff` @ 80% | `#2a2d3a` @ 62% |
| `glass-fill-muted` (overdue, completed, duplicates) | `#ffffff` @ 40% | `#1e202a` @ 36% |
| `glass-fill-strong` (editor, popovers, sheet) | `#ffffff` @ 86% | `#1a1c24` @ 88% |
| `glass-edge` (1px border) | `#ffffff` @ 80% | `#ffffff` @ 10% |
| `glass-highlight` (inner top line) | inset 0 1px 0 `#ffffff` @ 95% | inset 0 1px 0 `#ffffff` @ 10% |
| `glass-blur` (backdrop filter) | blur 24px, saturation 170% | same |

Recipe: fill + backdrop blur + 1px `glass-edge` border + `glass-highlight` + a 0.5px `color-border` outer ring + `shadow-tile` (or `shadow-raised` for editor and popovers). In Figma: Background blur 24, layer fill as above, inner shadow 0/1/0 for the highlight.

With **Reduce transparency** on, fills become solid (`#ffffff` / `#1d1f27`) and blur is removed.

### Gradients

| Token | Value |
|---|---|
| `gradient-bg` | Three radial glows over `color-bg`, fixed to the panel. Light: periwinkle `rgb(122 140 255 / 0.38)` at top-left (60%×45%), lilac `rgb(206 150 255 / 0.32)` at top-right (55%×40%), mint `rgb(110 214 200 / 0.30)` at bottom (70%×45%). Dark: `rgb(79 99 230 / 0.32)`, `rgb(150 80 220 / 0.24)`, `rgb(20 150 140 / 0.20)`. Each fades to transparent at 70%. |
| `gradient-accent` | 135°, light `#3a54d6 → #6a46d4`, dark `#8fa2ff → #b79cff`. Primary buttons, completion check, selected calendar day, chosen weekdays. |

### Contrast

All text pairs meet WCAG 2.2 AA (4.5:1), measured at the worst case: all three gradient glows stacked at full strength, saturated by the blur, under the lightest glass fill. Countdown numbers on their tinted box: 4.57 (light) / 4.79 (dark); "Overdue" on its tinted box: 4.57 / 5.03; subtle text on muted glass: 4.76 / 4.90. Change a color, re-check.

## Typography

Inter (variable, bundled with the extension), falling back to the system UI font. Features `cv11`, `ss01` (single-storey *a*, open digits). Numbers in countdowns, dates and calendars use tabular figures.

Sizes are set in `rem` (shown here in px at Chrome's default 16px), so they follow the user's font-size setting.

| Token | Size / line height | Use |
|---|---|---|
| `text-xs` | 11 / 16 | Tags, badges, meta lines, chips |
| `text-sm` | 12 / 16 | Dates, field buttons, tooltips, hints |
| `text-base` | 14 / 20 | Body, tile titles, inputs, buttons |
| `text-md` | 16 / 24 | Editor title, sheet titles |
| `text-lg` | 20 / 24 | Countdown numbers (17px when 5+ characters) |
| `text-xl` | 24 / 32 | Empty-state heading |

Weights: 400 regular, 500 medium (titles, buttons), 600 semibold (countdowns, tags, headings). Tracking: −0.01em on countdowns and large headings; +0.04em on uppercase tags and the unit label.

## Spacing, radii, sizes

8px grid with 4px half-steps: `space-0-5` 4 · `space-1` 8 · `space-1-5` 12 · `space-2` 16 · `space-3` 24 · `space-4` 32 · `space-5` 40 · `space-6` 48.

Radii: `radius-sm` 8 (inputs, buttons) · `radius-md` 14 (tiles, boxes, editor, popovers) · `radius-lg` 20 (bottom sheet top corners) · `radius-full` (pills, chips, calendar days).

| Token | Value | Use |
|---|---|---|
| `size-icon` | 20 | Icons (16 inside fields and small buttons) |
| `size-icon-button` | 32 | Header buttons, field height |
| `size-countdown-col` | 72 (60 under 360px) | Countdown column |
| `size-row-min` | 64 | Minimum row height |
| `size-focus-ring` | 2 | Focus outline, 2px offset |

Minimum interactive target: 24×24 (WCAG 2.2 SC 2.5.8).

## Elevation

| Token | Light | Dark |
|---|---|---|
| `shadow-tile` | 0 1 2 `#141828`@6% + 0 10 24 −18 `#141828`@35% | 0 1 2 black@30% + 0 10 24 −18 black@70% |
| `shadow-raised` | 0 2 6 `#141828`@6% + 0 16 40 −12 `#141828`@28% | 0 2 6 black@30% + 0 16 40 −12 black@65% |

Floating layers (calendar, time list, tooltip) render in the browser's top layer, above everything.

## Layout

- Panel width ~360px; everything works from **320px** (Chrome's minimum side-panel width). Under 360px the countdown column narrows to 60px and tile padding to 12px.
- Page padding 16px; rows 8px apart.
- Each row is a three-column grid: **[selection checkbox 0→24px] [countdown 72px] [tile, flexible]**, 8px gaps. The header uses the same grid so the unit label sits exactly above the countdown column and Select all above the checkboxes.
- The header is sticky and frosted. Bottom sections (Overdue, Completed) follow the upcoming list. The bottom sheet overlays the bottom of the panel; the list gains bottom padding equal to the sheet's height.

## Components

| Component | Anatomy | States |
|---|---|---|
| **Header** | Select-all (selection mode) · unit label · New item, Import, Export, Appearance | Unit label cycles Days → Hours → Minutes → Seconds; Import/Export pressed while their sheet is open; New item disabled in selection mode |
| **Appearance menu** | Popover from the palette button: title · Mode (three-way segmented: "System (light)", Light, Dark) · Colour (seven 28px swatches, native radios) · "Time left on toolbar icon" switch with a hint · "Sync with your other computers" switch with a live status line ("Up to date as of 3:05 PM", "Syncing…", or what's wrong) and, for 30 days after the first sync, a quiet "Restore this computer's list from before sync" | Swatch: the palette's gradient with a check in its on-accent colour; Clear is a solid disc ringed in its accent; selected gets a 2px gap and a muted ring. Changes cross-fade the panel |
| **Switch** | Checkbox with `role="switch"` drawn as a 36×22 track and 16px knob (Chrome has no native switch yet) | Off: strong border colour · On: accent gradient, knob in on-accent colour, slides 14px · Forced colors: system colours |
| **Toolbar icon** | The Sweep mark: frosted tile (palette glows), white or near-black disc with a faint accent ring, accent-gradient wedge, hub. Drawn at 16 and 32px | Light or dark to match Chrome · wedge = share of time left (min 6%, resting 75% when off or nothing's due) · badge in the accent colour |
| **Countdown box** | Number in `color-accent` on accent-tinted glass; in list rows it's a button | Normal · hover (stronger tint) · pressed (scale 0.97) · own unit (small uppercase unit label under the number, `text-xs` semibold) · long (17px) · `<1` · Now (accent gradient, or the category colour, with "Now"; tooltip says when it ends) · Overdue (red on danger tint) · Started / Ended (muted) · Completing (accent gradient, check draws, sparks) · Completed (check icon) |
| **Tile** | Title · Due/Starts tag · date or time range ("12:30 – 2:00 PM", kept on one line with no-break spaces) · location (pin icon, muted) · notes (one line) · meta line (repeat rule, Import badge) | Default · hover (`glass-fill-hover`) · pressed (scale 0.99) · past/completed (`glass-fill-muted`, muted title) · selected (accent tint + 1.5px accent ring) · import candidate (accent hairline) · duplicate (muted, subtle text, "Already added") |
| **Stack** | Tile + up to two peeking layers (7px steps, 94% / 88% width) | Closed · open (full-row stack editor: Time – End time for every occurrence; Location for every occurrence; occurrence rows with checkbox, title, date · time · relative time, Edit / Complete / Remove) |
| **Editor** | Title (+ "Rename: All upcoming / Only this one" for an occurrence of a series, + numbering row) · Due/Starts · date · time · Ends (events: "Ends" label, duration, remove; end date and time below) or "Add end time" · repeat · location (pin icon) · notes · Complete / Remove | Opens with a 200ms fade-scale; saves on Escape, Enter in the title or location, or click outside |
| **Date picker** | Field button → popover: month header, 7×6 grid, "Or type a date" field | Today ringed · selected filled with accent gradient · outside days subtle · disabled days (multi-date) greyed · error under the field |
| **Multi-date picker** | Date chips (×) · "Add or remove dates" → same calendar, multi-select, count, typed add, Done | Click toggles, Shift-click adds a range |
| **Time field** | Clock icon + text input (combobox) → 15-minute listbox | Active option accent-tinted; invalid input red ring + message |
| **Repeat** | Repeat select · (Weekly on… → 7 weekday toggles) · (Custom dates → multi-date picker) · Ends select (+ count or date) | Weekday toggles: pressed = accent gradient |
| **Title numbering** | "# Number each occurrence" pill → "Numbered from [n]" + stop | An inline preview of the next three titles appears only where no occurrence list is shown |
| **Occurrence preview** | Bordered list: count heading, then rows of title (full width) over date | Up to 50 rows (next 10 if endless); scrolls past 200px |
| **Bottom sheet** | Grabber · title + count · content · Cancel / primary | Slides up 240ms, down on exit |
| **Export sheet** | 2×2 actions: Google Calendar, Download .ics, **Move to category** (chevron; opens a menu of categories and Other; only when categories exist), Remove (red; spans the row when it's the odd one out) · note after an action | Actions disabled until something is selected |
| **Import sheet** | Drop zone (dashed) · link field + Fetch + hint · or summary (source, counts, Change) | Drop zone accent when a file is dragged over · loading spinner · red error banner |
| **Category section** | Header: chevron · dot (`--cat`, 2px `--cat-subtle` halo) · name · count (collapsed: "· next in 3 days") · **+** · **⋯**. Rows below; dashed "Drag items here" box when empty | Collapsed (chevron −90°) · drop target (`--cat-subtle` fill, 1.5px `--cat` inset ring) · being dragged (50% opacity) · insert line (3px accent above or below). **Other** has no menu and can't be collapsed or moved |
| **Category row** | Countdown box tinted `--cat-subtle` with `--cat` number; 3px `--cat` stripe on the tile's left edge, inset 12px top and bottom | Overdue and Started keep their own colours; completed rows keep the stripe |
| **Category editor** | Popover: Name · Colour (8 × 24px swatches in one row, radiogroup) · Move up / Move down · Delete category · hint | Selected swatch: check icon + 2px ring offset by 2px; saves on Enter, Escape or click outside |
| **Add split button** | **+** (new item) joined to a 24px **▾** → menu: New category · New item · New item in each category | Menu items keyboard-navigable with arrows |
| **Drag ghost** | Inverse pill following the pointer: title · "→ target" | Appears after 6px of movement; the panel auto-scrolls within 48px of its edges |
| **View menu** | Header button (list or calendar icon) → menu: List · Day · 3 days · Week (wide only) · Month (`menuitemradio`, check from `aria-checked`) · Open calendar in a tab | Keyboard opens on the current view, a pointer leaves focus on the button; the check shows for 300ms before closing |
| **Calendar toolbar** | Previous · Today (secondary) · Next · range title · category filter (filter icon) | The title shortens ("3 – 5 Nov") under 300px, with the full range kept for screen readers; the filter is accent-tinted while categories are hidden |
| **Time grid** | Glass card: day headings (weekday, date; today in an accent-gradient circle) · all-day row (bars spanning their days) · scrolling body, 48px per hour (`--cal-hour`), 40px hour gutter, hour lines, accent now-line with a dot | Opens an hour before now (today) or at 7 AM, via `scroll-initial-target` |
| **Calendar event** | Block: title (up to 2 lines) · time ("9:30–11 AM") · place; the category colour on its tint over glass with a 3px stripe | Upcoming · now (ring) · past/done (muted, done struck through) · moment (one line, ring for deadlines) · continued from yesterday (square top). Under 64px tall: one title line, no place; under 30px: title only |
| **Month view** | The date picker's grid, 52px days with up to 3 category dots (titled chips over 520px) · the selected day's agenda as rows (time · title, place) | Selected day: accent gradient, dots turn white |
| **Event details** | Popover: tag · category · close / title / when / status ("Starts in 7 days", "Happening now · ends in 40 minutes") / place / repeat / notes / Complete (or Mark as not done) · Edit | Focus moves in on open and back to the event on close |
| **Toast** | Message · "· Undo" | 5s, pauses on hover/focus, sits above the sheet |
| **Tooltip** | Inverse pill | 400ms hover delay; immediate on keyboard focus |
| **Empty state** | Ring illustration (draws in) · heading · text · New item (primary) · Import calendar (secondary) | "Nothing on the clock" or "All caught up" |

Buttons: **primary** (accent gradient, `color-on-accent`) · **secondary** (glass) · **quiet** (accent text) · **danger-quiet** (red text) · **subtle** (muted text) · **icon** (32px, 28px small).

## Motion

| Token | Duration | Use |
|---|---|---|
| `duration-instant` | 80ms | Hover and press color changes |
| `duration-fast` | 120ms | Tooltips, popovers, small fades |
| `duration-base` | 200ms | Editor open, checkbox slide, unit change, theme cross-fade |
| `duration-slow` | 240ms | Bottom sheet, selection column, occurrence fan-out |

Easing: `ease-out` cubic-bezier(0.2, 0, 0, 1) for entrances; `ease-in-out` cubic-bezier(0.4, 0, 0.2, 1) for exits and collapses.

| Animation | Timing |
|---|---|
| Selection mode | Checkbox column 0 → 24px, 240ms ease-out; checkboxes fade/slide in 8px after 60ms; sheet slides up 240ms. Exit reverses. |
| Editor open | Fade + scale 0.98 → 1, 200ms |
| Popover | Fade + 4px slide from its anchor's side, 120ms |
| Stack open | Occurrences fade/slide 8px, staggered 20ms each |
| Completion (1000ms) | 0–350ms box fills with the accent gradient and pops (scale 1.08); 100–400ms check draws; 150–650ms six sparks burst outward; 250ms title strikes through; 700–1000ms row fades and collapses |
| Toast | Slides up 12px + fade, 240ms |
| Unit change | Numbers and label fade up 4px, 200ms |
| Drag | Nothing animates while dragging; the drop target and insert line switch instantly so they track the pointer. Dropping shows a "Moved to …" toast with Undo. |
| Theme change | Whole-panel cross-fade, 240ms (View Transitions) |
| Empty state | Fade up 6px, 240ms; ring draws 900ms |

**Reduce motion:** durations drop to 1ms, every keyframe animation is disabled, completion is instant, the theme cross-fade is skipped and the spinner slows down.

## Accessibility

- WCAG 2.2 AA, checked with axe-core on every main screen in light and dark mode (0 violations).
- Text sizes are in `rem`, so the panel follows Chrome's font-size setting (Settings › Appearance) and, where supported, the OS text scale (`<meta name="text-scale">`). Checked at 16, 20 and 24px roots at 320px wide: no clipping or sideways scrolling. Countdown numbers cap their size to their box with container units (`min(1em, 50cqi)`), so large text never overflows it.
- Forced colors (Windows High Contrast): glass surfaces keep their 1px border; states drawn with shadows or accent fills (selected tiles, chosen days and weekdays, checked boxes, drop targets, the selected swatch) switch to system `Highlight`. Category stripes and dots keep their colour as the only category cue.
- The page declares `<meta name="color-scheme" content="light dark">`, and a forced light/dark theme is applied by a small blocking script in `<head>` (`theme-init.js`; extension pages can't run inline scripts) so the panel never flashes the other scheme while it loads. "System" in the theme button's label says what it currently resolves to.
- Full keyboard use: every control is reachable; the calendar supports arrows, Home/End and PageUp/PageDown (Shift: a year); the time list supports arrows and Enter; Escape closes the innermost layer; Cmd/Ctrl+Z undoes from the toast.
- Visible 2px focus ring on everything focusable; focus returns sensibly after closing editors, popovers and sheets, and moves to the next tile after Remove or Complete.
- Tiles are named by their visible text, icon buttons by `aria-label` (with a matching tooltip), and countdown boxes describe the exact time left. Unit changes and selection counts are announced politely.
- Drag and drop always has a keyboard route: the **Category** field in the item and stack editors, and **Move up / Move down** in a category's menu. Escape cancels a drag. After deleting a category, focus moves to the category that took its place.
