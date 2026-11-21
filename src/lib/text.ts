/** The one replacement that turns a text into another, without their common start and end. */
export function textChange(before: string, after: string) {
  const limit = Math.min(before.length, after.length);
  let start = 0;
  while (start < limit && before[start] === after[start]) start++;
  let end = 0;
  while (
    end < limit - start &&
    before[before.length - 1 - end] === after[after.length - 1 - end]
  )
    end++;
  return {
    from: start,
    to: before.length - end,
    insert: after.slice(start, after.length - end),
  };
}
