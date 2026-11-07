/**
 * Where a Markdown preview's link or image points: a heading of the same preview, a local
 * file (relative to the document's file, as on GitHub and in VS Code), or a web address,
 * which the offline preview neither opens nor loads.
 */
export type LinkTarget =
  | { kind: "anchor"; slug: string }
  | { kind: "file"; path: string; slug?: string }
  | { kind: "web"; url: string };

const WINDOWS = /^(\\\\\?\\)?[A-Za-z]:/;
const decode = (text: string) => {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
};

/** The target of `href` written in the document at `base` (null: an Untitled document). */
export function linkTarget(
  base: string | null,
  href: string,
): LinkTarget | null {
  const address = href.trim().replace(/^<(.*)>$/, "$1");
  if (!address) return null;
  if (address.startsWith("#"))
    return { kind: "anchor", slug: decode(address.slice(1)) };
  if (/^(https?|mailto|ftp):/i.test(address))
    return { kind: "web", url: address };
  let rest = address;
  if (/^file:/i.test(rest)) {
    rest = rest.replace(/^file:(\/\/[^/]*)?/i, "");
    // `file:///C:/x` names a drive.
    if (/^\/[A-Za-z]:/.test(rest)) rest = rest.slice(1);
  } else if (/^[a-z][a-z0-9+.-]*:/i.test(rest) && !WINDOWS.test(rest))
    return null; // javascript:, data: and other schemes open nothing
  const hash = rest.indexOf("#");
  const slug = hash >= 0 ? decode(rest.slice(hash + 1)) : undefined;
  if (hash >= 0) rest = rest.slice(0, hash);
  const query = rest.indexOf("?");
  if (query >= 0) rest = rest.slice(0, query);
  rest = decode(rest);
  if (!rest) return base ? file(base, slug) : null;
  let path: string | null;
  if (WINDOWS.test(rest)) path = normalize(rest, "");
  else if (/^[\\/]/.test(rest))
    // A root-relative link means the repository's root on GitHub; only POSIX has one here.
    path = base && !WINDOWS.test(base) ? normalize(rest, "") : null;
  else path = base ? normalize(rest, directory(base)) : null;
  return path ? file(path, slug) : null;
}
const file = (path: string, slug?: string): LinkTarget =>
  slug ? { kind: "file", path, slug } : { kind: "file", path };
const directory = (path: string) => {
  const index = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  return index >= 0 ? path.slice(0, index + 1) : "";
};
/** `relative` against `from` (a directory, or "" when `relative` is absolute), with `.`
 * and `..` resolved and the separator of the platform's spelling. */
function normalize(relative: string, from: string) {
  const whole = from + relative;
  const drive = WINDOWS.exec(whole)?.[0];
  const unc = !drive && /^\\\\[^?]/.test(whole);
  const sep = drive || unc ? "\\" : "/";
  const parts = whole
    .slice(drive?.length ?? 0)
    .split(/[\\/]/)
    .filter(Boolean);
  // A share's server and name stay.
  const fixed = unc ? 2 : 0;
  const out: string[] = [];
  for (const part of parts) {
    if (part === ".") continue;
    if (part === "..") {
      if (out.length > fixed) out.pop();
      continue;
    }
    out.push(part);
  }
  const prefix = drive ? drive + sep : unc ? "\\\\" : "/";
  return prefix + out.join(sep);
}

/** A heading's anchor as GitHub writes it: lower case, punctuation dropped, spaces as `-`. */
export const headingSlug = (text: string) =>
  text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M} _-]/gu, "")
    .replace(/ /g, "-");
