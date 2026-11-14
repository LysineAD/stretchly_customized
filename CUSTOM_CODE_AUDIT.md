# Custom code audit — 2026-10-16

Scope: the Extended, display/click-through, manual Start, auto-start, shared shortcut, tray, Preferences and idle customizations relative to upstream v1.22.1 (`d150ac4`), plus this revision. Unchanged upstream code was excluded. Codex performed the implementation and audit, including independent standards and specification review passes.

## Standards

No hard standard violation was established in the custom scope. The review suggested consolidating duplicated range-label updates; comparison with upstream showed this duplication was inherited, so it was left alone. The custom postponement scheduler now reuses the existing scheduling helper instead of maintaining a second notification/timer construction path. No broad rewrite was justified.

## Specification and correctness

- Fixed: notification/postponement transitions could infer the next type after cancelling the scheduler, losing an explicitly selected break type. Capture the type first and recognize active Mini/Long/Extended references. Repeated-postpone tests cover all three types and unchanged cycle counts.
- Fixed: duplicate Postpone messages from mirrored windows could schedule twice. Main-process handlers now require the matching current break and live window group; subsequent requests are ignored after closing that group.
- Fixed: contributor controls still advertised maximum postponement counts despite unlimited behavior. Removed those obsolete controls, relabeled the percentage setting for its remaining non-strict Skip effect, and aligned duplicate delay/idle slider ranges with main Preferences.
- Compatibility: no new enum default overrides existing reset/preserve preferences. The old boolean remains the fallback until a three-way idle choice is saved.
- Partial reset uses the configured full work interval, retaining next type and all cycle counts. With Mini disabled, it uses the configured Long interval. Notifications are scheduled normally again; no new cycle is consumed.

## Verification

Regression coverage includes all three idle modes, idle-onset preservation, notification transitions, long-only partial reset, legacy settings, repeated postponement, duplicate actions, strict tray/quit behavior, fixed Compact dimensions and manual start. Packaged checks exercise real Preferences saving, all idle modes, and repeated button/native-shortcut postponement on both monitors using isolated profiles. Build-specific counts, hashes and results are recorded in the delivered `BUILD_INFO.json`; diagnostic images/reports remain in ignored `.scratch/`.

This is a focused correctness and maintainability audit, not a claim that every custom path or every operating system is defect-free. Runtime verification targets the delivered Windows x64 app. Existing upstream structure and unrelated behavior were retained.

## Follow-up revision — 2026-10-19

Scope: early preparation, two-stage idle recovery, statistics and their interactions with existing custom Start, Postpone, Compact and mirrored windows.

- Keep one original deadline per break episode. A separate notification scheduler preserves OS notification lead times even when the preparation window appears earlier. Every Postpone cancels auto-start; subsequent windows require Start.
- Keep one statistics episode across repeated postponements. Exclude the intended first preparation Postpone; record additional clicks, actual timer time and completion separately. Daily summaries and a cached snapshot avoid an unbounded event log or per-monitor accounting.
- Correct short-idle recovery to restart the entire Long cycle and retain the upcoming Long/Extended ordinal. Long idle escalates within the same idle period. Defer recovery during a running break and release it when monitoring is disabled or activity returns.
- Fix integration edge cases: do not cancel a running break's statistics on idle recovery; do not resume statistics while another pause reason remains; exclude suspended time; isolate statistics-read failures from break presentation; retain a valid backup after corrupt-file recovery; wait for one final save on Quit.
- Remove obsolete idle-mode logic and duplicate Postpone sliders. Keep advice typography; separate its scroll area from the always-visible statistics and controls.

Automated coverage includes all three early leads, fixed deadlines despite late renderer readiness, repeated manual-only returns, independent notifications, idle-cycle ordinal preservation/escalation/deferred recovery, first-Postpone classification, timer/idle overlap, midnight/week boundaries, retention, backup recovery and Quit flushing. Packaged Windows results and layout screenshots remain a required delivery gate; record actual results in `BUILD_INFO.json`, without presenting model tests as native verification.

