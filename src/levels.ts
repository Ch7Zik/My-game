import { assetUrl } from './assetUrl.ts';

export interface LevelConfig {
  id: number;
  title: string;
  art: string;
  thumbnail: string;
  pieces: 4 | 6 | 8 | 10 | 11 | 12 | 16 | 20;
  columns: 2 | 3 | 4;
  rows: 2 | 3 | 4 | 5;
  seed: number;
  slots: readonly number[];
  phrase: string;
}

export const LEVELS: readonly LevelConfig[] = [
  // Source archive includes only numbered files. Replace these neutral labels when the approved titles arrive.
  { id: 1, title: 'Картина 1', art: assetUrl('assets/level-01.webp'), thumbnail: assetUrl('assets/level-01-thumb.webp'), pieces: 10, columns: 3, rows: 4, seed: 1200, slots: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], phrase: 'Картина пополнила галерею…' },
  { id: 2, title: 'Картина 2', art: assetUrl('assets/level-02.webp'), thumbnail: assetUrl('assets/level-02-thumb.webp'), pieces: 11, columns: 3, rows: 4, seed: 1201, slots: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], phrase: 'Картина пополнила галерею…' },
  { id: 3, title: 'Картина 3', art: assetUrl('assets/level-03.webp'), thumbnail: assetUrl('assets/level-03-thumb.webp'), pieces: 12, columns: 3, rows: 4, seed: 1202, slots: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], phrase: 'Картина пополнила галерею…' },
  { id: 4, title: 'Картина 4', art: assetUrl('assets/level-04.webp'), thumbnail: assetUrl('assets/level-04-thumb.webp'), pieces: 12, columns: 3, rows: 4, seed: 1204, slots: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], phrase: 'Картина пополнила галерею…' },
  { id: 5, title: 'Картина 5', art: assetUrl('assets/level-05.webp'), thumbnail: assetUrl('assets/level-05-thumb.webp'), pieces: 12, columns: 3, rows: 4, seed: 1205, slots: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], phrase: 'Картина пополнила галерею…' },
  { id: 6, title: 'Заколдованная библиотека', art: assetUrl('assets/enchanted-library.webp'), thumbnail: assetUrl('assets/level-06-thumb.webp'), pieces: 12, columns: 3, rows: 4, seed: 1526, slots: [14, 15, 16, 17, 18, 19, 8, 9, 10, 11, 12, 13], phrase: 'В каждой книге спит немного волшебства…' },
];

export function levelById(id: number): LevelConfig { return LEVELS.find(level => level.id === id) ?? LEVELS[0]; }

export function levelForPlay(id: number, devPieces: number | null, devMode: boolean): LevelConfig {
  const level = levelById(id);
  if (!devMode || id !== 6 || (devPieces !== 16 && devPieces !== 20)) return level;
  return { ...level, pieces: devPieces, columns: 4, rows: devPieces === 16 ? 4 : 5,
    slots: Array.from({ length: devPieces }, (_, index) => index) };
}
