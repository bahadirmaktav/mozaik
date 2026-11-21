/** Row selection of a list (File Manager, IDE Explorer, Testing), as in a file explorer. */

export interface Selection {
  paths: Set<string>;
  anchor: string | null;
  cursor: string | null;
}
export const emptySelection = (): Selection => ({
  paths: new Set(),
  anchor: null,
  cursor: null,
});
/** Click selects one, Ctrl toggles, Shift selects the range from the anchor in visible order. */
export function select(
  selection: Selection,
  order: string[],
  path: string,
  modifiers: { ctrl?: boolean; shift?: boolean },
): Selection {
  if (modifiers.shift && selection.anchor && order.includes(selection.anchor)) {
    const [a, b] = [order.indexOf(selection.anchor), order.indexOf(path)].sort(
      (x, y) => x - y,
    );
    const range = order.slice(a, b + 1);
    const paths = modifiers.ctrl
      ? new Set([...selection.paths, ...range])
      : new Set(range);
    return { paths, anchor: selection.anchor, cursor: path };
  }
  if (modifiers.ctrl) {
    const paths = new Set(selection.paths);
    if (paths.has(path)) paths.delete(path);
    else paths.add(path);
    return { paths, anchor: path, cursor: path };
  }
  return { paths: new Set([path]), anchor: path, cursor: path };
}
/** Keeps only selected paths that are still listed (after a refresh or filter change). */
export function retain(selection: Selection, order: string[]): Selection {
  const listed = new Set(order);
  const keep = (p: string | null) => (p && listed.has(p) ? p : null);
  return {
    paths: new Set([...selection.paths].filter((p) => listed.has(p))),
    anchor: keep(selection.anchor),
    cursor: keep(selection.cursor),
  };
}
