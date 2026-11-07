# 029: Markdown preview links and pictures, VS Code-like dark themes

Status: accepted. The user asked that a Markdown preview open the files it links to (a
README's link to `AGENTS.md`) and show a README's pictures, as VS Code's preview does, and for
more dark themes after VS Code's.

## Markdown preview

- **A README's HTML layout.** The Text and Code Editors' preview (`MarkdownPane`) parses with
  `parseMarkdown(source, { html: true })`: a fixed set of tags (`p`, `div`, `a`, `img`, `br`,
  `sub`, `sup`, `b`, `i`, `table`, `tr`, `td`, `details`, `summary`, `kbd`, headings, lists…)
  becomes elements, with only `align`, sizes (`width`/`height` as numbers, px or %), cell spans,
  `href`, `src`, `alt`, `title` and `open` kept. Event handlers, `style`, classes and other
  attributes are dropped; `script`, `style`, `iframe`, `svg`, `object`, `template` and similar
  tags are dropped with their content; other tags keep only their text. HTML still never reaches
  the page as markup: the parser makes the same plain node tree React renders. Tasks and Notes
  keep raw HTML as text (decision 005).
- **Links** are `role="link"` spans, never `<a href>`, so the WebView cannot navigate. A
  `#heading` scrolls the preview to the heading with that GitHub anchor; a relative or `file:`
  link is resolved against the document's folder (`markdownLinks.ts`) and opened by the App:
  beside code with the IDE's `reveal` (pictures and other files as file tabs), elsewhere as a
  Text Editor tab of that panel (files that are not text in their default application, as from
  the File Manager). A root-relative link (`/docs/x.md`) is the repository root on GitHub and
  opens nothing on Windows. Web links (`https:`, `mailto:`) open nothing: the application is
  offline and adds no URL opener; their address is the tooltip. Other schemes
  (`javascript:`, `data:`) open nothing.
- **Pictures** with a local address and an image extension are read with the existing
  `drawings_read_image` command (images only) and shown from blob URLs, as image tabs are, so
  an SVG's scripts and references never run or load. Each picture is read once while the
  preview is shown; web pictures stay their text, and the CSP keeps them from loading anyway.

## Dark themes

Ten dark themes join the six original ones, after VS Code's own dark themes and two
well-known ones: Dark Modern, Dark+, Monokai, One Dark, Dracula, Solarized Dark, Abyss,
Tomorrow Night Blue, Kimbie Dark and High Contrast Dark. Each maps its editor, side bar,
widget, list-hover, selection and token colors onto Mozaik's tokens; a few muted and comment
colors are a little brighter than the originals for readable labels. They are plain token
sets in `themes.ts`, like the others; nothing is loaded.
