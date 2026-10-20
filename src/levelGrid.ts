import type { Rect } from './layout';

export interface LevelGrid {
  cards: Rect[];
  top: number;
  bottom: number;
  rowStep: number;
  visibleRows: number;
  maxScrollRow: number;
  scrollRow: number;
}

// Keep the established five-card layout, and advance whole rows when the
// collection grows. A whole-row scroll keeps cards clear of the fixed header.
export function levelGrid(w: number, h: number, count: number, requestedRow = 0): LevelGrid {
  const desktop = w >= 900;
  const columns = desktop ? 5 : 2;
  const gap = desktop ? 16 : h < 700 ? 7 : 9;
  const group = desktop ? Math.min(w - 120, 1560) : w - 24;
  const width = desktop ? (group - gap * 4) / 5 : (w - 32 - gap) / 2;
  const height = desktop ? Math.min(560, Math.max(350, h - 250))
    : Math.min(220, (h - 76 - 15 - gap * 2) / 3);
  const top = desktop && count <= columns ? Math.max(156, (h - height) / 2) : desktop ? 156 : 76;
  const bottom = h - (desktop ? 24 : 15);
  const rowStep = height + gap;
  const visibleRows = Math.max(1, Math.floor((bottom - top + gap) / rowStep));
  const maxScrollRow = Math.max(0, Math.ceil(count / columns) - visibleRows);
  const scrollRow = Math.max(0, Math.min(maxScrollRow, Math.round(requestedRow)));
  const left = desktop ? (w - group) / 2 : 12;
  const cards = Array.from({ length: count }, (_, index) => ({
    x: left + (index % columns) * (width + gap),
    y: top + (Math.floor(index / columns) - scrollRow) * rowStep,
    width, height,
  }));
  return { cards, top, bottom, rowStep, visibleRows, maxScrollRow, scrollRow };
}
