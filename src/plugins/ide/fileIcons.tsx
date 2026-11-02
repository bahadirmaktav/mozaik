/**
 * File and folder icons of the IDE Explorer, after the idea of VS Code's vscode-icons: a
 * file shows its kind as a colored badge with a short label (C, H, TS, {}…), well-known
 * folders (src, test, docs, build…) a colored folder. Drawn here, so nothing is loaded.
 */
type Badge = { label: string; color: string };

const C = "#5c8fd6",
  CPP = "#6b7fd7",
  HEADER = "#9a7fd1",
  TS = "#3d8fd8",
  JS = "#d9b93c",
  PY = "#4b8bbe",
  RS = "#d77a52",
  GO = "#4fb3cf",
  JAVA = "#d06a4a",
  JSON = "#c9a43a",
  MD = "#6aa2c8",
  HTML = "#e2734a",
  CSS = "#5aa0d8",
  SHELL = "#7cb35c",
  CONFIG = "#8a95a5",
  CMAKE = "#4ea36f",
  IMAGE = "#b07ac9",
  DATA = "#5fb3a1",
  GIT = "#e0624a",
  LOCK = "#8a95a5",
  DRAW = "#a887e0",
  TEXT = "#8a95a5";

// By exact file name first (lower case), then by extension.
const NAMES: Record<string, Badge> = {
  "cmakelists.txt": { label: "CM", color: CMAKE },
  "cmakepresets.json": { label: "CM", color: CMAKE },
  "cmakeuserpresets.json": { label: "CM", color: CMAKE },
  makefile: { label: "MK", color: CONFIG },
  dockerfile: { label: "DK", color: "#3f8fd8" },
  ".gitignore": { label: "GI", color: GIT },
  ".gitattributes": { label: "GI", color: GIT },
  ".gitmodules": { label: "GI", color: GIT },
  ".clang-format": { label: "CF", color: CONFIG },
  ".clang-tidy": { label: "CT", color: CONFIG },
  ".clangd": { label: "CD", color: CONFIG },
  ".editorconfig": { label: "EC", color: CONFIG },
  "package.json": { label: "NP", color: "#c4473a" },
  "package-lock.json": { label: "NP", color: LOCK },
  "cargo.toml": { label: "RS", color: RS },
  "cargo.lock": { label: "RS", color: LOCK },
  license: { label: "LI", color: "#c9a43a" },
  "license.md": { label: "LI", color: "#c9a43a" },
  "readme.md": { label: "i", color: MD },
  "compile_commands.json": { label: "{}", color: CMAKE },
};
const EXTENSIONS: Record<string, Badge> = {
  c: { label: "C", color: C },
  cc: { label: "C+", color: CPP },
  cpp: { label: "C+", color: CPP },
  cxx: { label: "C+", color: CPP },
  "c++": { label: "C+", color: CPP },
  ixx: { label: "C+", color: CPP },
  cppm: { label: "C+", color: CPP },
  h: { label: "H", color: HEADER },
  hh: { label: "H", color: HEADER },
  hpp: { label: "H+", color: HEADER },
  hxx: { label: "H+", color: HEADER },
  inl: { label: "H+", color: HEADER },
  ts: { label: "TS", color: TS },
  tsx: { label: "TX", color: TS },
  mts: { label: "TS", color: TS },
  js: { label: "JS", color: JS },
  jsx: { label: "JX", color: JS },
  mjs: { label: "JS", color: JS },
  cjs: { label: "JS", color: JS },
  py: { label: "PY", color: PY },
  rs: { label: "RS", color: RS },
  go: { label: "GO", color: GO },
  java: { label: "JV", color: JAVA },
  kt: { label: "KT", color: "#a77bdb" },
  cs: { label: "C#", color: "#7b5fc4" },
  swift: { label: "SW", color: "#e0703f" },
  lua: { label: "LU", color: "#4a6fc4" },
  rb: { label: "RB", color: "#c4473a" },
  php: { label: "PH", color: "#7a86b8" },
  json: { label: "{}", color: JSON },
  jsonc: { label: "{}", color: JSON },
  yaml: { label: "YM", color: CONFIG },
  yml: { label: "YM", color: CONFIG },
  toml: { label: "TM", color: CONFIG },
  ini: { label: "IN", color: CONFIG },
  cfg: { label: "CF", color: CONFIG },
  conf: { label: "CF", color: CONFIG },
  xml: { label: "<>", color: HTML },
  md: { label: "M↓", color: MD },
  markdown: { label: "M↓", color: MD },
  txt: { label: "TX", color: TEXT },
  log: { label: "LG", color: TEXT },
  html: { label: "<>", color: HTML },
  htm: { label: "<>", color: HTML },
  css: { label: "#", color: CSS },
  scss: { label: "#", color: "#c76494" },
  sass: { label: "#", color: "#c76494" },
  less: { label: "#", color: CSS },
  sh: { label: "$", color: SHELL },
  bash: { label: "$", color: SHELL },
  zsh: { label: "$", color: SHELL },
  ps1: { label: "PS", color: "#4a7fc4" },
  psm1: { label: "PS", color: "#4a7fc4" },
  bat: { label: "BT", color: SHELL },
  cmd: { label: "BT", color: SHELL },
  cmake: { label: "CM", color: CMAKE },
  png: { label: "IM", color: IMAGE },
  jpg: { label: "IM", color: IMAGE },
  jpeg: { label: "IM", color: IMAGE },
  gif: { label: "IM", color: IMAGE },
  bmp: { label: "IM", color: IMAGE },
  ico: { label: "IM", color: IMAGE },
  webp: { label: "IM", color: IMAGE },
  svg: { label: "SV", color: "#e0a03f" },
  csv: { label: "CS", color: DATA },
  tsv: { label: "TS", color: DATA },
  sql: { label: "SQ", color: DATA },
  lock: { label: "LK", color: LOCK },
  excalidraw: { label: "EX", color: DRAW },
  mmd: { label: "MM", color: "#ff6fa8" },
  pdf: { label: "PD", color: "#d04a3f" },
  zip: { label: "ZP", color: CONFIG },
  gz: { label: "ZP", color: CONFIG },
  diff: { label: "±", color: GIT },
  patch: { label: "±", color: GIT },
};

