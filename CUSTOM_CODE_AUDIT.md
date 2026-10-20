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
