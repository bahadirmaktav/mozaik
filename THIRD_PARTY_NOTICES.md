# Third-party notices

Mozaik is licensed under the GNU General Public License v3.0 or later. It bundles the
open-source software below, used unmodified under its own license. The exact versions are
pinned in `package-lock.json` and `src-tauri/Cargo.lock`; each package's license text ships in
its source package.

## Main components

| Component                                                                 | License               |
| ------------------------------------------------------------------------- | --------------------- |
| [Tauri](https://tauri.app)                                                | MIT OR Apache-2.0     |
| [React](https://react.dev)                                                | MIT                   |
| [CodeMirror 6](https://codemirror.net)                                    | MIT                   |
| [xterm.js](https://xtermjs.org)                                           | MIT                   |
| [Excalidraw](https://github.com/excalidraw/excalidraw) 0.18.1             | MIT                   |
| [Mermaid](https://mermaid.js.org) 12.2.0                                  | MIT                   |
| [KaTeX](https://katex.org)                                                | MIT                   |
| [DOMPurify](https://github.com/cure53/DOMPurify)                          | MPL-2.0 OR Apache-2.0 |
| [portable-pty](https://github.com/wezterm/wezterm/tree/main/pty)          | MIT                   |
| [notify](https://github.com/notify-rs/notify)                             | CC0-1.0               |
| [trash](https://github.com/Byron/trash-rs)                                | MIT                   |
| [ignore](https://github.com/BurntSushi/ripgrep/tree/master/crates/ignore) | Unlicense OR MIT      |

The remaining JavaScript and Rust dependencies are under permissive licenses (MIT, ISC,
BSD, Apache-2.0, Unicode-3.0, Zlib, CC0, Unlicense) or MPL-2.0 (a few Rust crates used by
Tauri, such as `cssparser` and `selectors`).

## Fonts

Excalidraw's fonts are bundled so drawings render offline: Virgil, Excalifont, Nunito,
Lilita One, Cascadia Code, Liberation Sans, Assistant and Xiaolai under the SIL Open Font
License 1.1, and Comic Shanns under the MIT License.

## Left out

Mermaid 12 lays diagrams out with ELK by default, using [elkjs](https://github.com/kieler/elkjs), which is under
the Eclipse Public License 2.0 and cannot be distributed with GPL-3.0 code. Mozaik's build
replaces it with a small stub and uses Mermaid's dagre layout instead; diagrams that ask for
`layout: elk` show a message.
