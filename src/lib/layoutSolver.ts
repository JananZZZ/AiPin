export interface TrackConstraint {
  id: string;
  current: number;
  min: number;
  max: number;
  flex: number;
  locked: boolean;
}

export interface SolveResult {
  tracks: TrackConstraint[];
  appliedDelta: number;
  blockedBy: string[];
}

/**
 * Redistribute a divider drag without violating min/max/lock constraints.
 * Positive delta grows the target and shrinks its following neighbours.
 */
export function solveTrackResize(
  tracks: TrackConstraint[],
  targetIndex: number,
  requestedDelta: number
): SolveResult {
  const next = tracks.map((track) => ({ ...track }));
  const target = next[targetIndex];
  if (!target || target.locked || requestedDelta === 0) {
    return { tracks: next, appliedDelta: 0, blockedBy: target?.locked ? [target.id] : [] };
  }

  const direction = Math.sign(requestedDelta);
  const targetCapacity = direction > 0 ? target.max - target.current : target.current - target.min;
  let wanted = Math.min(Math.abs(requestedDelta), Math.max(0, targetCapacity));
  const candidates = next
    .map((track, index) => ({ track, index }))
    .filter(({ track, index }) => index !== targetIndex && !track.locked)
    .sort((a, b) => Math.abs(a.index - targetIndex) - Math.abs(b.index - targetIndex));

  const blockedBy = next.filter((track) => track.locked).map((track) => track.id);
  let absorbed = 0;
  for (const { track } of candidates) {
    if (absorbed >= wanted) break;
    const capacity = direction > 0 ? track.current - track.min : track.max - track.current;
    if (capacity <= 0) continue;
    const amount = Math.min(wanted - absorbed, capacity);
    track.current += direction > 0 ? -amount : amount;
    absorbed += amount;
  }

  wanted = absorbed;
  target.current += direction * wanted;
  return { tracks: next, appliedDelta: direction * wanted, blockedBy };
}

export function layoutForModelCount(modelCount: number): { columns: number; rows: number } {
  const required = Math.min(18, Math.max(2, modelCount + 1));
  if (required <= 6) return { columns: required, rows: 1 };
  if (required <= 8) return { columns: 4, rows: 2 };
  if (required <= 12) return { columns: 6, rows: 2 };
  return { columns: 6, rows: 3 };
}
