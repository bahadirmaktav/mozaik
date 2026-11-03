/**
 * File and folder icons of the IDE Explorer and their themes, chosen with Preferences: File
 * Icon Theme (the icons under the cursor show at once, as color themes do). Seti follows
 * VS Code's default icons: a colored glyph for the file's kind with no box around it and no
 * folder icons; Seti with Folders adds colored folders, well-known ones (src, include, tests,
 * build…) with a badge of their kind; Minimal draws outlines; None shows
 * names only. Drawn here, so nothing is loaded.
 */
import { useId, useSyncExternalStore, type ReactNode } from "react";

export const ICON_THEMES = [
  { id: "seti", name: "Seti", detail: "colored glyphs, as in VS Code" },
  {
    id: "seti-folders",
    name: "Seti with Folders",
    detail: "glyphs and folders by their names",
  },
  { id: "minimal", name: "Minimal", detail: "file and folder outlines" },
  { id: "none", name: "None", detail: "names only" },
] as const;
export type IconTheme = (typeof ICON_THEMES)[number]["id"];
export const DEFAULT_ICON_THEME: IconTheme = "seti";

let theme: IconTheme = DEFAULT_ICON_THEME;
const listeners = new Set<() => void>();
/** Shows the icon theme (an unknown ID shows the default). */
export function setIconTheme(id: string) {
  const next = ICON_THEMES.find((t) => t.id === id)?.id ?? DEFAULT_ICON_THEME;
  if (next === theme) return;
  theme = next;
  for (const listener of listeners) listener();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
export const useIconTheme = () => useSyncExternalStore(subscribe, () => theme);

// Seti's colors; "white" follows the theme's text so light themes keep it visible.
const BLUE = "#519aba",
  GREEN = "#8dc149",
  ORANGE = "#e37933",
  PINK = "#f55385",
  PURPLE = "#a074c4",
  RED = "#cc3e44",
  YELLOW = "#cbcb41",
  GREY = "#8a9aa1",
  WHITE = "var(--text)";

type Shape =
  | "gear"
  | "image"
  | "lock"
  | "git"
  | "cmake"
  | "terminal"
  | "lines"
  | "info"
  | "react"
  | "braces"
  | "code"
  | "flask"
  | "cube"
  | "import";
/** A glyph: letters (with an optional superscript, as in C++) or a drawn shape. */
type Glyph = { color: string } & (
  { text: string; sup?: string } | { shape: Shape }
);
const t = (text: string, color: string, sup?: string): Glyph => ({
  text,
  color,
  sup,
});
const s = (shape: Shape, color: string): Glyph => ({ shape, color });

const CPP = t("C", BLUE, "++"),
  HEADER = t("H", PURPLE),
  HPP = t("H", PURPLE, "++"),
  CONFIG = s("gear", GREY),
  SHELL = s("terminal", GREEN),
  IMAGE = s("image", PURPLE),
  TEXT = s("lines", WHITE),
  JSON = s("braces", YELLOW),
  GIT = s("git", ORANGE),
  CMAKE = s("cmake", BLUE);

// By exact file name first (lower case), then by extension.
const NAMES: Record<string, Glyph> = {
  "cmakelists.txt": CMAKE,
  "cmakepresets.json": CMAKE,
  "cmakeuserpresets.json": CMAKE,
  makefile: s("gear", ORANGE),
  dockerfile: t("D", BLUE),
  ".gitignore": s("git", GREY),
  ".gitattributes": GIT,
  ".gitmodules": GIT,
  ".clang-format": CONFIG,
  ".clang-tidy": CONFIG,
  ".clangd": CONFIG,
  ".editorconfig": CONFIG,
  "package.json": t("npm", RED),
  "package-lock.json": s("lock", GREEN),
  "cargo.toml": t("R", ORANGE),
  "cargo.lock": s("lock", GREEN),
  license: s("lines", YELLOW),
  "license.md": s("lines", YELLOW),
  "license.txt": s("lines", YELLOW),
  "readme.md": s("info", BLUE),
  "compile_commands.json": s("braces", GREEN),
};
const EXTENSIONS: Record<string, Glyph> = {
  c: t("C", BLUE),
  cc: CPP,
  cpp: CPP,
  cxx: CPP,
  "c++": CPP,
  ixx: CPP,
  cppm: CPP,
  h: HEADER,
  hh: HEADER,
  hpp: HPP,
  hxx: HPP,
  inl: HPP,
  ts: t("TS", BLUE),
  mts: t("TS", BLUE),
  tsx: s("react", BLUE),
  jsx: s("react", YELLOW),
  js: t("JS", YELLOW),
  mjs: t("JS", YELLOW),
  cjs: t("JS", YELLOW),
  py: t("py", BLUE),
  rs: t("R", ORANGE),
  go: t("go", BLUE),
  java: t("J", RED),
  kt: t("K", ORANGE),
  cs: t("C", BLUE, "#"),
  swift: t("S", ORANGE),
  lua: t("lua", BLUE),
  rb: t("rb", RED),
  php: t("php", PURPLE),
  json: JSON,
  jsonc: JSON,
  yaml: t("yml", PURPLE),
  yml: t("yml", PURPLE),
  toml: CONFIG,
  ini: CONFIG,
  cfg: CONFIG,
  conf: CONFIG,
  xml: t("<>", ORANGE),
  html: t("<>", ORANGE),
  htm: t("<>", ORANGE),
  md: t("M↓", BLUE),
  markdown: t("M↓", BLUE),
  txt: TEXT,
  log: s("lines", GREY),
  css: t("#", BLUE),
  scss: t("#", PINK),
  sass: t("#", PINK),
  less: t("#", BLUE),
  sh: SHELL,
  bash: SHELL,
  zsh: SHELL,
  ps1: s("terminal", BLUE),
  psm1: s("terminal", BLUE),
  bat: SHELL,
  cmd: SHELL,
  cmake: CMAKE,
  png: IMAGE,
  jpg: IMAGE,
  jpeg: IMAGE,
  gif: IMAGE,
  bmp: IMAGE,
  ico: IMAGE,
  webp: IMAGE,
  svg: s("image", YELLOW),
  csv: s("lines", GREEN),
  tsv: s("lines", GREEN),
  sql: t("sql", PINK),
  lock: s("lock", GREEN),
  excalidraw: t("ex", PURPLE),
  mmd: t("mm", PINK),
  pdf: t("pdf", RED),
  zip: t("zip", GREY),
  gz: t("zip", GREY),
  diff: t("±", ORANGE),
  patch: t("±", ORANGE),
};
const DEFAULT = s("lines", GREY);

/** The glyph of a file name: by its name, else its extension, else a plain one. */
export function fileGlyph(name: string): Glyph {
  const lower = name.toLowerCase();
  const named = NAMES[lower];
  if (named) return named;
  const dot = lower.lastIndexOf(".");
  return (dot >= 0 && EXTENSIONS[lower.slice(dot + 1)]) || DEFAULT;
}

/** A well-known folder: its color and the badge drawn on it. */
type Folder = { color: string; badge: Glyph };
const folder = (color: string, badge: Glyph): Folder => ({ color, badge });
const FOLDERS: [RegExp, Folder][] = [
  [/^(src|source|sources)$/, folder("#4caf50", s("code", "#a5d6a7"))],
  [/^(lib|libs|library)$/, folder("#5c9fd6", s("cube", "#bbdefb"))],
  [
    /^(include|includes|inc|headers)$/,
    folder("#9a7fd1", s("import", "#d1c4e9")),
  ],
  [
    /^(test|tests|spec|specs|__tests__|testing|e2e)$/,
    folder("#e5534b", s("flask", "#ffcdd2")),
  ],
  [/^(docs?|documentation|wiki)$/, folder("#6aa2c8", s("lines", "#bbdefb"))],
  [
    /^(build|builds|out|dist|bin|target|release|debug|cmake-build-.*)$/,
    folder("#d9a03c", s("gear", "#ffe0b2")),
  ],
  [/^cmake$/, folder("#5c9fd6", s("cmake", ""))],
  [/^(scripts?|tools|ci)$/, folder("#7cb35c", s("terminal", "#dcedc8"))],
  [
    /^(assets|images?|img|icons|media|resources|res|public|static)$/,
    folder("#b07ac9", s("image", "#e1bee7")),
  ],
  [
    /^(config|configs|conf|settings|.vscode|.idea|.mozaik|.github)$/,
    folder("#8a95a5", s("gear", "#e0e4ea")),
  ],
  [/^.git$/, folder("#e37933", s("git", "#ffe0b2"))],
  [
    /^(node_modules|vendor|third_party|external|deps)$/,
    folder("#7d8796", s("cube", "#d5dae1")),
  ],
  [/^(examples?|samples?|demo)$/, folder("#4fb3cf", s("info", "#b2ebf2"))],
];
/** A well-known folder's color and badge, else null (the theme's plain folder). */
export function folderStyle(name: string): Folder | null {
  const lower = name.toLowerCase();
  return FOLDERS.find(([pattern]) => pattern.test(lower))?.[1] ?? null;
}

function shape(kind: Shape, color: string, weight = 1): ReactNode {
  const w = (width: number) => width * weight;
  const line = {
    fill: "none",
    stroke: color,
    strokeWidth: w(1.6),
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (kind) {
    case "gear":
      return (
        <>
          <circle cx="8" cy="8" r="3.6" {...line} strokeWidth={w(2.2)} />
          <path
            d="M8 1.6v2M8 12.4v2M1.6 8h2M12.4 8h2M3.5 3.5l1.4 1.4M11.1 11.1l1.4 1.4M3.5 12.5l1.4-1.4M11.1 4.9l1.4-1.4"
            {...line}
            strokeWidth={w(2)}
          />
        </>
      );
    case "image":
      return (
        <>
          <rect x="2" y="3" width="12" height="10" rx="1.5" {...line} />
          <path d="M3 12l3.5-4 2.5 2.5 1.5-1.5L13 12" {...line} />
          <circle cx="10.5" cy="6" r="1.1" fill={color} />
        </>
      );
    case "lock":
      return (
        <>
          <path d="M5 7V5.2a3 3 0 0 1 6 0V7" {...line} />
          <rect x="3.5" y="7" width="9" height="7" rx="1.2" fill={color} />
        </>
      );
    case "git":
      return (
        <>
          <rect
            x="3"
            y="3"
            width="10"
            height="10"
            rx="1.6"
            transform="rotate(45 8 8)"
            fill={color}
          />
          <path
            d="M6.3 5.6l3.4 3.4M6.3 5.6v4.8"
            fill="none"
            stroke="var(--surface)"
            strokeWidth={w(1.2)}
            strokeLinecap="round"
          />
          <circle cx="6.3" cy="10.6" r="1" fill="var(--surface)" />
          <circle cx="9.9" cy="9.2" r="1" fill="var(--surface)" />
        </>
      );
    case "cmake":
      // CMake's triangle in its three parts.
      return (
        <>
          <path d="M8 1.5L1.5 14h6.5z" fill="#3e7bc4" />
          <path d="M8 1.5L14.5 14 8 10z" fill="#d6463b" />
          <path d="M1.5 14L8 10l6.5 4z" fill="#5fae4f" />
        </>
      );
    case "terminal":
      return (
        <path d="M3 4.5l3.5 3.5L3 11.5M8 12h5" {...line} strokeWidth={w(1.8)} />
      );
    case "lines":
      return <path d="M3 4h10M3 7h10M3 10h10M3 13h6" {...line} />;
    case "info":
      return (
        <>
          <circle cx="8" cy="8" r="6" {...line} />
          <path d="M8 7.2v4" {...line} strokeWidth={w(1.8)} />
          <circle cx="8" cy="4.8" r="1" fill={color} />
        </>
      );
    case "react":
      return (
        <>
          <ellipse
            cx="8"
            cy="8"
            rx="6.5"
            ry="2.5"
            {...line}
            strokeWidth={w(1.1)}
          />
          <ellipse
            cx="8"
            cy="8"
            rx="6.5"
            ry="2.5"
            {...line}
            strokeWidth={w(1.1)}
            transform="rotate(60 8 8)"
          />
          <ellipse
            cx="8"
            cy="8"
            rx="6.5"
            ry="2.5"
            {...line}
            strokeWidth={w(1.1)}
            transform="rotate(120 8 8)"
          />
          <circle cx="8" cy="8" r="1.4" fill={color} />
        </>
      );
    case "code":
      return (
        <path d="M5 4L1.5 8 5 12M11 4l3.5 4-3.5 4M9.2 2.5l-2.4 11" {...line} />
      );
    case "flask":
      return (
        <>
          <path
            d="M6 1.8h4M6.6 1.8v4.4L2.4 13a.9.9 0 0 0 .8 1.3h9.6a.9.9 0 0 0 .8-1.3L9.4 6.2V1.8"
            {...line}
          />
          <path d="M4.3 10h7.4l1.4 3.4H2.9z" fill={color} />
        </>
      );
    case "cube":
      return (
        <path
          d="M8 1.5l6 3.2v6.6l-6 3.2-6-3.2V4.7zM2 4.7l6 3.2 6-3.2M8 7.9v6.6"
          {...line}
        />
      );
    case "import":
      // An arrow into a tray: what other files take in.
      return (
        <path
          d="M8 1.5v7.5M4.8 6l3.2 3.2L11.2 6M2 10.5v2.2c0 .7.5 1.3 1.3 1.3h9.4c.8 0 1.3-.6 1.3-1.3v-2.2"
          {...line}
        />
      );
    case "braces":
      return (
        <path
          d="M5.5 2.5c-1.6 0-2 .7-2 2v1.6c0 .9-.5 1.4-1.5 1.9 1 .5 1.5 1 1.5 1.9v1.6c0 1.3.4 2 2 2M10.5 2.5c1.6 0 2 .7 2 2v1.6c0 .9.5 1.4 1.5 1.9-1 .5-1.5 1-1.5 1.9v1.6c0 1.3-.4 2-2 2"
          {...line}
        />
      );
  }
}

function glyph(g: Glyph, weight = 1): ReactNode {
  if ("shape" in g) return shape(g.shape, g.color, weight);
  const size = g.sup
    ? 11
    : g.text.length === 1
      ? 13
      : g.text.length === 2
        ? 11
        : 8;
  const text = (
    <text
      x={g.sup ? 4.4 : 8}
      y={g.sup ? 11.9 : g.text.length === 1 ? 13 : 12}
      textAnchor="middle"
      fontSize={size}
      fontWeight="700"
      fontFamily="system-ui, 'Segoe UI', sans-serif"
      letterSpacing={g.text.length > 2 ? -0.4 : 0}
      fill={g.color}
    >
      {g.text}
    </text>
  );
  if (!g.sup) return text;
  if (g.sup === "++")
    return (
      <>
        {text}
        <path
          d="M10 6.2v3.6M8.2 8h3.6M14.1 6.2v3.6M12.3 8h3.6"
          stroke={g.color}
          strokeWidth={1.1 * weight}
        />
      </>
    );
  return (
    <>
      {text}
      <text
        x="12.4"
        y="11.2"
        textAnchor="middle"
        fontSize="8.5"
        fontWeight="800"
        fontFamily="system-ui, 'Segoe UI', sans-serif"
        letterSpacing="-0.6"
        fill={g.color}
      >
        {g.sup}
      </text>
    </>
  );
}

const svg = (children: ReactNode, color?: string) => (
  <svg
    className="entry-icon"
    viewBox="0 0 16 16"
    aria-hidden="true"
    style={color ? { color } : undefined}
  >
    {children}
  </svg>
);
const outline = {
  fill: "none",
  stroke: "var(--muted)",
  strokeWidth: 1,
  strokeLinejoin: "round" as const,
};

/**
 * A colored folder; a well-known one (src, include, tests, build…) carries a badge of its kind
 * at its lower right, cut out of the folder so it reads on any row background.
 */
function FolderIcon({ name, open }: { name: string; open: boolean }) {
  const mask = "folder-mask" + useId().replace(/[^\w-]/g, "");
  const style = folderStyle(name);
  const body = (
    <path
      d={
        open
          ? "M1.5 3.5h4l1.2 1.3h6.8v1.7H4.2L2 12.5h-.5zM4.2 6.5h11l-2.3 6H2z"
          : "M1.5 3.5h4l1.2 1.3h7.8v7.7h-13z"
      }
      fill="currentColor"
      fillOpacity="0.9"
      mask={style ? `url(#${mask})` : undefined}
    />
  );
  if (!style) return svg(body, "var(--folder, #c8a65a)");
  return svg(
    <>
      <mask id={mask}>
        <rect width="16" height="16" fill="white" />
        <circle cx="11.5" cy="11.5" r="5" fill="black" />
      </mask>
      {body}
      <g transform="translate(7 7) scale(0.5625)">{glyph(style.badge, 1.5)}</g>
    </>,
    style.color,
  );
}

/** The icon before an Explorer row's name, in the chosen icon theme. */
export function EntryIcon({
  name,
  directory,
  open = false,
}: {
  name: string;
  directory: boolean;
  open?: boolean;
}) {
  const current = useIconTheme();
  if (current === "none") return null;
  if (current === "minimal")
    return svg(
      directory ? (
        open ? (
          <path
            d="M1.5 3.5h4l1.2 1.3h6.3v1.7M1.5 3.5v9h11l2-6H4.2l-2.2 6"
            {...outline}
          />
        ) : (
          <path d="M1.5 3.5h4l1.2 1.3h7.8v7.7h-13z" {...outline} />
        )
      ) : (
        <path d="M3.5 1.5h6l3 3v10h-9zM9.5 1.5v3h3" {...outline} />
      ),
    );
  if (directory) {
    // Seti draws no folder icons; the twisty shows the folder.
    if (current === "seti") return <span className="entry-icon" aria-hidden />;
    return <FolderIcon name={name} open={open} />;
  }
  return svg(glyph(fileGlyph(name)));
}
