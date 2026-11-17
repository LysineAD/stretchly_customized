# Break-window statistics

The tip occupies the main area. A small break-type label, timer/controls and four statistics rows complete the window. Postpone has a +1, +2 badge counting presses in this break; the badge appears when its reminder returns, with a short CSS animation that respects reduced-motion settings. No postpone duration or scheduled-start text is shown.

| Row | Today | 7-day avg/day |
| --- | --- | --- |
| Break time | Actual timer and qualifying-idle time combined, without overlap. | Combined time across today and the previous six local dates, divided by seven. |
| Without delay | Completed breaks with zero or one Postpone, divided by all resolved breaks. Additional postponements, skips and early endings count against the percentage. | The same rate across all resolved breaks in the seven-day window. |
| Average stretch | Mean ended work stretch, excluding running breaks, qualifying idle and Pause. | Mean of all ended work stretches in the seven-day window. |
| Computer use | Tracked time while the app is running, excluding breaks, qualifying idle, Pause, suspension and schedule exclusions. | Seven-day total divided by seven, including inactive days as zero. |

A dash means no applicable breaks or work stretches yet. Computer use is an estimate, not proof of productive work. Short idle below the configured threshold remains computer use; idle cannot be excluded when monitoring is disabled. Waiting and Postpone delays count as computer use. Partial timer time is retained even if a break is later postponed or ended.

Only seven local calendar dates are retained in `stretchly-statistics.json` beside the profile's `config.json`. Older dates, lifetime totals and removed metrics are discarded on load and while running. Both the main file and its recovery backup are rewritten with the pruned data; records are never inferred for time while the app is closed. Existing daily records within seven days migrate automatically. No input or application history is recorded.

Storage remains bounded and local. Changes are combined into a five-second save, with a five-minute checkpoint and normal-Quit flush. The backup contains the same current seven-day summary; abrupt termination may lose the newest unsaved changes. Break-window figures refresh at most once per second, sharing the main-process snapshot across monitors.

Postponed active work earns debt at the configured cycle's larger-break average. Skipping a Long or Extended break adds its earned base portion, less base time actually taken. Reset adds the combined-rate obligation for active work since the last completed larger break, less any current base rest. Earlier completed breaks are not carried forward as credit.

Debt is allocated to the next three larger breaks in proportion to their configured base durations. The returning postponed break is included. Each break receives at most six additional minutes; unpaid or unallocated debt carries forward. Only actual time spent beyond a break's base pays its assigned share. Positive debt from the previous model and daily statistics are retained on migration; its negative balance is not carried over.

Qualifying idle can pay only the next larger break's assigned share, and only the idle time exceeding that break's configured base duration. A shorter Long-length absence in an Extended interval resets the current interval but cannot pay the Extended share; the earned Extended portion of the interrupted work remains owed. An Extended-length absence can fulfill that break and reset the session. Unpaid debt remains until actually served. Idle that starts after a break window opens, including its auto-start wait, does not fulfill or shorten that break. The complete timer, including assigned debt, runs normally. If that idle reaches the Extended threshold, the whole session resets after any running break finishes; unpaid debt is preserved. If the computer is inactive when any break ends, the next countdown waits for user activity; this post-break wait also applies when natural-break monitoring is disabled. Detection uses the operating-system idle counter.