/** The badge of a file name; null for kinds without one (a plain file icon). */
export function fileBadge(name: string): Badge | null {
  const lower = name.toLowerCase();
  const named = NAMES[lower];
  if (named) return named;
  const dot = lower.lastIndexOf(".");
  if (dot < 0) return null;
  return EXTENSIONS[lower.slice(dot + 1)] ?? null;
}

const FOLDERS: [RegExp, string][] = [
  [/^(src|source|sources|lib|libs)$/, "#5c9fd6"],
  [/^(include|includes|inc|headers)$/, "#9a7fd1"],
  [/^(test|tests|spec|specs|__tests__|testing|e2e)$/, "#6fbf73"],
  [/^(docs?|documentation|wiki)$/, "#6aa2c8"],
  [
    /^(build|builds|out|dist|bin|target|release|debug|cmake-build-.*)$/,
    "#d9a03c",
  ],
  [/^(scripts?|tools|ci)$/, "#7cb35c"],
  [/^(assets|images?|img|icons|media|resources|res|public|static)$/, "#b07ac9"],
  [
    /^(config|configs|conf|settings|\.vscode|\.idea|\.mozaik|\.github)$/,
    "#8a95a5",
  ],
  [/^(\.git|node_modules|vendor|third_party|external|deps)$/, "#7d8796"],
  [/^(examples?|samples?|demo)$/, "#4fb3cf"],
];
/** A well-known folder's color, else null (the theme's folder color). */
export function folderColor(name: string): string | null {
  const lower = name.toLowerCase();
  return FOLDERS.find(([pattern]) => pattern.test(lower))?.[1] ?? null;
}

/** The icon before an Explorer row's name. */
export function EntryIcon({
  name,
  directory,
  open = false,
}: {
  name: string;
  directory: boolean;
  open?: boolean;
}) {
  if (directory) {
    const color = folderColor(name) ?? "var(--folder, #c8a65a)";
    return (
      <svg
        className="entry-icon"
        viewBox="0 0 16 16"
        aria-hidden="true"
        style={{ color }}
      >
        {open ? (
          <path
            d="M1.5 3.5h4l1.2 1.3h6.8v1.7H4.2L2 12.5h-.5zM4.2 6.5h11l-2.3 6H2z"
            fill="currentColor"
            fillOpacity="0.85"
          />
        ) : (
          <path
            d="M1.5 3.5h4l1.2 1.3h7.8v7.7h-13z"
            fill="currentColor"
            fillOpacity="0.85"
          />
        )}
      </svg>
    );
  }
  const badge = fileBadge(name);
  if (!badge)
    return (
      <svg className="entry-icon" viewBox="0 0 16 16" aria-hidden="true">
        <path
          d="M3.5 1.5h6l3 3v10h-9zM9.5 1.5v3h3"
          fill="none"
          stroke="var(--muted)"
          strokeWidth="1"
        />
      </svg>
    );
  const small = badge.label.length > 1;
  return (
    <svg className="entry-icon" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="1" y="2" width="14" height="12" rx="2.5" fill={badge.color} />
      <text
        x="8"
        y={small ? 10.6 : 11.2}
        textAnchor="middle"
        fontSize={small ? 7 : 9}
        fontWeight="700"
        fontFamily="system-ui, sans-serif"
        fill="#fff"
      >
        {badge.label}
      </text>
    </svg>
  );
}
