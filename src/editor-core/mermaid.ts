import type { Mermaid } from "mermaid";

/** The preview and export background; Mermaid's dark theme draws on transparent. */
export const BACKGROUND = "#16191e";
const MAX_CANVAS = 16384;
const TEXT = "#e4e7ed";
const MUTED = "#aab1bd";
const LINE = "#8d96a6";
const FILL = "#262c37";
const EDGE = "#6d8fbf";
const PANEL = "#1d2129";
const RAISED = "#2c3442";
const QUIET = "#3b4352";
/** Muted hues that read on the background with light text, for every kind of diagram. */
const HUES = [
  "#3f6ea8",
  "#2f8778",
  "#8a5fae",
  "#b0713a",
  "#3d8aa6",
  "#a85072",
  "#5f8740",
  "#6a6fb5",
  "#a68a35",
  "#4f7f9f",
  "#9c5a55",
  "#54807a",
];
const indexed = (name: string, value: (index: number) => string, count = 12) =>
  Object.fromEntries(
    Array.from({ length: count }, (_, i) => [`${name}${i}`, value(i)]),
  );
/**
 * Mermaid's `base` theme with Mozaik's dark colors: its own `dark` theme glows around nodes,
 * draws the first mindmap branch black and fills a Gantt's excluded days bright yellow.
 */
const THEME_VARIABLES = {
  darkMode: true,
  background: BACKGROUND,
  fontSize: "14px",
  dropShadow: "none",
  primaryColor: FILL,
  primaryTextColor: TEXT,
  primaryBorderColor: EDGE,
  secondaryColor: RAISED,
  secondaryTextColor: TEXT,
  secondaryBorderColor: LINE,
  tertiaryColor: PANEL,
  tertiaryTextColor: TEXT,
  tertiaryBorderColor: QUIET,
  lineColor: LINE,
  textColor: TEXT,
  titleColor: TEXT,
  mainBkg: FILL,
  nodeBorder: EDGE,
  nodeTextColor: TEXT,
  clusterBkg: PANEL,
  clusterBorder: QUIET,
  edgeLabelBackground: PANEL,
  // Sequence diagrams.
  actorBkg: FILL,
  actorBorder: EDGE,
  actorTextColor: TEXT,
  actorLineColor: "#4a5260",
  signalColor: LINE,
  signalTextColor: TEXT,
  labelBoxBkgColor: RAISED,
  labelBoxBorderColor: EDGE,
  labelTextColor: TEXT,
  loopTextColor: TEXT,
  activationBkgColor: "#34405a",
  activationBorderColor: EDGE,
  sequenceNumberColor: BACKGROUND,
  noteBkgColor: "#3b3626",
  noteBorderColor: "#7c7040",
  noteTextColor: TEXT,
  // State and class diagrams.
  labelColor: TEXT,
  altBackground: PANEL,
  compositeBackground: PANEL,
  compositeTitleBackground: FILL,
  classText: TEXT,
  // Entity relationship tables.
  attributeBackgroundColorOdd: "#232833",
  attributeBackgroundColorEven: PANEL,
  // Gantt charts.
  sectionBkgColor: "#232833",
  sectionBkgColor2: "#232833",
  altSectionBkgColor: "#1b1f26",
  taskBkgColor: "#3f6ea8",
  taskBorderColor: "#6f9bd4",
  taskTextColor: TEXT,
  taskTextLightColor: TEXT,
  taskTextDarkColor: TEXT,
  taskTextOutsideColor: MUTED,
  taskTextClickableColor: "#8fb8ec",
  activeTaskBkgColor: "#2f8778",
  activeTaskBorderColor: "#57b5a4",
  doneTaskBkgColor: "#4a515e",
  doneTaskBorderColor: "#7c8493",
  critBkgColor: "#a8474a",
  critBorderColor: "#d9777a",
  gridColor: "#343a46",
  todayLineColor: "#d9777a",
  excludeBkgColor: "#14171b",
  // Mindmaps, timelines and journeys.
  ...indexed("cScale", (i) => HUES[i]),
  ...indexed("cScaleInv", () => TEXT),
  ...indexed("cScalePeer", () => EDGE),
  ...indexed("cScaleLabel", () => TEXT),
  ...indexed("fillType", (i) => HUES[i], 8),
  // Pie charts.
  ...Object.fromEntries(HUES.map((hue, i) => [`pie${i + 1}`, hue])),
  pieTitleTextColor: TEXT,
  pieSectionTextColor: TEXT,
  pieLegendTextColor: TEXT,
  pieStrokeColor: BACKGROUND,
  pieOuterStrokeColor: QUIET,
  // Git graphs.
  ...indexed("git", (i) => HUES[i], 8),
  ...indexed("gitInv", () => TEXT, 8),
  ...indexed("gitBranchLabel", () => TEXT, 8),
  commitLabelColor: TEXT,
  commitLabelBackground: RAISED,
  tagLabelColor: TEXT,
  tagLabelBackground: "#34405a",
  tagLabelBorder: EDGE,
  // Quadrant charts.
  quadrant1Fill: "#25324a",
  quadrant2Fill: "#21392f",
  quadrant3Fill: "#232833",
  quadrant4Fill: "#3a2c2c",
  quadrant1TextFill: TEXT,
  quadrant2TextFill: TEXT,
  quadrant3TextFill: TEXT,
  quadrant4TextFill: TEXT,
  quadrantPointFill: "#8fb8ec",
  quadrantPointTextFill: TEXT,
  quadrantXAxisTextFill: MUTED,
  quadrantYAxisTextFill: MUTED,
  quadrantInternalBorderStrokeFill: "#4a5260",
  quadrantExternalBorderStrokeFill: "#4a5260",
  quadrantTitleFill: TEXT,
  // Requirement diagrams.
  requirementBackground: FILL,
  requirementBorderColor: EDGE,
  requirementBorderSize: "1",
  requirementTextColor: TEXT,
  relationColor: LINE,
  relationLabelBackground: PANEL,
  relationLabelColor: TEXT,
  // XY charts.
  xyChart: {
    backgroundColor: "transparent",
    titleColor: TEXT,
    xAxisLabelColor: MUTED,
    xAxisTitleColor: MUTED,
    xAxisTickColor: LINE,
    xAxisLineColor: LINE,
    yAxisLabelColor: MUTED,
    yAxisTitleColor: MUTED,
    yAxisTickColor: LINE,
    yAxisLineColor: LINE,
    plotColorPalette: "#5b9be0,#57b5a4,#c18ad6,#d99a5b,#d9777a",
  },
};
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
      theme: "base",
      themeVariables: THEME_VARIABLES,
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
/** A rendered diagram's own size, from its `viewBox`. */
export function svgSize(svg: string) {
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
  const { width, height } = svgSize(svg);
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
