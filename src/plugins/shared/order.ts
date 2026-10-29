type Item = { id: string };
/** Anchors for inserting at `index` of a displayed list that no longer contains the item.
 * Using neighbours, not indices, keeps items that are not displayed in place. */
export function anchors(rest: Item[], index: number) {
  const before = rest[index]?.id ?? null;
  return {
    before,
    after: before ? null : (rest[rest.length - 1]?.id ?? null),
  };
}
/** Anchors for moving an item one step up or down within its displayed list, or null. */
export function step(group: Item[], id: string, direction: -1 | 1) {
  const index = group.findIndex((t) => t.id === id),
    target = index + direction;
  if (index < 0 || target < 0 || target >= group.length) return null;
  return anchors(
    group.filter((t) => t.id !== id),
    target,
  );
}
