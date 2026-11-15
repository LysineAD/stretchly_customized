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

Break debt tracks the difference between the configured larger-break average and actual qualifying rest. Work earns debt at the configured schedule's rate; Long and Extended timer time and qualifying idle reduce it. Mini breaks are shown in break statistics but do not pay larger-break debt. Partial timer time counts as rest. Skip and Postpone add no separate penalty. Both debt and surplus carry across days. The previous debt model is reset when first opened with this version; daily statistics are preserved.

The forecast considers the next three larger breaks and allocates the projected shortage in proportion to their base lengths. For 4/4/12 minutes this gives 1:1:3. Each break receives at most six minutes of additional time; any remaining balance carries forward and is reforecast. Postponements, skips, idle, and other schedule changes trigger a fresh forecast.

An early qualifying AFK restarts the current interval and preserves the upcoming larger break. AFK that overlaps its due time or ends within one minute of it can fulfill that break if it meets the base duration. An absence that begins during a running Long or Extended break and lasts at least as long as that break also fulfills it, including when the break ends while away. A counter reset while the session is reported locked preserves the original absence start; an unlocked reset cannot reliably be distinguished from a return. An Extended-length absence starts a fresh reminder session. The next interval starts in full at the moment of return, and one absence can fulfill at most one scheduled break. Neither type of AFK reset clears unpaid rest: replanning discards the forecast plan but keeps the postponement balance, which is re-forecast at the next schedule change.
