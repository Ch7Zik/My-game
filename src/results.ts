import { LEVELS } from './levels.ts';

export type Stars = 1 | 2 | 3;
export interface LevelResult { bestMs: number; stars: Stars }
export type Results = Record<number, LevelResult>;
export const RESULTS_KEY = 'mystic-puzzles-results-v1';

// Earlier versions stored completed levels without a timed result. A completion
// still earns the minimum star; the first timed replay records a real score.
export function starsForDisplay(completed: readonly number[], results: Results, id: number): 0 | Stars {
  return results[id]?.stars ?? (completed.includes(id) ? 1 : 0);
}

// Initial, tuneable thresholds by the existing number of pieces. Seconds for 3 and 2 stars.
export const STAR_THRESHOLDS_SECONDS = {
  4: { three: 90, two: 180 },
  6: { three: 150, two: 300 },
  8: { three: 240, two: 480 },
  12: { three: 360, two: 720 },
} as const;

export function starsForTime(pieces: 4 | 6 | 8 | 12 | 16 | 20, elapsedMs: number): Stars {
  // Development-only library variants share the published sixth level's rules.
  const { three, two } = STAR_THRESHOLDS_SECONDS[pieces === 16 || pieces === 20 ? 12 : pieces];
  return elapsedMs <= three * 1000 ? 3 : elapsedMs <= two * 1000 ? 2 : 1;
}

export function formatTime(elapsedMs: number): string {
  const seconds = Math.floor(Math.max(0, elapsedMs) / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

export function recordResult(results: Results, id: number, elapsedMs: number): Results {
  const level = LEVELS.find(level => level.id === id);
  if (!level || !Number.isFinite(elapsedMs) || elapsedMs < 0) return results;
  const previous = results[id];
  return {
    ...results,
    [id]: {
      bestMs: previous ? Math.min(previous.bestMs, Math.round(elapsedMs)) : Math.round(elapsedMs),
      stars: previous ? Math.max(previous.stars, starsForTime(level.pieces, elapsedMs)) as Stars : starsForTime(level.pieces, elapsedMs),
    },
  };
}

export function restoreResults(storage: Pick<Storage, 'getItem'>): Results {
  try {
    const raw = storage.getItem(RESULTS_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const results: Results = {};
    for (const level of LEVELS) {
      const value = (parsed as Record<string, unknown>)[level.id];
      if (!value || typeof value !== 'object') continue;
      const result = value as Record<string, unknown>;
      if (typeof result.bestMs === 'number' && Number.isFinite(result.bestMs) && result.bestMs >= 0 &&
          Number.isInteger(result.stars) && Number(result.stars) >= 1 && Number(result.stars) <= 3) {
        results[level.id] = { bestMs: Math.round(result.bestMs), stars: result.stars as Stars };
      }
    }
    return results;
  } catch { return {}; }
}

export function saveResults(storage: Pick<Storage, 'setItem'>, results: Results): void {
  try { storage.setItem(RESULTS_KEY, JSON.stringify(results)); } catch { /* Private mode may disable storage. */ }
}
