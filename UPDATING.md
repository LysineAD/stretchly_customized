# Update and rebuild Stretchly Customized

This guide keeps the custom features while integrating future upstream releases. Start by reading [CUSTOMIZATIONS.md](CUSTOMIZATIONS.md). Do not replace this fork with a fresh upstream checkout.

## 1. Prepare and merge upstream

Work in `D:\Projects\Stretchly_Customized_source`, branch `trunk`. Inspect the complete Git status and upstream divergence. Commit or separately preserve any local work before merging.

```powershell
git status --short --branch
git remote -v
git fetch origin
git fetch upstream --tags
git log -1 --oneline
```

The upstream remote is `https://github.com/hovancik/stretchly.git`. Check upstream's releases and select the latest stable release tag explicitly. The current integrated tag is **v1.22.1**. Merge the selected newer tag normally; do not reset, force-push or discard the fork history. For example, replace the placeholder below with the verified release tag:

```powershell
git merge <verified-release-tag>
```

Resolve conflicts against the inventory, especially `main.js`, scheduling, settings, renderers, Preferences, locales and package/build configuration. Retain the Extended type and Customized Windows product name. Read repository contribution instructions; upstream maintainer approval applies if proposing changes back upstream, not to updating this personal fork.

## 2. Validate and build

Use the Node/npm versions compatible with the selected upstream release; this revision was built with Node 24.15.0 and npm 12.0.2. Reinstall dependencies after lockfile changes.

```powershell
npm ci
npm run lint
npm test -- --coverage.enabled=false
npm run pack -- --win --x64
```

Run tests before packaging, sequentially: some tests modify fixture files. The Windows unpacked output is `dist\win-unpacked`; expect roughly 450 MB and a few hundred files. Routine validation/building takes a few minutes on this machine; re-estimate after major upstream changes. Do not commit `dist`, `node_modules`, `coverage` or `.scratch`. Do not bump the upstream version just for these local customizations.

Use these project scripts from the source root. Place the package path before flags:

```powershell
node scripts/check-packaged-start.mjs dist/win-unpacked
node scripts/check-manual-start.mjs dist/win-unpacked
node scripts/check-manual-start.mjs dist/win-unpacked --readiness
node scripts/check-manual-start.mjs dist/win-unpacked --auto-start
node scripts/check-manual-start.mjs dist/win-unpacked --strict-quit
.\node_modules\.bin\electron.cmd scripts/check-break-display.mjs dist/win-unpacked/resources/app.asar
.\node_modules\.bin\electron.cmd scripts/check-break-display.mjs dist/win-unpacked/resources/app.asar --manual-start
.\node_modules\.bin\electron.cmd scripts/check-compact-content.mjs dist/win-unpacked/resources/app.asar
```

These use isolated profiles under `.scratch`; they do not overwrite the user's settings. Manual-start checks expect two connected monitors and briefly show real break windows. The shortcut test sends **Ctrl+Alt+F24** to the isolated app. The readiness check records native paint and renderer-loaded events and rejects any window shown before both, for all three break types. The strict-Quit check uses a local main-process inspector to invoke the same Electron Quit action during each strict break and requires a clean exit. The display checks inspect Windows native mouse transparency and control routing; `--native-input` additionally moves/clicks the real pointer and should only be used when needed. Screenshots and JSON reports are retained under `.scratch`.

Completion checks:

- Fixed Compact bounds on both monitors before/after Start; all bundled advice fits without reducing fonts.
- Button, native shared shortcut and each auto-start delay start all selected monitors together.
- Waiting leaves progress full; after Start the full duration runs; the same shortcut then follows original Postpone/Skip rules.
- Existing Window/Full screen, click-through controls and notification behavior pass.
- Strict mode hides on-window Skip but tray Skip/Pause/Preferences/Quit stay available.
- All Preferences controls save, and the last Schedule control is reachable by scrolling.

## 3. Commit, publish source and replace the local app

Update the inventory, README and CHANGELOG for any changed feature or new upstream baseline. Inspect every task-owned path, run the checks, then make a coherent Conventional Commit and push normally to `origin/trunk`. Verify the remote HEAD and a clean, synchronized checkout. Do not upload build artifacts unless separately requested.

Quit the user's current app through its tray before replacing binaries. Back up its settings and any local `Data` directory when needed. Preserve `Data`; never delete the user's profile. Confirm the resolved destination is exactly `D:\Projects\Stretchly_Customized`, then copy the **contents** of `dist\win-unpacked` into that folder, replacing previous application files. Do not move/delete anything else in `D:\Projects`.

Verify delivered file counts/sizes and SHA-256 hashes of `Stretchly Customized.exe` and `resources\app.asar` against the built output. Confirm packaged app text matches the pushed source. Copy `CUSTOMIZATIONS.md` and `UPDATING.md` beside the executable, and write a local `BUILD_INFO.json` with the source commit, build date and executable/asar hashes. Run the startup/preferences smoke check against the delivered folder using its isolated profile. Launch the delivered executable normally only when the user wants the real app started.

Deliver the executable link, source repo link, and these two short guides. Keep the same app name/folder for routine updates.
