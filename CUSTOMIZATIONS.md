# Stretchly Customized: customization inventory

Updated: 2026-10-20. This file records the active feature contract for future edits and upstream updates. Source: [LysineAD/stretchly_customized](https://github.com/LysineAD/stretchly_customized), branch `trunk`. Upstream baseline: Stretchly **v1.22.1**.

## Current app and settings

- Source checkout: `D:\Projects\Stretchly_Customized_source`.
- Ready-to-run Windows folder: `D:\Projects\Stretchly_Customized`; launch `Stretchly Customized.exe`. Keep the entire folder together.
- The app keeps the Stretchly application identity and existing settings. Typical installed settings are `%APPDATA%\Stretchly\config.json`; portable profiles can use a local `Data` folder. Do not reset settings during an update.
- Custom feature labels added in this fork are English; other locales fall back to English for those labels. Existing translated advice remains available.
- The retained upstream Windows startup option (“Launch at login”) is separate from the new break auto-start waits.

## Features to preserve

| Feature | Current behavior |
| --- | --- |
| Extended breaks | An optional third break type replaces every configured number of Long breaks. Defaults: enabled, 10 minutes, every third Long break. Own duration, cadence, notification, strict mode and Postpone settings. |
| Extended integration | Integrated with scheduling, counts, status/tray messages, Skip to next Extended break, pause/reset, idle/DND/exclusions and shortcut settings. Reuses Long-break advice, appearance and sound settings. |
| Display choice | Window and Full screen retained; Compact is a third choice for all three break types. Existing settings are preserved; Compact defaults off. |
| Fixed Compact window | **860 × 720 logical pixels** (Windows can add a few pixels through native DPI rounding), centered on each selected monitor. Same size for Mini, Long and Extended; no content-driven or Start-driven resizing. Only physically smaller work areas clamp the size, keeping a 16-pixel edge margin. |
| Display readiness | Break windows remain hidden until Compact styling, input setup, fonts and an initial rendered frame are ready. Fixed-size Windows DPI correction runs while hidden. |
| Advice readability | Original advice fonts, line heights and paragraph spacing retained. The tip has the main full-width area, with an independent scroll region for longer advice. Controls and the four-row statistics table remain visible. |
| Click-through | One checkbox applies to Window, Full screen and Compact. Background clicks pass to the application below; visible Start/Postpone/Skip controls and advice links receive clicks. Defaults off. |
| Monitor mirroring | The existing one/all-monitor selection remains. Manual-start reminders and Compact advice are replicated across selected monitors; one Start action starts them all with the same timestamp. |
| Manual start | Mini can open early. Long and Extended open when due and start automatically after 20 seconds. Start can begin the shared countdown sooner. |
| One global break shortcut | Ctrl+X dismisses the advance notice, postpones a waiting Long or Extended break, or performs the available action during a break. A separate configurable shortcut starts the next larger break early. |
| Auto-start waits | Mini keeps its preparation and Postpone slider. Long postpones for 2, 4, 6 minutes and so on. Extended postpones for 4, 6, 8 minutes and so on. The larger-break window always starts after a 20-second wait. |
| Strict mode and tray | Strict mode hides on-window Skip. The tray retains intentional Skip, Pause, Preferences and Quit. Settings limits postponements per Long or Extended break. |
| Preferences | Bounded, resizable window with scrolling, settings cards, and controls for the Mini preparation delay, larger-break postponement limit and separate shortcut. |
| Notifications | Long and Extended show a small centered notice for three seconds, one minute before the scheduled break, when enabled. Mini keeps its existing notification. |
| Idle controls | The configured break durations determine the idle thresholds. Early idle restarts the current interval, and qualifying idle near a scheduled break fulfills it. Extended-length idle starts a fresh reminder session. The countdown resumes on return. |
| Statistics | Only Break time, Without delay %, Average stretch and Computer use are displayed, with Today and 7-day avg/day columns. Time totals are divided by seven; rates and stretch averages use their underlying seven-day samples. A small +N badge beside Postpone counts each press. Zero/one Postpone is normal; more, Skip or an early ending lower the one percentage. No lifetime, longest-stretch, type breakdown, current-work headline or planned-interval display. Only seven dates persist, in both main and backup files. See [STATISTICS.md](STATISTICS.md). |
| Break debt | The current 120 active minutes are the forecast window. Unpaid time persists, with additions distributed proportionally across the next three larger breaks. See [STATISTICS.md](STATISTICS.md). |
| Other upstream options | Manual finish, clock, health mode, images, audio, idle/DND handling and advanced preferences are retained. These are upstream features; Extended adapts the relevant options to its third break type. |
| Branding/delivery | Windows executable/product name is Stretchly Customized. Builds are delivered locally; generated binaries, profiles and check artifacts are excluded from Git. |

One Postpone remains normal; the badge still shows +1. A second press shows +2 and makes the completed break delayed for the single percentage. Intentional Reset and Pause do not count as skipped outcomes. Auto-start runs on every reminder, with no auto-start/deadline text added to the window.

## Iterations and obsolete behavior

| Stage | Record |
| --- | --- |
| Minimal break window and recurring auto-start, 2026-10-20 | Removes the large status/header/footer and redundant metrics; restores auto-start after Postpone; limits history and backup to seven days. Supersedes the previous manual-only returns and lifetime retention. |
| Early preparation, two-stage idle and statistics, 2026-10-19 | Replaces the earlier idle modes and separate delay sliders; adds the first-preparation exception, manual-only returns after Postpone, and bounded local daily/weekly statistics. |
| Original Extended fork, 2026-07-06 | Commit `872a94b`: third break type and integration, based on `523649f`. Originally named stretchly_extended_breaks. |
| Upstream refresh / display customization, 2026-10-06 | Commit `971879f`: integrated upstream v1.22.1, Compact and all-size click-through, renamed Windows product. The GitHub fork was later renamed to stretchly_customized with history retained. |
| First manual-start version, 2026-10-07 | Commit `6ee3480`: Start button, mirrored waiting/countdown and a separate global Start shortcut. |
| Display readiness fix, 2026-10-07 | Wait for renderer presentation and native first-frame readiness before showing Mini, Long or Extended windows. Addresses an initialization race. |
| Partial idle reset and repeatable postponement, 2026-10-16 | Three idle modes, per-type delay sliders and unlimited postponements. Custom-code audit recorded in [CUSTOM_CODE_AUDIT.md](CUSTOM_CODE_AUDIT.md). |
| Configurable idle handling, 2026-10-13 | Adds the threshold slider and reset/preserve option using the existing monitoring toggle. Preserved countdowns include the qualifying idle period and survive notification transitions. Extended-cycle progress remains intact in pause mode. |
| Usability revision, 2026-10-07 | Replaces variable Compact sizing with fixed bounds; replaces separate Start shortcut with the existing break shortcut; adds three auto-start sliders, accessible strict tray actions, scrolling/cards and this inventory/update guide. |

Old `startBreakShortcut` settings are ignored; no separate Start shortcut is registered. Old `showTrayMenuInStrictMode` is ignored because the tray is always available. Old `naturalBreaksIdleMode` and `naturalBreaksResetOnIdle` settings are also ignored. Old saved keys may remain in profiles without affecting behavior. Do not reintroduce either old behavior when merging upstream.

## Where future edits belong

| Area | Files |
| --- | --- |
| Scheduling / third break type | `app/breaksPlanner.js`, `app/utils/scheduler.js`, `app/main.js`, `app/utils/statusMessages.js` |
| Idle handling / cycle recovery | `app/utils/naturalBreaksManager.js`, `scheduler.js`, `app/breaksPlanner.js`, `statusMessages.js`; regressions in `test/idleBreaks.js` and `scripts/check-idle-breaks.mjs` |
| Display / mouse routing | `app/utils/breakDisplaySettings.js`, `breakWindowPresentation.js`, `breakPresentation.js`, `app/css/break.css` |
| Waiting / auto-start / shared key | `app/utils/breakStartController.js`, `breakStartControl.js`, `breakActionShortcut.js`, both break renderers, `app/main.js` |
| Preferences / defaults / labels | `app/preferences.html`, `preferences-renderer.js`, `css/preferences.css`, `utils/defaultSettings.js`, `locales/en.json` |
| Statistics | Only Break time, Without delay %, Average stretch and Computer use are displayed, with Today and 7-day avg/day columns. Time totals are divided by seven; rates and stretch averages use their underlying seven-day samples. A small +N badge beside Postpone counts each press. Zero/one Postpone is normal; more, Skip or an early ending lower the one percentage. No lifetime, longest-stretch, type breakdown, current-work headline or planned-interval display. Only seven dates persist, in both main and backup files. See [STATISTICS.md](STATISTICS.md). |
| Evidence / rebuilding | Regression tests under `test/`; Windows check scripts under `scripts/`; [update guide](UPDATING.md) |

Keep this inventory concise and update it whenever a customization changes. Exact build/test reports stay in the checkout's ignored `.scratch/` folder.
