import type { Rect } from './layout';

export interface GalleryGrid {
  cards: Rect[];
  top: number;
  bottom: number;
  rowStep: number;
  visibleRows: number;
  maxScrollRow: number;
  scrollRow: number;
}

// Scroll one complete row at a time so card art never slips beneath the fixed
// header and no canvas mask can clip the paintings. Works for a longer catalog.
export function galleryGrid(w: number, h: number, count: number, requestedRow = 0): GalleryGrid {
  const desktop = w >= 900;
  const columns = desktop ? 5 : 2;
  const gap = desktop ? 16 : h < 700 ? 7 : 9;
  const group = desktop ? Math.min(w - 120, 1560) : w - 24;
  const cardWidth = (group - gap * (columns - 1)) / columns;
  const bottom = h - (desktop ? 24 : 10);
  const preliminaryTop = desktop ? 170 : 76;
  const availableHeight = bottom - preliminaryTop;
  const preferredHeight = desktop ? Math.min(560, Math.max(350, h - 250))
    : cardWidth * 1.5 + (h < 700 ? 38 : 44);
  const cardHeight = desktop ? preferredHeight : Math.min(preferredHeight, (availableHeight - gap) / 2);
  const top = desktop && count <= columns ? Math.max(preliminaryTop, (h - cardHeight) / 2) : preliminaryTop;
  const rowStep = cardHeight + gap;
  const visibleRows = Math.max(1, Math.floor((bottom - top + gap) / rowStep));
  const rows = Math.ceil(count / columns);
  const maxScrollRow = Math.max(0, rows - visibleRows);
  const scrollRow = Math.max(0, Math.min(maxScrollRow, Math.round(requestedRow)));
  const left = (w - group) / 2;
  const cards = Array.from({ length: count }, (_, index) => ({
    x: left + (index % columns) * (cardWidth + gap),
    y: top + (Math.floor(index / columns) - scrollRow) * rowStep,
    width: cardWidth, height: cardHeight,
  }));
  return { cards, top, bottom, rowStep, visibleRows, maxScrollRow, scrollRow };
}
