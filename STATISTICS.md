# Statistics in break windows

Every Mini, Long and Extended window shows the same figures. The prominent line is **Extra postpones N · Working Xm**. Advice keeps its original font; longer advice scrolls independently. Today and Last 7 days stay visible beside it, with lifetime totals below.

## What the figures mean

| Figure | Definition |
| --- | --- |
| Extra postpones | Postpone actions beyond the intended first preparation Postpone. That first action is normal only when taken before or at the original deadline. It adds zero extra postpones, skipped breaks or unfinished breaks. Each later action adds one extra. |
| Working | Tracked computer-use time in the current stretch. Waiting for Start and Postpone delays count as work; running break time, qualifying idle and intentional Pause do not. This is an estimate of computer use, not proof of productive work. |
| Break / away | Actual time under Mini, Long and Extended timers, plus qualifying idle. The four rows show the breakdown. Overlapping timer and idle time is credited once. Partial timer time still counts even if the break is later postponed or ended. |
| Without delay | Percentage of completed breaks whose first Start occurred by the original deadline plus one minute, with zero extra postpones. The normal first preparation Postpone is allowed. No completed breaks shows a dash. Long manual waiting can lower this percentage without inventing a Postpone click. |
| Skipped / early end | Separate counts: dismissed before starting / ended after starting but before its timer finished. Postpone itself counts as neither. Reset, system recovery and intentional Pause do not invent skips. |
| Average stretch | Mean tracked work duration of stretches ended by a completed break or qualifying idle. Waiting and Postpone work extend the stretch; timer time is excluded. The configured planned interval is shown nearby for comparison. |
| Longest stretch | Longest ended stretch in the period. The current unfinished stretch remains visible in the prominent line. |
| Computer use | Sum of tracked work time while this app is running, excluding running breaks, qualifying idle, intentional Pause, exclusion/DND pauses and system suspension. Idle shorter than the Short threshold remains included. Monitoring disabled means idle cannot be excluded. No keyboard, pointer, application or document history is collected. |

Today uses local calendar time. Last 7 days includes today and the previous six local dates. Time crossing midnight is split between dates; actions belong to their action date. Completed-break percentages and stretch summaries belong to their completion date. Lifetime shows cumulative Break / away and longest ended stretch. A restart retains totals but begins a new current stretch; time while the app is closed is never inferred.

Example: with a 20-minute interval and a one-minute Long lead, the reminder opens at 19:00. Postpone at 19:06 returns at 20:06 and requires Start. Starting at 20:10 records **zero extra postpones** and qualifies as without delay. A second Postpone records one extra. Waiting until 23:00 to Start records zero extra clicks but does not qualify as without delay.

## Storage and running cost

`stretchly-statistics.json` sits beside `config.json` in the current profile. It contains at most 366 daily summaries and one lifetime summary, with a recoverable backup and temporary replacement file. Each file is capped at 3 MiB; the three together remain below 9 MiB. Normal summaries are much smaller. Old daily details expire; lifetime totals remain.

Changes are combined into a save after five seconds, with a five-minute checkpoint during continued use and a flush on normal Quit. Abrupt termination can lose the latest unsaved interval. Windows read a shared statistics snapshot at most once per second while displayed; no new idle poller or graphics loop is added. The feature does not scan files or processes. Delete the statistics files only while the app is closed if a clean history is wanted; leave `config.json` intact.

Model tests: `node --test scripts/check-statistics.mjs`. Native layout and packaged behavior must also pass the checks in [UPDATING.md](UPDATING.md) before a build is delivered.
