/** Path helpers for both Windows (`C:\x`, canonical `\\?\C:\x`) and POSIX paths. */
const VERBATIM = /^\\\\\?\\(?=[A-Za-z]:)/;
const windows = (path: string) => /^(\\\\\?\\)?[A-Za-z]:/.test(path);

/** A comparable key: one spelling per file (canonical prefix, separators, Windows case). */
export function pathKey(path: string) {
  if (!windows(path)) return path.replace(/\/+$/, "") || "/";
  return path
    .replace(VERBATIM, "")
    .replace(/\//g, "\\")
    .replace(/\\+$/, "")
    .toLowerCase();
}
export const samePath = (a: string, b: string) => pathKey(a) === pathKey(b);
/** The path as other programs spell it: without the canonical `\\?\` prefix, which GDB
 * does not understand. */
export const plainPath = (path: string) => path.replace(VERBATIM, "");
export function separator(path: string) {
  return windows(path) ? "\\" : "/";
}
export function baseName(path: string) {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}
export function parent(path: string) {
  const index = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  return index > 0 ? path.slice(0, index) : path;
}
export function join(directory: string, relative: string) {
  const sep = separator(directory);
  return (
    directory.replace(/[\\/]+$/, "") +
    sep +
    relative.split(/[\\/]/).filter(Boolean).join(sep)
  );
}
/** `true` when `path` is `root` or inside it. */
export function within(root: string, path: string) {
  const r = pathKey(root),
    p = pathKey(path);
  const sep = windows(root) ? "\\" : "/";
  return p === r || p.startsWith(r.endsWith(sep) ? r : r + sep);
}
/** The project-relative path with `/`, or `null` outside the root. */
export function relative(root: string, path: string) {
  if (!within(root, path)) return null;
  const plain = path.replace(VERBATIM, "");
  const base = root.replace(VERBATIM, "").replace(/[\\/]+$/, "");
  return plain
    .slice(base.length)
    .replace(/^[\\/]+/, "")
    .replace(/\\/g, "/");
}

/** `file://` URI as language servers expect it (drive letters as `/C:/`). */
export function toUri(path: string) {
  const plain = path.replace(VERBATIM, "").replace(/\\/g, "/");
  const absolute = plain.startsWith("/") ? plain : `/${plain}`;
  return (
    "file://" +
    absolute
      .split("/")
      .map((part, index) =>
        // Keep the drive colon readable; servers accept both forms.
        index === 1 && /^[A-Za-z]:$/.test(part)
          ? part
          : encodeURIComponent(part),
      )
      .join("/")
  );
}
export function fromUri(uri: string) {
  const url = new URL(uri);
  if (url.protocol !== "file:") throw new Error(`Unsupported location ${uri}`);
  const path = decodeURIComponent(url.pathname);
  return /^\/[A-Za-z]:/.test(path) ? path.slice(1).replace(/\//g, "\\") : path;
}

const cpp = new Set([
  "c",
  "h",
  "cc",
  "cpp",
  "cxx",
  "c++",
  "hh",
  "hpp",
  "hxx",
  "h++",
  "ipp",
  "inl",
  "tpp",
  "cu",
  "m",
  "mm",
]);
const extension = (path: string) =>
  baseName(path).includes(".")
    ? baseName(path).split(".").pop()!.toLowerCase()
    : "";
/** The language server for a file, if Tessera has one, and its LSP language ID. */
export function serverFor(
  path: string,
): { server: "clangd"; language: string } | null {
  const ext = extension(path);
  if (!cpp.has(ext)) return null;
  return {
    server: "clangd",
    language:
      ext === "c"
        ? "c"
        : ext === "m"
          ? "objective-c"
          : ext === "mm"
            ? "objective-cpp"
            : ext === "cu"
              ? "cuda-cpp"
              : "cpp",
  };
}