## Simplification — 2026-10-20

Removed the previous headline/status/footer and redundant metrics rather than hiding them. Advice again uses the full main width, with only four statistics rows and a Postpone badge. Auto-start is armed after each postponed return with a fresh wait, while the original first-reminder deadline remains fixed. Statistics now retain seven dates, discard lifetime/unused metrics, migrate old daily counters and rewrite the recovery backup from the pruned summary. Tests cover repeated auto-start, badge count, daily time averages, the combined outcome percentage and seven-day deletion/migration. The animation is a single short CSS effect with a reduced-motion override; no new animation or polling loop is added.

## Work record — 2026-11-14 (two local commits)

Scope: two reported bugs (tray Skip wiping time debt, and an AFK return showing 18 instead of 20 minutes), plus the final check that a day's total rest reaches the ideal average with random skips and postpones.

### Commit `2443ecb` — Skip debt neutrality and AFK return countdown

- `app/utils/breakDebt.js`: added `checkpoint()` and `rollback(snapshot)` so a break window can be erased from the ledger. `workBlock = 120 min`, `forecast`, `resolve`, `record` and `snapshot` were left unchanged.
- `app/utils/breakStatistics.js`: `start()` stores `episode.debtCheckpoint`; new `skip()` calls `advance()`, rolls back to that checkpoint, then `finish(false)` so the skip still counts toward Without delay % without being a debt event.
- `app/main.js`: `finishMicrobreak`, `finishBreak` and `finishExtendedBreak` now take `(shouldPlaySound = true, shouldPlanNext = true, options = {})`. With `options.skipped` they call `statistics.skip()` instead of `advance()` + `debt.resolve()` + `finish()`. `skipCurrentBreak()` passes `{ skipped: true }` for all three break types. `skipTo*`, `postpone*`, DND and app-exclusion paths were not changed.
- `app/breaksPlanner.js`: `captureIdle()` records `duringBreak` and `breakEndsAt`. `finishIdleRecovery()` computes `absence = Math.max(idleTime, returnedAt - period.from)` and `coversBreak` (idle started during a larger break, outlasted `breakEndsAt`, and lasted at least that break's duration). When covered, the fulfilled branch cancels the scheduler and calls `nextBreak()` from the return instant, restarting the full Mini interval. `idleRecoveryFinished` reports `fulfilled`.
- `app/utils/naturalBreaksManager.js`: added `absenceStart`, `pendingReturn` and `idlePeriodReported`. A return is confirmed on the following poll; when the OS idle counter resets during a lock/session glitch and then grows again, the same absence stays open instead of emitting a false `idlePeriodFinished`.
- Tests: new `test/skipDebtRegression.js` (extracts `skipCurrentBreak()` / `finishBreak()` from `main.js` via `runInNewContext`, asserts `debt.resolve()` is not called and the balance/postponement/plan survive) and `test/afkReturnRegression.js` (live settings with Mini enabled, full 20-minute restart, idle-counter reset, early-AFK guard). `test/idleBreaks.js` now advances two polls in `comeBack()` and expects the running-Long AFK case to be fulfilled. `test/breakDebt.js` gained checkpoint/rollback and reclassification audits.
- `scripts/check-idle-breaks.mjs` was rewritten around an isolated inspector: packaged idle thresholds, AFK-covered break, and Skip debt neutrality.
- `package.json`: added `!dist/**` to `build.files`, so a custom `dist/nov14-*` output cannot recursively pack earlier builds (the asar had grown from ~100 MB to ~930 MB).
- Docs: `CUSTOMIZATIONS.md`, `STATISTICS.md`, `CHANGELOG.md`, `README.md`, `UPDATING.md`.
- Profile: `stretchly-statistics.json` and its `.bak` both had `debt` zeroed after timestamped backups were taken; `version` and the seven-day history were retained. The app was closed at the time, so no save could overwrite them.

### Commit `31423f2` — Rate aligned with the ideal rest schedule

- `app/utils/breakDebt.js`: `breakDebtRate()` now divides one Extended cycle of rest by that cycle's real active length, `extendedBreakInterval × microbreakInterval × (breakInterval + 1)`, instead of a fixed 120 minutes. The `Math.min(12, …)` clamp was removed and missing settings fall back safely. `workBlock = 120 min` remains only the forecast horizon; `forecast`, `resolve`, `checkpoint`, `rollback` and `snapshot` are untouched.
- `scripts/check-break-average.mjs` rewritten from a report into an enforcing gate: 400 randomized setting sets plus 200 live-profile days with random skip/postpone, using the real `BreakDebt` ledger. It asserts rate alignment, `R + B = r·W` conservation, ideal daily coverage (with an upper bound against over-crediting) and a small deferred share; any failure exits 1.
- `test/breakDebt.js`: replaced hard-coded `/120` expectations with cycle-derived values; added five rate tests (sensitivity to each interval, Long breaks disabled → zero, incomplete settings fallback, live profile).
- `scripts/check-idle-breaks.mjs`: also asserts that the packaged `breakDebtRate` equals the schedule average, so the delivered binary is checked, not only the source.
- `scripts/check-preparation-statistics.mjs`: reconnects to break renderers recreated after Postpone/auto-start, and uses per-type synthetic intervals longer than the hard-coded 20-second auto-start wait. This is a harness fix, **not a delivery gate for this round**: it verifies break-window lifecycle, which neither commit touches, and it launches full-screen break windows. mini/long/extended passed on the build folder; the delivery-folder run was interrupted and deliberately not repeated.
- Docs: `STATISTICS.md` (rate definition rewritten, obsolete 120-minute audit note replaced), `CUSTOMIZATIONS.md`, `CHANGELOG.md`, `UPDATING.md`, `README.md`.

### Verification and delivery

- `npm run lint` clean; `npx vitest run --coverage.enabled=false --coverage.clean=false` 457/457 passed.
- Model gate: five PASS, rate mismatch 0.0%, conservation violations 0, live-profile ideal rest coverage 103.3% (105.7% including carried debt), unpaid at day end 2.4%. Before the rate change the same check reported 83.3%.
- Rebuilt into `dist/nov14-ratefix/win-unpacked` and copied over `D:/Projects/Stretchly_Customized`. `check-packaged-start.mjs`, `check-idle-breaks.mjs` and source `check-statistics.mjs` (12/12) pass against the delivered folder. `BUILD_INFO.json` records both commits, the new hashes, 457 tests, the checks actually run, the excluded check and the rollback path `dist/nov14-final/win-unpacked`.
- Both commits are local on `trunk`, ahead of `origin/trunk` by 2; **not pushed**. A manual tray check (Skip leaves debt non-zero; an AFK return shows 20 minutes) remains optional because automated and packaged checks cover both.

### Environment notes

- `.husky/pre-commit` pipes filenames into `xargs`; with a ~29 KB environment (mainly `CODEBUDDY_MCP_CONFIG`) Git Bash `xargs` aborts at startup with `bc_ctl.arg_max >= LINE_MAX`. Use `env -u CODEBUDDY_MCP_CONFIG git commit -m "..."`; never `--no-verify` / `HUSKY=0`.
- Packaged checks need `env -u ELECTRON_RUN_AS_NODE`; vitest needs `--coverage.enabled=false --coverage.clean=false` to avoid the sandbox bulk-delete guard.
- Documentation-only edits do not require a rebuild: markdown is not runtime code, and the delivered folder carries readable copies at its top level. Verification scope should follow whether a change participates in runtime behavior, not whether a repository file was touched.

## Work record — 2026-11-14 (debt persistence and proportional repayment)

Two user-reported bugs, both reproduced with a pure-Node script (no App launch): Total time debt fell to zero after Quit/restart, and a few minutes of postpone debt were charged entirely to the first Long break instead of being spread over the next three.

### Root causes

- `BreakDebt` has seven state fields. `serialize()` wrote only `balance`, `work`, `day` and `plan`; `postponement` was never saved and the constructor hard-set it to `null`. `snapshot().current.debtTotal` is `Math.max(0, balance, postponement?.earned ?? 0)`, so the visible debt after postponing was held up by an in-memory value that vanished on restart. A pure-Node trace showed 2.40 min before restart → 0.40 min after (or 0.00 min when earlier rest had left a credit). The live profile file confirmed the missing `postponement` key; its `plan` was `[73874, 73874, 221622]`, exactly 1:1:3.
- `forecast()` computed a correct proportional plan (`[0.8, 0.8, 2.4]` for 4/4/12) and then returned `Math.max(this.plan[0], this.postponement?.earned ?? 0)` as the payment. That `Math.max` bypassed the plan and handed the whole postponement debt (60% of the three-break total) to the returning break. It came from an earlier intentional rule, documented as "adds at least its earned rest to the returning break", which contradicted the three-break proportional feature list.
- `main.js` `idleRecoveryFinished` called `debt.replan()` without arguments, clearing the postponement along with the plan on an AFK-fulfilled break or AFK reset.

### Changes (commit `fix(breaks): persist postponement debt and spread repayments`)

- `app/utils/breakDebt.js`: `serialize()` now emits `postponement: { from, earned }`; the constructor restores it with finite/positive sanitising, so older profiles without the field start with none. `forecast()` uses `required = Math.max(shortage, postponement?.earned ?? 0)` and returns `payment = this.plan[0]`, so postpone work is still guaranteed to be repaid but is distributed by the three larger breaks' base lengths. `checkpoint()` / `rollback()` already covered the new persisted field; `resolve()`, `replan()`, `rollDay()`, `recognizeIdle()` and `breakDebtRate()` are unchanged.
- `app/main.js`: `idleRecoveryFinished` uses `replan({ preserveDelay: true })`.
- `test/breakDebt.js`: the "adds extra work at the first returned break" expectation changed from 105000 to 75000 (1.75 min split 15:3:3) and now asserts the full `[75000, 15000, 15000]` plan. Five new tests cover restart round-trips with and without an earlier credit, malformed persisted postponements, replan preservation and the 1:1:3 split.
- `scripts/check-break-average.mjs`: `let debt` is rebuilt from `serialize()` after every simulated cycle, and the gate now also fails on any restart loss or any payment exceeding `plan[0]`. Seven assertions total.
- `scripts/check-idle-breaks.mjs`: the isolated inspector now also reloads the packaged `BreakDebt` from a saved snapshot and asserts the restored postponement, unchanged visible debt, `payment === plan[0]` and the 1:1:3 ratio.
- Docs: `STATISTICS.md`, `CUSTOMIZATIONS.md`, `README.md`, `CHANGELOG.md`, `UPDATING.md`.
- Not persisted by design: `recent` spans (bounded to the last hour, and `observeIdle` clamps to `startedAt`), `previousDay` (reconstructed by `rollDay` on the next `record`), and `episode.debtPayment` (the break window itself is not restored). The live profile's already-lost postponement amount is not reconstructed from invented numbers.

### Verification and delivery

- `npm run lint` clean; full vitest 462/462; model gate seven PASS (rate mismatch 0.0%, conservation 0, restart losses 0, over-charged breaks 0, live coverage 105.6% incl. carried debt, unpaid 2.4%).
- Packaged checks: `check-packaged-start.mjs`, `check-idle-breaks.mjs` (including the new packaged debt assertions) and source `check-statistics.mjs`. `check-preparation-statistics.mjs` is intentionally not a delivery gate for this round: it launches full-screen break windows and touches no code changed here.
- Rebuilt into `dist/nov14-debtfix/win-unpacked` and copied over `D:/Projects/Stretchly_Customized`; `BUILD_INFO.json` updated with the hashes, commit, test count and checks actually run. Local commit on `trunk`, **not pushed**.
