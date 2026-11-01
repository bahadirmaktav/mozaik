# 020: PowerShell prompt

Status: accepted (sixteenth review). The user wants the prompt they use elsewhere (folder,
Python environment, Git branch, a `❯❯` mark) in Mozaik's terminals without oh-my-posh or
any other dependency, kept outside the application and chosen in the settings. Linux shells
are left for a later decision.

## Decisions

- **A prompt file, not a built-in prompt.** Workspace Settings → Terminal → **PowerShell
  prompt** names a `.ps1` file (typed or chosen in a native dialog; `powershellPrompt` in
  `preferences.json`). Empty keeps the shell's own prompt. Mozaik contains no prompt and
  draws no path or Git state itself; the script, which the user owns, does. A different style
  is a different file.
- **PowerShell only.** The setting applies when the started shell is `pwsh` or `powershell`
  (Terminal tabs and the IDE's terminal), never to CMD, Git Bash or Unix shells, and never to
  a CMake run target.
- **After the profile, encoded.** Rust reads the file for every new PowerShell terminal (open
  terminals keep theirs) and appends `-NoExit -EncodedCommand <Base64 of UTF-16LE>` to the
  shell's argument array. PowerShell loads the user's profile, runs the script in the global
  scope and stays interactive. The text never becomes part of a command line string, and the
  renderer still passes only a detected shell ID.
  - `-File` is not used because Windows PowerShell's default execution policy (`Restricted`)
    refuses every script file. This was checked on the development machine; `-File` would
    make the setting do nothing there. The policy does not apply to commands, so only the
    file the user chose runs, and the session's policy stays as it is for everything else.
- **Bounded and checked.** The path must be absolute and end in `.ps1` (renderer and
  `preferences.rs`). The file must be UTF-8 (a BOM is dropped) and at most 8 KiB. That keeps
  the encoded command (at most about 22 Ki characters) under Windows' 32,767-character command
  line limit. A missing, too large or unreadable file does not stop the terminal: the shell
  starts with its own prompt and the terminal shows a yellow line saying why.
- **An example in the repository.** `examples/powershell/path-venv-git-prompt.ps1` gives the
  folder (`~` or the root, `..`, the current folder), the active venv or Conda environment and
  `git(branch)` with the colors of the terminal palette.
  - It reads the branch from `.git/HEAD`, including worktrees and submodules, so it starts no
    `git` process.
  - It sets `VIRTUAL_ENV_DISABLE_PROMPT` so `Activate.ps1` adds no second `(name)`.
  - It is ASCII only, so Windows PowerShell 5.1 reads it correctly without a BOM.
  - It also works in other terminals when dot-sourced from `$PROFILE`.

## Boundaries kept

No shell integration (OSC 7, cwd tracking, command marks), no prompt or profile written by
Mozaik, nothing downloaded. AGENTS.md's ban on terminal path/Git indicators stays: they are
the user's script output, not Mozaik UI.
