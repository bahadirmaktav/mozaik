# 031: Text Editor folding and brackets, diagrams in Markdown previews, Copy Path

Status: accepted. The user asked that the Text Editor fold blocks and highlight matching
brackets as the Code Editor does when a file's type allows it, that Markdown previews draw
Mermaid and SVG instead of showing their code, that a Markdown file open as its preview, and
that the File Manager's menu copy a path.

## Text Editor folding and brackets

The Text Editor takes the Code Editor's grammar-based features, still without a language
server, Git or file operations (decision 002 keeps it the simple editor):

- **Folding**: the same `codeFolding` service and fold chevrons (`folding.ts`), from the file
  type's grammar, so a JSON object, a C function or a Markdown section folds; Ctrl+Shift+[ and
  Ctrl+Shift+] fold and unfold as in the Code Editor (CodeMirror's `foldKeymap`). Plain text
  has no grammar and no folds.
- **Brackets**: the bracket at the cursor and its pair are marked; brackets and quotes close
  themselves only in a file with a grammar, so typing an apostrophe in prose is unchanged.
- **Matches**: the other occurrences of the selected word are marked, and the active line's
  number, as in the Code Editor.

A large document's highlighting is paused (`policy.ts`), which also leaves it without folds:
there is no syntax tree to fold.

## Diagrams in Markdown previews

The Text and Code Editors' preview draws a fenced `mermaid` or `svg` block, and an `<svg>…</svg>`
in the HTML of a README, as a picture. The parser (`parseMarkdown.ts`) makes them `diagram`
nodes holding their source; Tasks and Notes, which pass no renderer, still show them as code.

- **Never live SVG.** Each diagram becomes an SVG file shown through `<img src="blob:…">`, as
  local pictures already are (decision 029): an SVG picture runs no script and loads nothing,
  so `onload`, `<script>` and references in it stay inert. The SVG must parse as XML in the SVG
  namespace (Markdown authors often leave out `xmlns`; it is added); otherwise its code shows
  with the reason.
- **Mermaid** renders with the Mermaid module's `renderDiagram` (pinned, lazy-loaded,
  `securityLevel: "strict"`, SVG labels, directives cannot lower those settings, decision 008)
  and its background, so the colors read as in a diagram tab. A diagram Mermaid cannot read
  shows its code with Mermaid's message.
- A diagram's picture is kept by its source while the preview is shown (the newest 64), so
  typing elsewhere redraws none.

## Markdown opens as its preview

A Markdown file opened from disk shows its preview alone; Source and Split stay a click or
Ctrl+Shift+V away (preview, then source, then split). A new document keeps its source, also
once it is saved under a Markdown name while being written: the mode is chosen once, when the
tab is first shown, and kept per tab while the window lives. With the source hidden, the
preview takes the tab's focus so the tab's shortcuts still reach it.

## Copy Path

The File Manager's row menu has **Copy Path**: the chosen items' full paths, one per line,
without quotes, as the IDE Explorer's Copy Path (Windows Explorer's own command adds quotes,
which most places a path is pasted into do not want).
