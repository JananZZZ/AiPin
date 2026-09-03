import { describe, expect, it } from "vitest";
import { layoutForModelCount, solveTrackResize, type TrackConstraint } from "../src/lib/layoutSolver";

function makeRandom(seed: number) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 0xffffffff;
  };
}

describe("constraint track solver", () => {
  it("preserves sum, locks and bounds across 10,000 randomized drags", () => {
    const random = makeRandom(0xa1f1);
    for (let run = 0; run < 10_000; run += 1) {
      const count = 2 + Math.floor(random() * 6);
      const tracks: TrackConstraint[] = Array.from({ length: count }, (_, index) => {
        const min = 40 + Math.floor(random() * 80);
        const max = min + 60 + Math.floor(random() * 220);
        return {
          id: `track-${index}`,
          min,
          max,
          current: min + Math.floor(random() * (max - min)),
          flex: .5 + random() * 2,
          locked: random() < .24
        };
      });
      const target = Math.floor(random() * count);
      const beforeSum = tracks.reduce((sum, track) => sum + track.current, 0);
      const result = solveTrackResize(tracks, target, (random() - .5) * 500);
      const afterSum = result.tracks.reduce((sum, track) => sum + track.current, 0);
      expect(afterSum).toBeCloseTo(beforeSum, 7);
      result.tracks.forEach((track, index) => {
        expect(track.current).toBeGreaterThanOrEqual(track.min - 1e-8);
        expect(track.current).toBeLessThanOrEqual(track.max + 1e-8);
        if (tracks[index].locked) expect(track.current).toBe(tracks[index].current);
      });
    }
  });

  it("uses the v1 automatic capacity map", () => {
    expect(layoutForModelCount(0)).toEqual({ columns: 2, rows: 1 });
    expect(layoutForModelCount(5)).toEqual({ columns: 6, rows: 1 });
    expect(layoutForModelCount(7)).toEqual({ columns: 4, rows: 2 });
    expect(layoutForModelCount(11)).toEqual({ columns: 6, rows: 2 });
    expect(layoutForModelCount(17)).toEqual({ columns: 6, rows: 3 });
  });
});
