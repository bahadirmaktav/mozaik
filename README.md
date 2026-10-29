# Tessera

Offline desktop workspace for Windows and Linux. Tauri 2 + Rust + React + TypeScript + Vite.
One window is one independent workspace; every launch starts empty.

## Development

Install Node.js 22.12+ and stable Rust. Windows also requires MSVC C++ build tools,
the Windows SDK and WebView2. Linux requires WebKitGTK 4.1 and GTK 3 development
packages (see [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)).

```sh
npm ci
npm run tauri dev
npm test
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
npm run test:e2e
npm run test:production
# Windows installer (requires preinstalled WebView2 on the destination)
npm run tauri build -- --bundles nsis
# Linux packaging candidates, to run on Linux
# npm run tauri build -- --bundles deb,appimage
```

On PowerShell with script execution disabled, use `npm.cmd` instead of `npm`.
`npm run dev` runs the UI in a browser; native file/window services require Tauri.
Production assets are bundled locally. No cloud, telemetry, updater or remote plugins. Shells run only in Terminal tabs you open.

## Using the workspace

Open the launcher with **Ctrl+K**, search for a tool, and press **Enter** to add it as an
automatic split or **Ctrl+Enter** to add it as a tab. **Ctrl+N** adds a Text Editor tab;
**Ctrl+Shift+N** adds an automatic split.
Drag tabs to merge, reorder or split. Hold **Alt** and drag the panel grip to move a whole
panel: drop at another panel's center to swap, or at an edge to split. Alt+arrows moves
focus spatially. Settings offers Control or Shift if Alt conflicts with your compositor.

Use **Ctrl+O**, **Ctrl+S**, **Ctrl+Shift+S**, **Ctrl+W**, **Ctrl+G** to open, save, save as,
close and go to line. Undo/redo and Tab indentation are available. Text/regex search,
multiple cursors, external plugins and layout restoration are out of scope.
Use **Ctrl+,** to open settings and **Ctrl+Alt+N** to create a new independent window.
The compact custom title bar contains only the Tessera mark and window controls.

Add a **Terminal** from the launcher to run your default shell (chosen in Settings) in an
interactive PTY that starts in your home directory. Several terminals run independently; moving
a terminal tab keeps its shell running, and closing the tab ends it. Ctrl+C copies a selection
and otherwise interrupts; Ctrl+Shift+C/V copy and paste (Ctrl+V also pastes on Windows).
While a terminal has focus, Ctrl+N/O/S/W go to the shell.

UTF-8, BOM and LF/CRLF are preserved. Unsupported/binary/mixed-ending files are rejected
with a message; files above 64 MiB are rejected for allocation safety. Large text uses
a measured lightweight editor mode. Recovery checkpoints are local and never autosave
the original file. After an unexpected process exit, recoverable documents are offered
without restoring the previous layout.

## Validation status

Windows builds and automated tests pass. This is an implementation candidate, **not a
completed cross-platform release qualification**: Windows native dialog/clipboard/drop,
installed-package flows, interactive terminal use, and both required Wayland environments
still need manual testing.
The Windows installer does not download WebView2; install its runtime as a prerequisite.

`npm run format:check` and `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`
run the formatting/static checks. `npm run benchmark:editor` reproduces the parser experiment.
On Linux, run `npx playwright install --with-deps chromium` before browser tests.

See [implementation status](docs/STATUS.md), [decisions](docs/decisions/001-foundation.md) and
the [terminal design](docs/decisions/003-terminal.md).
