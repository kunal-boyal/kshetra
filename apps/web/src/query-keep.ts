/**
 * What a query shows while another of its own loads. A list keeps its rows on screen while another
 * filter, status or month loads, instead of the page falling back to Loading, but only while it is
 * about the same thing: the parts of its key that may change are named by position, and the rest
 * (whose month, which account) must match. Never a record's own page, where the last record would
 * stand in for the next one.
 */
export function keepWhileSame(queryKey: readonly unknown[], varying: readonly number[]) {
  return <T>(previous: T | undefined, previousQuery?: { queryKey: readonly unknown[] }) =>
    previousQuery &&
    queryKey.every(
      (part, at) =>
        varying.includes(at) || JSON.stringify(part) === JSON.stringify(previousQuery.queryKey[at]),
    )
      ? previous
      : undefined;
}
