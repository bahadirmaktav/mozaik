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
7. Edit then close a tab, a panel's last tab and the native window. Test Save/Discard/Cancel, picker
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

## V0.3 File Manager qualification

Run on Windows 10/11 (NTFS system drive plus a USB/exFAT drive and, if available, a
network share) and on at least one Linux desktop per required environment (record
distribution, desktop, file systems and mount points). Do not generalize one distribution's
Trash or opener behavior to all of Linux.

19. A new File Manager opens in home; a second one is independent (navigate one, Back stays
    disabled in the other). Back/Forward/Up, breadcrumb clicks, Ctrl+L with Enter/Escape,
    `~`, `D:` and `\\server\share` (Windows) or `/mnt/...` (Linux). Unreadable folders
    (`/root`, `C:\System Volume Information`) show an error and keep the current listing.
    Move the panel and switch tabs: location, history, sort and selection remain.
20. Open a folder with 50,000+ entries and a slow/USB drive: the UI stays responsive while
    loading, scrolling is smooth, Ctrl+A/filter/sort remain fast. Navigate away while a slow
    folder loads: the newer folder wins. Record memory and listing time.
21. Hidden files: dotfiles on Linux, Hidden-attribute files on Windows (and dotfiles stay
    visible on Windows). Toggle in one window: other panels and windows follow; restart and
    confirm the preference persisted.
22. Links: Linux symlinks to files/folders, a broken link and a two-link loop; Windows
    symbolic links and junctions (`mklink /D`, `mklink /J`). Each is marked, navigable/openable
    when valid, and broken/looping ones neither crash nor hang. Copy a folder containing links:
    links are recreated (Windows: confirm the Developer Mode message when unprivileged).
23. Double-click/Enter opens files in the OS default application (text, image, PDF, a name
    with spaces, `&`, `%`, quotes, a leading dash, Unicode). `.exe/.bat/.ps1/.lnk/.desktop/.sh`
    are refused with the Terminal hint. Linux: verify with `xdg-open` on GNOME and KDE/Hyprland.
24. Create, rename (including a case-only rename on Windows), copy, cut/paste and drag-move
    files and folders. Paste into an existing name: Skip, Keep Both ("name (2)"), Replace
    (the old item appears in the Trash/Recycle Bin), and "apply to remaining" with several
    conflicts. Windows reserved names, trailing dots and `CON` are rejected.
25. Move across volumes (NTFS→exFAT, `/home`→USB): the destination is complete before the
    source disappears. Pull the USB drive or fill it during a large copy: the source stays
    intact, the staging `.tessera-*.partial` item is removed or reported. Cancel a large copy.
