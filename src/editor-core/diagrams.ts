import type { DiagramKind } from "../components/parseMarkdown";
import { errorText, renderDiagram, svgFile } from "./mermaid";

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * An SVG document ready for an `<img>`: in the SVG namespace, and sized by its `viewBox`
 * when it has no size of its own (Mermaid's `width="100%"` would have none in a picture).
 */
export function standaloneSvg(code: string): string {
  // Written in Markdown without a namespace, it would not be SVG to the parser.
  const source = /^\s*<svg\b[^>]*\sxmlns\s*=/i.test(code)
    ? code
    : code.replace(/<svg\b/i, `<svg xmlns="${SVG_NS}"`);
  const document = new DOMParser().parseFromString(source, "image/svg+xml");
  const root = document.documentElement;
  if (
    document.getElementsByTagName("parsererror").length ||
    root.namespaceURI !== SVG_NS ||
    root.localName !== "svg"
  )
    throw new Error("This is not valid SVG.");
  const box = root
    .getAttribute("viewBox")
    ?.split(/[\s,]+/)
    .map(Number);
  const relative = (name: string) => {
    const value = root.getAttribute(name);
    return !value || value.trim().endsWith("%");
  };
  if (box && box.length === 4 && box[2] > 0 && box[3] > 0) {
    if (relative("width")) root.setAttribute("width", String(box[2]));
    if (relative("height")) root.setAttribute("height", String(box[3]));
  }
  return new XMLSerializer().serializeToString(root);
}

/**
 * A diagram block of a Markdown preview as a picture: Mermaid renders it (strict security,
 * on the Mermaid module's background), SVG is checked and drawn as it is.
 */
export async function diagramPicture(
  kind: DiagramKind,
  code: string,
): Promise<Blob> {
  if (kind === "svg")
    return new Blob([standaloneSvg(code)], { type: "image/svg+xml" });
  if (!code.trim()) throw new Error("The diagram is empty.");
  let svg: string;
  try {
    ({ svg } = await renderDiagram(code));
  } catch (error) {
    throw new Error(errorText(error) || "The diagram cannot be drawn.");
  }
  // On the Mermaid module's background: its colors are drawn for it.
  return svgFile(standaloneSvg(svg));
}
