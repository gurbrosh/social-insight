/** Seeded shuffle for reproducible random samples (e.g. prospect CSV exports). */

export type Rng = () => number;

export function seedRng(seed: number): Rng {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffleInPlace<T>(arr: T[], rnd: Rng): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const a = arr[i]!;
    const b = arr[j]!;
    arr[i] = b;
    arr[j] = a;
  }
}

/**
 * Rows keyed by `profile_url` with `open_to_work_status` from the classifier.
 * Appends any pool rows with observable OTW that were absent from `randomBatch` (same guarantee as the random-sample script).
 */
export function appendMissingOpenToWorkFromPool<
  T extends { profile_url: string; open_to_work_status: string },
>(randomBatch: T[], fullPool: T[]): T[] {
  const seen = new Set(randomBatch.map((r) => r.profile_url));
  const out = [...randomBatch];
  for (const r of fullPool) {
    if (seen.has(r.profile_url)) continue;
    const st = r.open_to_work_status;
    if (st && st !== "not_observed") out.push(r);
  }
  return out;
}
