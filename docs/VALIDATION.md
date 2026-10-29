# Native release qualification

Run separately on Windows 10/11 x64 + WebView2, Hyprland + WebKitGTK 4.1, and Ubuntu
GNOME Wayland + WebKitGTK 4.1. Record OS/runtime versions, keyboard layout, scale factor,
compositor modifier bindings, package hash, observed result and any reproducer. Do not
mark a platform passed based on browser unit tests or a successful build alone.

1. Start installed package offline: empty dark workspace, no former layout. Start it again
   and use Ctrl+Alt+N: each window is empty and independent. Close one without affecting the other.
2. Add tabs/splits; reject a split below minimum without converting it to a tab. Resize via
   mouse and keyboard. Maximize/restore preserves ratios and the tab strip.
3. Hold Alt, move focus with arrows and type in the focused editor after release. Switch to
   another app while Alt is down; return and confirm normal typing. Test AltGraph on a layout
   that uses it. Repeat with Control/Shift; no OS-global hook should be needed.
4. Drag panel grips while holding Alt; release Alt before mouse release. Confirm center swap,
   four edge placements, tab center merge, tab edge detach (including own panel), reorder,
   invalid outside drop, and tree collapse when the last tab moves/closes.
5. Open UTF-8 LF and BOM+CRLF fixtures using the native picker and OS file drop. Drop at
   100% and high DPI scaling onto different panels; the target receives tabs. Open the same
   canonical path again: focus the existing instance. Exercise clipboard and IME composition.
6. Save, Save As, cancel picker, read-only directory/file and disk write failure: no silent
   modification or lost local edits. Save unchanged BOM+CRLF and byte-compare the result.
7. Edit then close tab, whole panel and native window. Test Save/Discard/Cancel, picker
   cancellation and failed save. When editing continues during Save, newer edits must still
   require a decision. Only the closing window's documents should be involved.
8. Externally edit and atomically replace a clean file: auto-reload. Do it while dirty:
   preserve local edits, show conflict; Save As preserves them, Reload requires confirmation.
   Delete/rename the source: display an error and keep editor content. Repeat with two
   Tessera windows/processes saving the same original revision: a stale save must fail.
9. Type continuously for several seconds, then terminate the test process unexpectedly.
   Restart: empty layout plus recoverable-content offer, not automatic restore. Recover,
   verify recent checkpoint text, Save As, close normally, restart and confirm no stale offer.
   Leave a second process alive: its checkpoints must not be offered as crashed content.
10. Open binary, invalid UTF-8, mixed-ending and >64 MiB files: explicit rejection, unchanged
    originals. Open ~1 MiB and ~4 MiB text: lightweight indicator, usable editing and undo;
    switch tabs and verify content. Test long lines as well as many short lines.
11. Disconnect networking before launch. All workspace, editor and file actions remain local.
    Inspect native process sockets separately from OS WebView runtime background behavior.
12. Record cold/warm startup, idle CPU/RSS (including webview children), 1/10/30 editors,
    drag/resize responsiveness and close/disposal changes. No arbitrary numeric pass threshold;
    investigate regressions and resource growth. Repeat installation/removal on a disposable
    machine; preserve user recovery data unless removal was explicitly requested.

## V0.2 terminal qualification

Run on Windows 10/11 (PowerShell 7, Windows PowerShell, CMD, Git Bash if installed) and on
both Wayland environments (Bash, Zsh, Fish where installed). Record shell versions too.

13. First launch with no shell setting: Settings shows detected shells and the system default.
    A new terminal starts that shell in the home directory (`pwd` / `Get-Location`). Choose
    another shell; only terminals opened afterwards use it. Uninstall/rename the chosen
    shell (or edit `shell.json` in the app config directory): a new terminal shows the
    missing-shell error and its one-off system-default start, never a silent substitution.
14. Interactive use: `cd`, `git status`, history (arrows), line editing, Tab completion,
    colors (`ls --color`, `Get-ChildItem`), Unicode/emoji/CJK output and IME input. Run
    `vim` and `htop` on Linux and an interactive console program on Windows; resize the
    panel while they run and confirm their layout follows.
15. Ctrl+C interrupts a running `ping`/`sleep`; with a selection it copies instead.
    Ctrl+Shift+C, Ctrl+Shift+V and (Windows) Ctrl+V; confirm Ctrl+Shift+V on WebKitGTK and a
    multi-line paste with bracketed paste. Scroll back through long output with the wheel.
16. Two terminals hold different state (`cd` and a variable in one, not visible in the
    other). Move a running terminal tab to another panel, to an edge split and back while
    `ping` runs: same PID (`echo $$` / `$PID`), no restart, output continues.
17. Exit the shell (`exit 2`): the tab reads `(exited)` and the code is shown; nothing
    restarts. Close a terminal tab while a child runs (`sleep 1000`, `ping -t`): check with
    `ps`/Task Manager that the shell and child are gone. Close the window and quit Tessera
    with several terminals open: no shell, child, conhost/OpenConsole or PTY leaks.
18. Stress: `yes | head -c 200M`, `cat` of a large file, `Get-ChildItem -Recurse C:\` —
    the UI stays responsive, output order holds, Ctrl+C interrupts, memory stays bounded.
    Open and close ~50 terminals rapidly and compare process/handle counts before/after.
    Hide a busy terminal behind another tab, return, and confirm output was not lost
    beyond the 5,000-line scrollback.

## Known implementation limits

- Mixed/CR-only endings and non-UTF-8 encodings are rejected, not converted.
- File replacement preserves permission bits, not all ACL/owner/extended metadata. Validate
  platform-specific expectations before treating this as a production-safe general editor.
- Cooperating Tessera writers are locked. A non-cooperating external program can still
  race the final filesystem check/replace; no filesystem-level compare-and-swap is claimed.
- Per-second snapshots can lose the most recent interval/in-flight edit on process death.
- Parser measurements are Node-based. Native rendering/memory thresholds need target tests.
- Terminal processes that detach from their terminal (daemons, `nohup`, `start`) are not
  tracked and can outlive the tab. Windows has no Job Object containment.
- Terminal scrollback (5,000 lines) and backpressure thresholds are provisional, not measured.
- The Windows installer requires preinstalled WebView2. Linux packages are not yet produced
  or installed in this environment; CI build checks are not a substitute for Wayland smoke.
