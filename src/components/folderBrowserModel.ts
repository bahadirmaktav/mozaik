/** An entry of the folder browser: choose the typed folder, go up, or go into a subfolder. */
export type FolderRow =
  | { kind: "choose"; path: string }
  | { kind: "parent"; path: string }
  | { kind: "folder"; path: string; name: string };

/**
 * Splits a typed path into the folder to list (ending with a separator) and the partial
 * name after it. `~` stands for `home`; a bare drive (`D:`) is its root; text without a
 * separator is a name in the home folder.
 */
export function splitQuery(query: string, separator: string, home: string) {
  const end = (path: string) => (/[\\/]$/.test(path) ? path : path + separator);
  let text = query;
  if (home && (text === "~" || /^~[\\/]/.test(text)))
    text = end(home) + text.slice(2);
  if (/^[A-Za-z]:$/.test(text)) return { directory: text + "\\", name: "" };
  const index = Math.max(text.lastIndexOf("\\"), text.lastIndexOf("/"));
  if (index < 0) return { directory: home ? end(home) : separator, name: text };
  return { directory: text.slice(0, index + 1), name: text.slice(index + 1) };
}
