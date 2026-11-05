# 026: IDE and File Manager requests after v0.11.0

Status: accepted (twenty-first review). The user asked for a list of IDE and File Manager
changes, most of them after VS Code and Windows' File Explorer. These are the decisions that
are not obvious from the result.

## Explorer focus

A click in the IDE Explorer shows the file but keeps the focus on the row, as in VS Code; a
double click or Enter goes to the editor. Before, every click moved the focus to the editor, so
**F2**, **Delete** and the clipboard keys reached the editor instead of the tree: that was why
F2 seemed not to rename a file.

## File clipboard across windows

Cut and copied files live in `file_clipboard.rs`: a small file in the app's local data folder,
plus an event to the windows of the process. A file rather than memory because
`mozaik -ide <path>` starts another process, whose windows read it when they get focus. Only
paths are kept; a paste still goes through `operations.rs` and asks before replacing. A process
removes what it left when it exits, so nothing looks cut after a restart. **Escape** in a File
Manager or Explorer calls off a cut, and a cut pasted into its own folder moves nothing. This
is Mozaik's own clipboard: it is not the system's file clipboard, so Windows' File Explorer
does not see it.

## Windows shortcuts

`shortcuts.rs` reads the Shell Link format directly, so opening a `.lnk` starts nothing and asks
no shell. A folder target opens in the panel and a file target opens like any file. **A program
target is not run**: the File Manager never runs executables or scripts, and a shortcut must not
be a way around that. The panel says so and names the program. The user asked for opening
shortcuts first and thought creating them might not be needed, so Mozaik does not create them.
A shortcut that names only a shell item (no path on disk) reports that it cannot be opened.
Explorer writes its LinkInfo path in the system's ANSI code page, so a path with other letters is
tried only after the Unicode relative path.

## File Manager rows

Nothing limits a listing. Rows went missing because the list is a new element after the This
PC page while the view kept the old element's size and scroll position: rows were drawn for
the wrong place until the next scroll, and never for a panel made larger. The view now measures
the element it shows and draws more rows past the visible ones.

## Pins

A pin's name is a label in `pins.json`; the file keeps its own name. Clearing the label shows the
file's name again. `pinsPlacement` keeps them behind the toolbar button (the default) or in a
list at the left of the panel. A panel narrower than 380 pixels keeps the button, so the list
does not take the room of the folder.

## Compiler warnings and clang-tidy checks

clangd reports an unused variable only with `-Wall`, which projects often leave out, and it has no
command line option for extra flags or for clang-tidy checks: those come from `.clangd` and
`.clang-tidy` files in the project or the user's own clangd configuration, and Mozaik writes to
neither. So:

- **Compiler warnings** (default `-Wall -Wextra`) reach clangd through a copy of
  `compile_commands.json` in the app's cache with the flags right after each compiler, written at
  each server start (a configure restarts the server). They come before the project's own flags,
  so its `-Wno-…` still wins, and the build does not change. For `cl` and `clang-cl`, where `-Wall`
  means every warning there is, `-W4` is used. Files without a database get them as clangd's
  fallback flags.
- **Checks without a .clang-tidy** apply when Mozaik runs clang-tidy (the Analysis commands, or on
  save if chosen) and the file has no `.clang-tidy` above it. A project's own file always wins.
  The default is a broad list rather than `*`: `*` includes other projects' house styles
  (llvmlibc, fuchsia, altera…) that report nearly every line; the setting accepts `*`.
- While editing, clangd itself keeps its own default checks in such a project. To see the full
  list live, turn on **Analyze on save**. This is a limit of clangd, not a choice.

Both settings reach a command line, so Rust accepts only what they are named for: check names, and
`-W…` or `-pedantic` flags. They are not free arguments.

## Git in the editor

The gutter and the minimap compare with Git's **staged** text, as VS Code's do, so staging a file
clears its marks; a file Git does not know shows none. The text is read again only when the file's
Git state or `HEAD` changes. `@codemirror/merge`'s `Chunk` finds the changes.

The graph is `git log` of every branch and tag, read only like the rest of `git.rs`, 200 commits at
a time. It reads again when `HEAD` moves or on Refresh. Commits cannot be opened from it yet.

## Source Control refresh

The view asks Git each time it opens, and has a Refresh button. Changes went unseen for two reasons:
folders are watched only while expanded in the tree, so a change in a closed folder waited for the
window's focus; and a slow, older status could replace a newer one, which `refreshGit` now ignores.
Mozaik still runs no periodic Git command.

## Minimap

Written for Mozaik rather than a dependency: a canvas that draws only the lines it shows and reads
the theme's colors, so it adds nothing to the document and needs no measuring of text. It is off for
documents too large for highlighting.

## C++ colors

VS Code colors C++ in two layers: a grammar, then the language server's semantic tokens, which alone
can tell a class from a variable or a parameter. Mozaik does the same with clangd's tokens over the
grammar. The themes set `--cpp-*` variables with a dark and a light palette and follow the lightness
of the color theme, so they do not replace it. "Follow the color theme" sets nothing. `int` and its
kind take the keyword color, as in VS Code. The minimap reads the same colors.

## Reload keys

F5 and Ctrl+R reloaded the WebView, which ended everything in the window, IDE included. They are
stopped in the capture phase with `preventDefault` only, so the File Manager's Refresh and a terminal's
shell still get them. **Developer: Reload Window** remains, and asks about unsaved files.

## Markdown preview

The preview uses the safe `Markdown` component of Tasks and Notes, now with tables: links and images
stay text, and nothing loads or navigates. It is per tab, beside or instead of the source, and also
in the Text Editor, which otherwise stays without language features.
