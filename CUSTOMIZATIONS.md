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
| Manual start | Start button and the shared global shortcut start the full break on all monitors together. In manual-start mode, the first preparation reminder appears early and auto-starts at the original deadline; each postponed return also auto-starts after its configured wait. Zero waits indefinitely. |
| One global break shortcut | Uses existing `endBreakShortcut`, default `CmdOrCtrl+X` (Ctrl+X on Windows). While waiting it starts; once running it postpones whenever enabled; otherwise it uses the existing Skip eligibility checks. Editable/clearable in Preferences, including combinations such as `Shift+X`. Invalid/unavailable combinations are rejected without replacing the previous saved value. Registered while a break is displayed. |
| Auto-start waits | Three sliders set preparation lead and Postpone delay: Mini 0–120 seconds (default 20), Long 0–900 (default 60), Extended 0–1,800 (default 120). After Postpone the window hides for that delay, returns and starts a fresh auto-start wait. A positive value is also saved to the corresponding PostponeTime setting; zero retains its legacy Postpone delay. |
| Strict mode and tray | On-window Skip remains hidden in strict mode; enabled Postpone stays available throughout the break and can be repeated without a count limit. The tray menu is always accessible, including intentional **Skip current break**, Pause, Preferences and Quit. Quit is no longer prevented by strict mode. |
| Preferences | Bounded, resizable window with scrolling and sticky navigation. Settings and Schedule use cards and two columns, switching to one column when narrow. One preparation/Postpone slider per type replaces the separate Postpone-delay sliders. Existing enable-Postpone switches remain. |
| Notifications | Existing before-break notification switches, lead times and normal behavior remain independent of manual start and auto-start waits. |
| Idle controls | The existing monitoring checkbox enables two thresholds. Short idle (1–60 minutes, default 5) restarts the whole current Long cycle while retaining the upcoming Long/Extended ordinal. Long idle (2–180 minutes, default 30, always above Short) resets the entire schedule. Timers wait for activity. Recovery during a running break is deferred until it finishes; disabling monitoring releases an idle-paused countdown. Old three-mode/boolean settings are ignored. |
| Statistics | Only Break time, Without delay %, Average stretch and Computer use are displayed, with Today and 7-day avg/day columns. Time totals are divided by seven; rates and stretch averages use their underlying seven-day samples. A small +N badge beside Postpone counts each press. Zero/one Postpone is normal; more, Skip or an early ending lower the one percentage. No lifetime, longest-stretch, type breakdown, current-work headline or planned-interval display. Only seven dates persist, in both main and backup files. See [STATISTICS.md](STATISTICS.md). |
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
