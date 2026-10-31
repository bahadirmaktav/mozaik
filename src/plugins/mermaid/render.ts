import type { Mermaid } from "mermaid";

/** The preview and export background; Mermaid's dark theme draws on transparent. */
export const BACKGROUND = "#16191e";
const MAX_CANVAS = 16384;
let loaded: Promise<Mermaid> | null = null;
// Mermaid keeps render state globally; one render at a time keeps diagrams independent.
let queue: Promise<unknown> = Promise.resolve();
let counter = 0;

function mermaid() {
  loaded ??= import("mermaid").then(({ default: api }) => {
    api.initialize({
      startOnLoad: false,
      // Diagram files are untrusted: no click callbacks, scripts or raw HTML in labels.
      securityLevel: "strict",
      // SVG text labels instead of HTML in foreignObject, so PNG export can draw them.
      htmlLabels: false,
      theme: "dark",
      themeVariables: { background: BACKGROUND },
      fontFamily: 'system-ui, "Segoe UI", sans-serif',
      // Mermaid 12 lays out with ELK by default; ELK is not bundled (see no-elk.ts).
      layout: "dagre",
      state: { layout: "dagre" },
      suppressErrorRendering: true,
      // Directives in a file must not change these settings.
      secure: [
        "secure",
        "securityLevel",
        "startOnLoad",
        "maxTextSize",
        "suppressErrorRendering",
        "maxEdges",
        "htmlLabels",
        "dompurifyConfig",
      ],
    });
    return api;
  });
  return loaded;
}

export type Rendered = { svg: string; type: string };
/** Renders a diagram source to sanitized SVG markup, or rejects with Mermaid's message. */
export function renderDiagram(source: string): Promise<Rendered> {
  const run = queue.then(async () => {
    const api = await mermaid();
    const { svg, diagramType } = await api.render(
      `mozaik-mermaid-${++counter}`,
      source,
    );
    return { svg, type: diagramType };
  });
  queue = run.catch(() => {});
  return run;
}
export const errorText = (error: unknown) =>
  (error instanceof Error ? error.message : String(error))
    .replace(/^Error: /, "")
    .trim();

/** A standalone SVG file with the preview background. */
export function svgFile(svg: string) {
  const document = new DOMParser().parseFromString(svg, "image/svg+xml");
  const root = document.documentElement;
  root.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  root.style.backgroundColor = BACKGROUND;
  return new Blob(
    [
      '<?xml version="1.0" encoding="UTF-8"?>\n',
      new XMLSerializer().serializeToString(root),
    ],
    { type: "image/svg+xml" },
  );
}
function size(svg: string) {
  const root = new DOMParser().parseFromString(svg, "image/svg+xml")
    .documentElement as unknown as SVGSVGElement;
  const box = root
    .getAttribute("viewBox")
    ?.split(/[\s,]+/)
    .map(Number);
  const width = box?.[2] || Number.parseFloat(root.getAttribute("width") ?? ""),
    height = box?.[3] || Number.parseFloat(root.getAttribute("height") ?? "");
  if (!(width > 0 && height > 0)) throw new Error("The diagram has no size.");
  return { width, height };
}
/** Draws the SVG at twice its size onto the preview background. */
export async function pngFile(svg: string): Promise<Blob> {
  const { width, height } = size(svg);
  const scale = Math.min(2, MAX_CANVAS / width, MAX_CANVAS / height);
  const url = URL.createObjectURL(svgFile(svg));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext("2d")!;
    context.fillStyle = BACKGROUND;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => {
      try {
        canvas.toBlob(
          (blob) =>
            blob ? resolve(blob) : reject(new Error("PNG export failed.")),
          "image/png",
        );
      } catch {
        // A diagram type that still embeds HTML taints the canvas.
        reject(
          new Error(
            "This diagram type cannot be exported as PNG; export SVG instead.",
          ),
        );
      }
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}
