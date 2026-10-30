# 014: The name Mozaik

Status: accepted. The application was renamed from Tessera to Mozaik (a mosaic is made of
tesserae: the panels stay its tiles). The logo is a mosaic "M" of small tiles in the accent
palette (`public/mozaik.svg`; the bundle icons in `src-tauri/icons` are rendered from it with
`npx tauri icon`).

## What changed

- Product, window and crate names, the bundle identifier `dev.mozaik.desktop`, the project
  file `.mozaik/debug.json`, the CMake File API client `client-mozaik`, temporary file and
  lock names, and every user-visible message.
- The local `.plans/` specifications keep their file names: they are the historical specs.

## User data

The identifier names the app config and data folders. At start, `rename.rs` copies a missing
`dev.mozaik.desktop` folder from its `dev.tessera.desktop` sibling (config and data; the lock
folder is not needed). It copies, never moves: the old folders stay as they were, a staged copy
is renamed into place so an interrupted copy is retried, and an existing new folder is never
touched. A project's `.tessera/debug.json` is not read anymore; rename the folder to
`.mozaik`. Build folders are configured once more so CMake answers the new File API query.
