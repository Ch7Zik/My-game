import { assetUrl } from './assetUrl.ts';

export interface LevelConfig {
  id: number;
  title: string;
  art: string;
  pieces: 4 | 6 | 8 | 12 | 16 | 20;
  columns: 2 | 3 | 4;
  rows: 2 | 3 | 4 | 5;
  seed: number;
  slots: readonly number[];
  phrase: string;
}

export const LEVELS: readonly LevelConfig[] = [
  { id: 1, title: 'Домик у озера', art: assetUrl('assets/moonlit-cottage.png'), pieces: 4, columns: 2, rows: 2, seed: 713, slots: [4, 2, 1, 3], phrase: 'Самые тёплые огни видны в тишине…' },
  { id: 2, title: 'Лесная избушка', art: assetUrl('assets/firefly-cabin.webp'), pieces: 4, columns: 2, rows: 2, seed: 857, slots: [4, 2, 1, 3], phrase: 'В лесу даже звёзды умеют шептать…' },
  { id: 3, title: 'Лунный маяк', art: assetUrl('assets/moonlit-lighthouse.webp'), pieces: 6, columns: 2, rows: 3, seed: 1069, slots: [4, 2, 7, 1, 6, 3], phrase: 'Путь домой хранит один далёкий свет…' },
  { id: 4, title: 'Мост через реку', art: assetUrl('assets/forest-bridge.webp'), pieces: 6, columns: 2, rows: 3, seed: 1213, slots: [4, 2, 7, 1, 6, 3], phrase: 'Каждый мост ведёт к новой тайне…' },
  { id: 5, title: 'Замок среди гор', art: assetUrl('assets/moonlit-castle.webp'), pieces: 8, columns: 2, rows: 4, seed: 1429, slots: [0, 1, 2, 3, 4, 5, 6, 7], phrase: 'За лунными горами начинается сказка…' },
  { id: 6, title: 'Заколдованная библиотека', art: assetUrl('assets/enchanted-library.webp'), pieces: 12, columns: 3, rows: 4, seed: 1526, slots: [14, 15, 16, 17, 18, 19, 8, 9, 10, 11, 12, 13], phrase: 'В каждой книге спит немного волшебства…' },
];

export function levelById(id: number): LevelConfig { return LEVELS.find(level => level.id === id) ?? LEVELS[0]; }

export function levelForPlay(id: number, devPieces: number | null, devMode: boolean): LevelConfig {
  const level = levelById(id);
  if (!devMode || id !== 6 || (devPieces !== 16 && devPieces !== 20)) return level;
  return { ...level, pieces: devPieces, columns: 4, rows: devPieces === 16 ? 4 : 5,
    slots: Array.from({ length: devPieces }, (_, index) => index) };
}
