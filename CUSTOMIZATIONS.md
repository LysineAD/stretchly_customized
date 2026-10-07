# Stretchly Customized: customization inventory

Updated: 2026-10-07. This file records the active feature contract for future edits and upstream updates. Source: [LysineAD/stretchly_customized](https://github.com/LysineAD/stretchly_customized), branch `trunk`. Upstream baseline: Stretchly **v1.22.1**.

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
| Advice readability | Existing advice font sizes, line heights and paragraph spacing retained. The fixed size was checked against all 3,095 bundled translated Mini/Long advice entries, with Start, Postpone and clock visible. Arbitrary custom text/images and small monitors can scroll within the fixed window. |
| Click-through | One checkbox applies to Window, Full screen and Compact. Background clicks pass to the application below; visible Start/Postpone/Skip controls and advice links receive clicks. Defaults off. |
| Monitor mirroring | The existing one/all-monitor selection remains. Manual-start reminders and Compact advice are replicated across selected monitors; one Start action starts them all with the same timestamp. |
| Manual start | Optional “Start breaks manually” mode shows a waiting reminder when due. Waiting does not consume break duration. Start button and shared global shortcut call the same action. Defaults off; changes apply to the next reminder. |
| One global break shortcut | Uses existing `endBreakShortcut`, default `CmdOrCtrl+X` (Ctrl+X on Windows). While waiting it starts; once running it performs the existing Postpone/Skip action and eligibility checks. Editable/clearable in Preferences, including combinations such as `Shift+X`. Invalid/unavailable combinations are rejected without replacing the previous saved value. Registered while a break is displayed. |
| Auto-start waits | Three independent sliders used in manual-start mode: Mini 0–120 seconds (default **20**), Long 0–900 seconds (default **60**), Extended 0–1,800 seconds (default **120**). **0 means wait indefinitely**. A reminder shows the remaining wait; button/shortcut can start earlier. The full configured break duration follows Start. |
| Strict mode and tray | On-window Skip remains hidden in strict mode; existing on-window Postpone rules remain. The tray menu is always accessible, including intentional **Skip current break**, Pause, Preferences and Quit. Quit is no longer prevented by strict mode. |
| Preferences | Bounded, resizable window with scrolling and sticky navigation. Settings has two cards; Schedule has Mini, Long, Extended and Strict cards. Two columns normally, one on narrow windows. Every existing schedule, notification and Postpone control retained. |
| Notifications | Existing before-break notification switches, lead times and normal behavior remain independent of manual start and auto-start waits. |
| Other upstream options | Manual finish, clock, health mode, images, audio, idle/DND handling and advanced preferences are retained. These are upstream features; Extended adapts the relevant options to its third break type. |
| Branding/delivery | Windows executable/product name is Stretchly Customized. Builds are delivered locally; generated binaries, profiles and check artifacts are excluded from Git. |

A 20-second Mini break with a 20-second auto-start wait lasts at most 40 seconds from the reminder appearing if the user takes no action. Starting earlier shortens only the wait. Postpone still applies its original scheduling behavior.

## Iterations and obsolete behavior

| Stage | Record |
| --- | --- |
| Original Extended fork, 2026-07-06 | Commit `872a94b`: third break type and integration, based on `523649f`. Originally named stretchly_extended_breaks. |
| Upstream refresh / display customization, 2026-10-06 | Commit `971879f`: integrated upstream v1.22.1, Compact and all-size click-through, renamed Windows product. The GitHub fork was later renamed to stretchly_customized with history retained. |
| First manual-start version, 2026-10-07 | Commit `6ee3480`: Start button, mirrored waiting/countdown and a separate global Start shortcut. |
| Display readiness fix, 2026-10-07 | Wait for renderer presentation and native first-frame readiness before showing Mini, Long or Extended windows. Addresses an initialization race; the separately reported intermittent black-window flash is not yet attributed conclusively. |
| Usability revision, 2026-10-07 | Replaces variable Compact sizing with fixed bounds; replaces separate Start shortcut with the existing break shortcut; adds three auto-start sliders, accessible strict tray actions, scrolling/cards and this inventory/update guide. |

Old `startBreakShortcut` settings are ignored; no separate Start shortcut is registered. Old `showTrayMenuInStrictMode` is ignored because the tray is always available. Old saved keys may remain in profiles without affecting behavior. Do not reintroduce either old behavior when merging upstream.

## Where future edits belong

| Area | Files |
| --- | --- |
| Scheduling / third break type | `app/breaksPlanner.js`, `app/utils/scheduler.js`, `app/main.js`, `app/utils/statusMessages.js` |
| Display / mouse routing | `app/utils/breakDisplaySettings.js`, `breakWindowPresentation.js`, `breakPresentation.js`, `app/css/break.css` |
| Waiting / auto-start / shared key | `app/utils/breakStartController.js`, `breakStartControl.js`, `breakActionShortcut.js`, both break renderers, `app/main.js` |
| Preferences / defaults / labels | `app/preferences.html`, `preferences-renderer.js`, `css/preferences.css`, `utils/defaultSettings.js`, `locales/en.json` |
| Evidence / rebuilding | Regression tests under `test/`; Windows check scripts under `scripts/`; [update guide](UPDATING.md) |

Keep this inventory concise and update it whenever a customization changes. Exact build/test reports stay in the checkout's ignored `.scratch/` folder.
