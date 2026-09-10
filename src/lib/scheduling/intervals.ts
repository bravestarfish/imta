/**
 * Pure interval arithmetic on epoch milliseconds. All intervals are half-open
 * [start, end).
 */
export type Interval = { start: number; end: number };

export function normalize(intervals: Interval[]): Interval[] {
  const sorted = intervals
    .filter((i) => i.end > i.start)
    .sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  for (const cur of sorted) {
    const last = out[out.length - 1];
    if (last && cur.start <= last.end) {
      last.end = Math.max(last.end, cur.end);
    } else {
      out.push({ ...cur });
    }
  }
  return out;
}

export function union(...sets: Interval[][]): Interval[] {
  return normalize(sets.flat());
}

export function intersect(a: Interval[], b: Interval[]): Interval[] {
  const A = normalize(a);
  const B = normalize(b);
  const out: Interval[] = [];
  let i = 0;
  let j = 0;
  while (i < A.length && j < B.length) {
    const start = Math.max(A[i].start, B[j].start);
    const end = Math.min(A[i].end, B[j].end);
    if (start < end) out.push({ start, end });
    if (A[i].end < B[j].end) i++;
    else j++;
  }
  return out;
}

export function intersectAll(sets: Interval[][]): Interval[] {
  if (sets.length === 0) return [];
  return sets.slice(1).reduce((acc, s) => intersect(acc, s), normalize(sets[0]));
}

/** a minus b */
export function subtract(a: Interval[], b: Interval[]): Interval[] {
  const A = normalize(a);
  const B = normalize(b);
  const out: Interval[] = [];
  for (const cur of A) {
    let start = cur.start;
    for (const cut of B) {
      if (cut.end <= start) continue;
      if (cut.start >= cur.end) break;
      if (cut.start > start) out.push({ start, end: cut.start });
      start = Math.max(start, cut.end);
      if (start >= cur.end) break;
    }
    if (start < cur.end) out.push({ start, end: cur.end });
  }
  return out;
}

/** Grow every interval by `before` ms on the left and `after` ms on the right. */
export function pad(intervals: Interval[], before: number, after: number): Interval[] {
  return normalize(intervals.map((i) => ({ start: i.start - before, end: i.end + after })));
}

export function clip(intervals: Interval[], window: Interval): Interval[] {
  return intersect(intervals, [window]);
}

export function contains(intervals: Interval[], probe: Interval): boolean {
  return normalize(intervals).some((i) => i.start <= probe.start && i.end >= probe.end);
}

export function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end;
}

/**
 * Intervals covered by at least `k` of the given sets ("threshold" mode).
 * Sweep-line over all boundaries.
 */
export function atLeast(sets: Interval[][], k: number): Interval[] {
  if (k <= 0) return union(...sets);
  if (k > sets.length) return [];
  const events: { t: number; d: number }[] = [];
  for (const s of sets) {
    for (const i of normalize(s)) {
      events.push({ t: i.start, d: 1 });
      events.push({ t: i.end, d: -1 });
    }
  }
  events.sort((a, b) => a.t - b.t || b.d - a.d);
  const out: Interval[] = [];
  let depth = 0;
  let openAt: number | null = null;
  for (const e of events) {
    const prev = depth;
    depth += e.d;
    if (prev < k && depth >= k) openAt = e.t;
    else if (prev >= k && depth < k && openAt !== null) {
      if (e.t > openAt) out.push({ start: openAt, end: e.t });
      openAt = null;
    }
  }
  return normalize(out);
}

export function totalMs(intervals: Interval[]): number {
  return normalize(intervals).reduce((n, i) => n + (i.end - i.start), 0);
}
