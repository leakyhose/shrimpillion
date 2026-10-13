/**
 * Edit distance between a and b, or Infinity once it must exceed `max`.
 * With `swapsAsOne`, an adjacent transposition costs 1 (optimal string alignment);
 * otherwise it is plain Levenshtein, where a swap costs 2.
 */
export function editDistance(a: string, b: string, max: number, swapsAsOne = false): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return Infinity;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let prev2: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
      if (swapsAsOne && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, prev2[j - 2]! + 1);
      }
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return Infinity;
    prev2 = prev;
    prev = cur;
  }
  const d = prev[b.length]!;
  return d > max ? Infinity : d;
}
