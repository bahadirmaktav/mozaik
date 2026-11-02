# 024: IDE features can be turned off

Status: accepted (nineteenth review). The user asked for the IDE's features to be more
configurable and handled like extensions that can be enabled and disabled.

## Decisions

- Workspace Settings → IDE → **Features** lists the IDE's built-in features with a switch
  each: Language Server (clangd), Source Control (Git), CMake, Run and Debug, Testing (CTest),
  Coverage, Code Analysis (clang-tidy) and TODOs. All are on by default; the app-wide
  preference `ideDisabledFeatures` keeps the ones turned off, for every window.
- They stay trusted parts of Mozaik (`src/plugins/ide/features.ts`), not plugins: there is
  no loader, manifest or SDK, as AGENTS.md requires. A feature is a name the IDE's code
  checks.
- A feature turned off hides its sidebar view, status bar items, bottom panel view, palette
  commands and editor menu items, and starts none of its processes: no clangd (running ones
  stop), no Git commands (the Explorer shows no states, Open Changes is unavailable), no
  analysis on save. CMake, when off, shows no status bar choices or commands; Mozaik already
  ran nothing of CMake on its own. The breakpoint gutter hides with Run and Debug.
- Run and Debug and Testing need CMake (their targets and tests come from it); with CMake
  off they are off too and their switches are disabled.
- Settings of a feature that is off stay as they were and apply when it is turned on again.
