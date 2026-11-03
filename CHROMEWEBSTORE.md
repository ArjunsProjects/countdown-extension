# Chrome Web Store Listing — Countdown

> Last Updated: 2026-11-03

Everything the Chrome Developer Dashboard asks for, ready to copy.

**Live listing:** https://chromewebstore.google.com/detail/countdown/feeppdmbpeckhalnfnaflppcjadpceia (item ID `feeppdmbpeckhalnfnaflppcjadpceia`)

## Store Listing

**Extension Name**
Countdown

**Short Description** (matches manifest.json's description; 114 of 132 characters)
See how long you really have until every deadline and exam. Live countdowns and a calendar in Chrome's side panel.

**Detailed Description** (plain text; the store strips Markdown)

```
Countdown shows exactly how long you have left until every deadline and event, right in Chrome's side panel.

I made it for myself. If your brain works a bit like mine (a little ADHD, maybe), it's hard to feel how close something really is when it's just a block on a calendar. "Due Friday" doesn't land the way "2 days left" does. So I built a simple panel that sits beside whatever I'm working on, pulls in my calendar, and turns every deadline and exam into a live countdown. No more digging through my calendar to work out how much time I've got.

Countdown is made by one person. There's no account, no server, no analytics and no tracking: your list lives in Chrome, and moves between your computers through Chrome sync.

WHAT IT DOES
• Live countdowns in days, hours, minutes or seconds, for deadlines and events
• Events with an end time and a place, which show Now while they're happening
• A calendar: day, 3-day and month views in the side panel, and a full week in its own tab. Click to add an event, and drag to move it
• Reminders before deadlines and events, even with the side panel closed, with Mark done and Snooze right in the notification
• Syncs between your computers through Chrome sync, with nothing to sign up for, and merges your lists instead of overwriting them
• Brings in your calendar: .ics files or Google, Apple and Outlook calendar links, with duplicates spotted for you
• Colour-coded categories for each course, project or trip, with drag and drop
• Repeating items, like weekly homework numbered Chapter 4, 5, 6 and so on
• A toolbar icon that shows the time left until your next deadline (you can switch this off if it stresses you out)
• Seven colour themes in light and dark, full keyboard support, and screen reader friendly

GETTING STARTED
1. Pin Countdown and click its icon to open the side panel.
2. Click + to add a deadline, or Import to bring in your calendar.
3. Use the arrow next to + to make categories, then drag items into them.
4. Turn on Reminders in the Appearance menu (the palette icon) for a heads-up before each deadline.

YOUR PRIVACY
Everything you add is stored in Chrome on your computer, and Chrome sync carries it to your other computers signed in to the same Chrome profile (you can turn this off in Countdown's Appearance menu). None of it is ever sent to me or anyone else, and there's nothing to sign up for. Countdown asks for no access to websites when you install it. If you turn on reminders, Chrome asks whether Countdown may show notifications; they're shown on your computer, and nothing is sent anywhere. If you import a calendar link, Chrome asks whether Countdown may read that one site, and that's the only site it ever contacts.

FROM ME
Countdown is a one-person project, built and looked after by me. If something's broken or you have an idea, I'd love to hear it: https://github.com/ArjunsProjects/countdown-extension/issues

I hope it helps you as much as it helps me.
Arjun
```

**Category**
Productivity › Workflow & Planning

**Single Purpose**
Shows the user's own deadlines and events as live countdowns and on a calendar, in Chrome's side panel, and reminds them before they happen.

**Primary Language**
English

## Graphics & Assets

| Asset | Dimensions | Status | Filename |
|-------|-----------|--------|----------|
| Store Icon | 128×128 PNG | ✅ Ready | `public/icons/icon-128.png` |
| Screenshot 1 | 1280×800 | ✅ Ready | `store-assets/screenshot-1.png` |
| Screenshot 2 | 1280×800 | ✅ Ready | `store-assets/screenshot-2.png` |
| Screenshot 3 | 1280×800 | ✅ Ready | `store-assets/screenshot-3.png` |
| Screenshot 4 | 1280×800 | ✅ Ready | `store-assets/screenshot-4.png` |
| Screenshot 5 | 1280×800 | ✅ Ready | `store-assets/screenshot-5.png` |
| Small Promo Tile | 440×280 | ✅ Ready | `store-assets/promo-small.png` |
| Marquee Promo Tile | 1400×560 | ✅ Ready | `store-assets/promo-marquee.png` |

### Screenshot Notes

Following the store's [listing guidance](https://developer.chrome.com/docs/webstore/best-listing): five full-bleed 1280×800 images with square corners, one feature each, a short headline and one line of text, a single callout pointing at the feature, and branding that matches the icon. Every panel image is a real capture of the current build, not a mock-up. Upload them in this order:

1. **Every deadline, counting down.** The panel docked beside a course page in Chrome, with the toolbar icon's "2d" badge called out.
2. **Colour-coded categories.** Mid-drag: "Flight to Lisbon → Personal", with the Personal section lit as the drop target.
3. **Repeats that number themselves.** A weekly "Chapter {n} Homework" series open, listing Chapter 4–9 with their dates.
4. **Bring in any calendar.** An import preview: three new events marked Import and one greyed out as Already added.
5. **Make it yours.** Lagoon (light) with Appearance open beside Orchid (dark), and three toolbar icons sweeping from 9d to 5h.

1.1.0 adds time ranges and locations, which only appear on events that have them, so these five screenshots are still accurate. 1.2.0 adds the calendar, the biggest new feature since launch, so a sixth screenshot of the week view in a tab (a class timetable works well) is worth adding; it isn't made yet.

The promo tile and marquee use the saturated accent gradient (not white or light grey), the logo and name, and little text, so they read at half size.

**Regenerating** after UI changes: with a build served by `vite preview --port 4173`, run `bash scripts/screenshots.sh`. `store-assets/scenes.mjs` loads each scene's data into the real panel and performs the interaction; `store-assets/render.mjs` composes the final images.

## Permissions Justification

| Permission | Type | Justification |
|------------|------|---------------|
| `sidePanel` | permissions | Countdown's whole interface is a side panel. Clicking the toolbar icon opens it beside the current page so the user can watch their countdowns while browsing. |
| `storage` | permissions | Saves the user's deadlines, events, repeat rules, categories, reminder choices, completion history and display settings locally on their device (`chrome.storage.local`), so they persist between sessions. With the user's sync setting on (default; Appearance → Sync with your other computers), a compact copy of their items, series, categories and settings goes in `chrome.storage.sync`, so Chrome sync carries it to the user's other computers signed in to the same Chrome profile. Nothing is sent to the developer or any other server. |
| `https://*/*` | optional_host_permissions | Not granted at install. Requested only when the user pastes a calendar link (for example a Google Calendar "Secret address in iCal format") and presses Fetch. Chrome then asks for that one site (and its subdomains, because calendar servers redirect between them, e.g. p52-caldav.icloud.com). The extension downloads that single .ics file, without cookies, to show an import preview. No other request is made to the site and no page content is read. |
| `alarms` | permissions | Redraws the toolbar icon at the moment its badge or countdown sweep should next change (for example when "3d" becomes "2d"), even while the side panel is closed. With reminders on, it also wakes Countdown at the time of the next reminder. No data leaves the device. |
| `notifications` | optional_permissions | Not granted at install. Requested only when the user switches on Reminders (Appearance → Reminders), and given back when they switch it off. Used only to show the reminders the user set for their own deadlines and events, at the times they chose (for example 1 hour before), with Mark done and Snooze buttons. Reminders are worked out on the device from the user's own list; nothing is sent anywhere. |
| `offscreen` | permissions | Extension background scripts can't read whether Chrome is in light or dark mode, so a small hidden page (offscreen reason MATCH_MEDIA) reports it, letting the toolbar icon match the toolbar it sits on. The page does nothing else and makes no network requests. |

Remote code: none. All JavaScript is bundled in the package; the extension never loads or evaluates remote scripts.

## Privacy & Data Use

### Data Collection

**Does the extension collect user data?** No.

The items, categories and settings the user creates are stored on their device. With sync on (the default, which users can turn off), they're also stored in `chrome.storage.sync`: Chrome's own sync, in the user's Google account, copied to the user's other computers signed in to the same Chrome profile. That counts as leaving the device, so the privacy policy says so, but it's the user's own Chrome sync; the developer never receives any of it. Calendar links are fetched directly from the calendar server the user chose; nothing is sent to the developer or any third party. Reminders are worked out on the device and shown there as Chrome notifications.

| Data Type | Collected? | Transmitted Off-Device? | Purpose | Shared with Third Parties? |
|-----------|-----------|------------------------|---------|---------------------------|
| Personally identifiable info | No | No | — | No |
| Health info | No | No | — | No |
| Financial info | No | No | — | No |
| Authentication info | No | No | — | No |
| Personal communications | No | No | — | No |
| Location | No | No | — | No |
| Web history | No | No | — | No |
| User activity | No | No | — | No |
| Website content | No | No | — | No |

### Data Use Certification
- [x] Data is NOT sold to third parties
- [x] Data is NOT used for purposes unrelated to the extension's core functionality
- [x] Data is NOT used for creditworthiness or lending purposes

## Privacy Policy

**Privacy Policy URL**
https://github.com/ArjunsProjects/countdown-extension/blob/main/PRIVACY.md

The source is [PRIVACY.md](PRIVACY.md). Keep it consistent with the Privacy & Data Use answers above; open the URL in a private window before submitting to confirm it loads.

## Distribution

**Visibility**: Public
**Regions**: All regions

## Developer Info

**Publisher Name** — set on your Chrome Web Store developer account (one-time US$5 registration)
**Contact Email** — mermenial@gmail.com (shown publicly; Google also sends policy notices here, so keep it monitored)
**Support URL** — https://github.com/ArjunsProjects/countdown-extension/issues
**Homepage URL** — https://github.com/ArjunsProjects/countdown-extension

## Version History

| Version | Date | Changes | Status |
|---------|------|---------|--------|
| 1.5.0 | 2026-11-03 | Reminders: a notification before deadlines and events, even with the side panel closed, with Mark done and Snooze. Defaults of 1 day and 1 hour before deadlines and 15 minutes before events, or a different time (or two, or none) per item or repeating series. Missed reminders show when Chrome starts, and things completed on another computer don't remind you. Adds the optional `notifications` permission, asked for only when reminders are switched on. Includes 1.4.0 | Draft |
| 1.4.0 | 2026-11-03 | Edit on the calendar: click or drag on empty time to add an event from a small popover (title, Due or Starts, category), drag events to move them, and drag the bottom edge to change when they end, with Undo. Alt and the arrow keys do the same from the keyboard. Includes 1.3.0 | Draft |
| 1.3.0 | 2026-11-03 | Sync between computers through Chrome sync: lists merge (never overwrite), duplicates are kept once, edits, completions and deletions (with Undo) reach every computer, and repeating series sync as rules. A switch and status in Appearance, and a 30-day restore of each computer's list from before its first sync. Short description no longer says the data stays on the device. Includes 1.2.0 | Draft |
| 1.2.0 | 2026-11-03 | A calendar: Day, 3 days and Month views in the side panel, and Week in a full tab. Repeating events show every occurrence, categories work as show/hide calendars, and clicking an event shows its details with Complete and Edit. Keyboard shortcuts while the calendar has focus. Includes 1.1.0 | Draft |
| 1.1.0 | 2026-11-02 | Events can have an end time and a location, set one at a time or for a whole repeating series. While an event is on, its box shows Now and it stays at the top until it ends. Imports keep calendar events' end times and locations, and exports and Google Calendar links carry them. Includes 1.0.1's changes | Draft |
| 1.0.1 | 2026-10-26 | Fix: a repeating event imported from another time zone that matches yours today but changes its clock rules later (for example Los Angeles vs British Columbia from November 2026) now keeps its source time. Warmer summary. Listing: personal description | Draft |
| 1.0.0 | 2026-10-24 | First release: live countdowns, repeating items, categories, import/export, seven colour themes, live toolbar icon | Published |

## Review Notes

### Releasing an update

1. Bump the version in `package.json` and `public/manifest.json` (`npm version <x.y.z> --no-git-tag-version` updates package.json and its lockfile). The store rejects a version that isn't higher than the published one.
2. Run `npm run package`, then `npm run check:extension` to load that exact build in Chrome and check the worker, toolbar icon and permissions.
3. In the developer dashboard, open Countdown › **Package** › **Upload new package** and upload `release/countdown-v<version>.zip`. Update the **Store listing** tab too if the description or images changed, then **Submit for review**.
4. If the update adds a permission that shows a warning, Chrome disables the extension for existing users until they accept it. Avoid that where possible: request it as an optional permission at the moment it's needed, as calendar-site access and notifications already are.
5. Add a row to Version History. Once approved, Chrome updates installed copies automatically within a few hours; installed data and settings carry over.

### Packaging
`npm run package` builds and writes `release/countdown-v<version>.zip` with `manifest.json` at its root. It refuses to package when manifest.json and package.json versions differ, or when the build contains source maps or the dev-only audit script. Bump both versions before every upload; the store rejects a version that isn't higher than the published one.

### Known Issues / Limitations
- Calendar links are imported once; there's no automatic refresh.
- Reminders appear only while Chrome is running, and only if the computer's own settings allow Chrome's notifications.

### Rejection History
None yet.