26. Delete sends items to the Recycle Bin/Trash and they can be restored with their names and
    (Linux) deletion dates. On a drive or share without a Recycle Bin, Delete must fail with
    an explanation, never delete permanently. Shift+Delete asks first; Cancel keeps the item.
    Try to delete/move home, `C:\`, `/` and `C:\Windows`: refused.
27. External changes (create/rename/delete in Explorer, a terminal or `touch`) appear without
    Refresh, including bursts (`git checkout`, extracting an archive). Delete the displayed
    folder externally: the panel moves to its parent with a notice.
28. Pins: pin files and folders from both panels and both windows; reorder; restart Tessera:
    same pins in the same order. Delete a pinned target externally: it shows "Missing" and can
    be unpinned. Activate a pinned folder (navigates) and file (default app).
29. Keyboard: Ctrl+C/X/V, F2, Delete, Shift+Delete, Enter, Ctrl+A, Escape, Backspace,
    Shift+F10/Menu key, F5, arrows/Home/End/PageUp/PageDown with Shift. None of them act
    while typing in the filter or path field or in dialogs.
30. Close File Manager tabs and windows during and after watching: watcher handles return to
    their baseline (Windows handle count, Linux `inotify` watches in `/proc/<pid>/fdinfo`).

## V0.4 Tasks qualification

Run on Windows 10/11 and both Wayland environments with the installed package. Record the
app data directory used and keep a copy of `tasks.json` before destructive file tests.

31. First launch: Tasks shows "No tasks yet"; `tasks.json` does not exist until the first
    change, then contains the Inbox. Open Tasks again from the launcher: the existing panel is
    focused. Open a second window (Ctrl+Alt+N) and open Tasks there: the first window comes to
    the front with its panel focused, also when it was minimized. Close the panel, open it in
    the second window. Move and resize the panel; reject a split below its minimum.
32. Lists: create, rename (including a case-only rename), reject duplicates in other cases,
    empty names, "Inbox" and "All Lists"; delete a list with tasks and confirm they appear in
    the Inbox; delete the selected list and land on the Inbox. Restart: the last selected list
    is shown, in list view, with Done collapsed.
33. Quick add with Enter/Escape in every section and in All Lists (the list selector defaults
    to the Inbox); IME composition in titles and descriptions must not commit early. Edit
    title, list, status, priority and a long Markdown description; restart and compare.
34. Drag within a section, across sections, onto an empty and a collapsed section, in All
    Lists and in a single list (other lists' tasks keep their places), at 100% and high-DPI
    scaling. Escape mid-drag and drop outside: nothing changes. Ctrl+Up/Down and Delete on a
    focused row; Delete inside the title, the Markdown editor and dialogs never deletes.
35. Preview: Markdown with HTML, `<script>`, `javascript:` links and remote images renders as
    text; no network request is made (check with the network disconnected).
36. File faults: make `tasks.json` read-only (and on Linux a read-only directory); edits show
    "Not saved", the tab is modified, closing asks Save/Discard/Cancel; restore permissions and
    Retry. Replace the file with invalid JSON, `"schemaVersion": 2`, and a task with an unknown
    list: the first two are reported and left byte-identical; the third shows the task in the
    Inbox. Kill Tessera repeatedly while dragging and typing: `tasks.json` always parses.
37. Two Tessera processes editing tasks at once: no lost or interleaved writes (each change
    re-reads the file); the other process shows the change after it regains focus.

## V0.5 Excalidraw qualification

Run on Windows 10/11 and both Wayland environments with the installed package, once with the
network disconnected. Keep copies of the drawings used for file-fault tests.

38. New drawing: Excalidraw from the launcher opens `Untitled` with no dialog; a second one is
    `Untitled 2`. Ctrl+S shows the native Save dialog filtered to `.excalidraw`; cancel keeps
    the drawing; save as `plan` (no extension) writes `plan.excalidraw`, and the tab is renamed.
    Saving onto a file that another drawing (also in another window) shows is refused.
39. Autosave: draw, drag continuously for several seconds, add text and an image; the file is
    written after pauses, never during the drag, and always parses. Ctrl+Shift+S moves the
    drawing to a new file; later edits go there. Kill Tessera during rapid edits: the file is
    either the previous or the new version, never truncated.
40. Open: Excalidraw menu Open…, Ctrl+O in a drawing, File Manager double-click, a pinned
    drawing and an OS drop of a `.excalidraw` file open it; opening it again (also from a second
    window) focuses the existing tab or window. A damaged, foreign (`.excalidrawlib` renamed)
    or inaccessible file shows an error and stays byte-identical.
41. Images: insert with the image tool, paste from the clipboard and drop png/jpeg/svg/gif
    files from the OS onto the canvas at different points; save, close, reopen: all images
    show. Dropping a text file onto a drawing opens it in the Text Editor.
42. Conflicts: edit the open file externally while the drawing is clean (it reloads) and
    while it has unsaved edits (Save As / Reload; nothing overwrites the external version).
    Make the file read-only: "Not saved" with Retry; restore permissions and Retry.
43. Export: Excalidraw's export dialog → PNG and SVG (with and without background, dark mode
    and embedded scene) show native Save dialogs; the files open in other applications; the
    `.excalidraw` file, its tab name and saved state are unchanged. Export with CJK text works
    offline. Library export saves `.excalidrawlib`.
44. Sessions: with saved drawings open in two windows, close the second window, then the
    first; relaunch: the window is empty. Open Excalidraw: the first window's drawings reopen
    as tabs; a second Excalidraw is a new `Untitled`. Kill Tessera with an unsaved `Untitled`
    drawing: after relaunch the recovery bar offers it, Recover restores the scene as a new
    unsaved drawing, Discard removes it. Closing with Discard leaves nothing to recover.
45. Keyboard and focus: Excalidraw shortcuts (tools, Ctrl+Z/Y, Ctrl+D, Ctrl+K link, Ctrl+F
    search, ?, Escape) act only in the focused drawing; with a Text Editor, Terminal, File
    Manager or Tasks focused they never reach a drawing. Ctrl+N/W, Ctrl+Alt+N and modifier+arrow
    focus still work from a drawing. IME composition in Excalidraw text. With Alt as the
    workspace modifier, note Excalidraw's Alt gestures (Alt+drag duplicate) and the WM.

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
- File Manager: names that are not valid Unicode are listed but cannot be acted on. Copy
  and move preserve permission bits and (where `std` allows) modification times, not owners,
  ACLs, extended attributes or alternate data streams. Cancellation takes effect between
  files, so one very large file finishes copying first. On Linux file systems without
  `RENAME_NOREPLACE` a narrow check-then-rename race remains. Items larger than the Windows
  Recycle Bin quota rely on the OS permanent-delete warning (not yet observed).
- The cut/copy clipboard is internal to one Tessera window; it does not use the OS clipboard.
- Tasks: the single-panel rule is per process; a second Tessera process can show its own
  Tasks panel (writes stay serialized by the file lock). List-name uniqueness uses
  `to_lowercase`, not full Unicode case folding. Orphaned temporary files from an interrupted
  save are left in the data directory.
- The Windows installer requires preinstalled WebView2. Linux packages are not yet produced
  or installed in this environment; CI build checks are not a substitute for Wayland smoke.
- Excalidraw: the library is not persisted between sessions and its "Browse libraries" web
  page is not opened. Web embeds and web links on elements are disabled offline. Excalidraw's
  internal HTML5 drags (library item onto the canvas) may be blocked on Windows by the native
  drop handler. Undo history is per session and is cleared when a clean drawing reloads after
  an external change. Changes made before the first input in a drawing (font measurement) are
  not saved until the drawing is edited. Drawings above 64 MiB (embedded images) are refused.
  The open-drawings list is per process; two Tessera processes may each open the same file,
  and their saves then conflict instead of overwriting each other.
