# V103-17 packaged-build retest harness

Drives the **installed** NSIS build through the ten manual steps in
[`.scratch/v1.0.3/issues/17-packaged-build-retest-minimal.md`](../../.scratch/v1.0.3/issues/17-packaged-build-retest-minimal.md),
including the four steps that ticket listed as "a human has to do this": the native folder and
save dialogs, real Chinese IME input with candidate selection, and a real drag out of
Explorer.

This exists in the repository on purpose. The previous harnesses lived under
`test/*-verify/evidence/scripts`, were covered by a `.gitignore` rule, and vanished with
`799a03f` — the same way the fixture vault did. Keeping it in a session scratchpad would
repeat that. See `test/README.md` for the fixture rules that apply to this directory too.

## Layout

| Path | What it is |
| --- | --- |
| `lib/cdp.mjs` | Minimal CDP client (no deps): eval, waitFor, DOM clicks, key events |
| `lib/app.mjs` | App-specific helpers: launch, native dialogs, tree snapshot, screen math |
| `lib/osinput.ps1` | Scan-code `SendInput` keys, real mouse, window placement, IME switch |
| `lib/uia.ps1` | UI Automation for the Windows common dialogs |
| `lib/explorer.ps1` | Locates a file row inside an open Explorer window |
| `lib/recyclebin.ps1` | Reads the Recycle Bin (item 9 must trash, not delete) |
| `s0*.mjs` | One scenario per group of steps; each prints `[step] {...}` lines |
| `evidence-s0*.json` | What the 2026-11-06 run actually recorded |

`lib/` is path-agnostic. The `s0*.mjs` scenarios hard-code two paths — the installed exe
(`D:\software\nextTypora\NextTypora.exe`) and a vault copy next to the script — so change
those two constants before reusing them elsewhere.

## Running it

1. Build a **current** installer and install it. Do not trust whatever is already in
   `release/`: on 2026-11-06 the installer there predated `fe0d9e8` and still carried the old
   company string, while `win-unpacked` next to it did not.
2. Copy `test/e2e-vault/` somewhere outside the repository and point the scenario at the copy.
   Editing it in place dirties the fixture.
3. Run one scenario at a time, from this directory:
   `cmd /c "node s02-open-and-about.mjs > s02.log 2>&1"`
   Each scenario reconnects over CDP port 9333, so the app stays up between them.

## Traps this harness already pays for

- **Attach to the renderer, not the splash.** The app opens a `data:` URL splash window first
  and closes it once the renderer is ready. Attaching to the first page target makes every
  later `Runtime.evaluate` hang for the full timeout. `waitForTarget` skips `data:` targets.
- **Be DPI aware.** UI Automation reports physical pixels; a DPI-virtualized process reads
  window rects and moves the cursor in logical ones, so at 125% every click lands 25% off.
  Both `.ps1` files call `SetProcessDpiAwarenessContext` before measuring anything.
- **Click in-app elements through the DOM.** A coordinate `Input.dispatchMouseEvent` on a
  file-tree row did nothing even though `elementFromPoint` at that exact centre returned the
  row. `domClickByText` uses `el.click()`. Context menus are the exception — a synthetic
  `contextmenu` event does not open the antd Dropdown, so those need a real OS right-click.
- **The editor needs a real click to take focus.** `pm.focus()` plus a selection range is not
  enough; `Input.insertText` then goes nowhere. Click the `.ProseMirror` for real, then type.
- **Dialog control ids are not interchangeable.** In the folder picker `AutomationId 1` is the
  Select-Folder button; in the save dialog `1` is *also* a file-list row, and the file-name box
  is `1001`, reported as a `Pane` whose ClassName is `Edit` (searching by `ControlType.Edit`
  finds list columns and sets nothing — which once let a Save run with the default name).
  Find by id, prefer the match whose ClassName is `Button`, and read the name box back.
- **Find the dialog by window class, not by focus.** `#32770` owned by the app's pid appears
  before focus moves, so a focus-based probe reports the app window and the keystrokes meant
  for the dialog go into the app.
- **Never type blind.** `osinput.ps1 -Action keys` takes `-ProcessId` and refuses to send when
  the foreground window does not belong to it. An unguarded Alt+F4 goes wherever the user is.
- **With a Chinese IME active, a letter keystroke starts a composition and swallows the next
  chord.** This produced a false "Alt+F4 saves but will not quit" result: the app had never
  been asked to close. Switch the window to `00000409` for such a step and switch back.
- **Check liveness with `Get-Process`.** The `windows` action prints nothing for a process with
  no visible window and still exits 0, which makes a liveness check say "still running"
  forever. Use `-Action alive`.
- **Run node through `cmd /c "... > log 2>&1"`** and set `[Console]::OutputEncoding` to UTF-8
  in the `.ps1` files, or Chinese window titles arrive as mojibake exactly where the diagnosis
  is. Keep the `.ps1` sources ASCII and UTF-8 **with BOM** (PowerShell 5.1 reads a BOM-less
  script as the ANSI code page).
- **Close the CDP socket.** A scenario that finishes without `cdp.close()` keeps node alive and
  looks like a hang.
