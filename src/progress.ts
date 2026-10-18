import { LEVELS } from './levels.ts';

export interface Progress {
  version: 1;
  completed: number[];
  currentLevel: number;
}
export const PROGRESS_KEY = 'mystic-puzzles-v1';
export function freshProgress(): Progress { return { version: 1, completed: [], currentLevel: 1 }; }
export function restoreProgress(storage: Pick<Storage, 'getItem'>): Progress {
  try {
    const raw = storage.getItem(PROGRESS_KEY);
    if (!raw) return freshProgress();
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object') return freshProgress();
    const data = value as Record<string, unknown>;
    if (data.version !== 1 || !Array.isArray(data.completed)) return freshProgress();
    const valid = new Set(data.completed.filter((id): id is number => Number.isInteger(id) && LEVELS.some(level => level.id === id)));
    const completed: number[] = [];
    for (const level of LEVELS) { if (!valid.has(level.id)) break; completed.push(level.id); }
    const maxOpen = Math.min(LEVELS.length, nextUnplayed({ version: 1, completed, currentLevel: 1 }));
    const currentLevel = Number.isInteger(data.currentLevel) && (data.currentLevel as number) >= 1 && (data.currentLevel as number) <= maxOpen ? data.currentLevel as number : maxOpen;
    return { version: 1, completed, currentLevel };
  } catch { return freshProgress(); }
}
export function saveProgress(storage: Pick<Storage, 'setItem'>, progress: Progress): void {
  try { storage.setItem(PROGRESS_KEY, JSON.stringify(progress)); } catch { /* Private mode may disable storage. */ }
}
export function nextUnplayed(progress: Progress): number {
  return LEVELS.find(level => !progress.completed.includes(level.id))?.id ?? LEVELS.length + 1;
}
export function isUnlocked(progress: Progress, id: number): boolean {
  return id >= 1 && id <= LEVELS.length && (id === 1 || progress.completed.includes(id - 1));
}
export function isInGallery(progress: Progress, id: number): boolean { return progress.completed.includes(id); }
export function completeLevel(progress: Progress, id: number): Progress {
  if (!isUnlocked(progress, id)) return progress;
  return { version: 1, completed: [...new Set([...progress.completed, id])].sort((a, b) => a - b), currentLevel: Math.min(LEVELS.length, id + 1) };
}
export function selectLevel(progress: Progress, id: number): Progress { return isUnlocked(progress, id) ? { ...progress, currentLevel: id } : progress; }
