import type { Rect } from './layout';

export interface LevelChapter {
  index: number;
  first: number;
  last: number;
  y: number;
}

export interface LevelGrid {
  cards: Rect[];
  chapters: LevelChapter[];
  top: number;
  bottom: number;
  left: number;
  contentWidth: number;
  contentHeight: number;
  scroll: number;
  maxScroll: number;
}

/** Five paintings per chapter: two pairs, then a wide fifth card. */
export function levelGrid(w: number, h: number, count: number, requestedScroll = 0,
  safeTop = 0, safeBottom = 0): LevelGrid {
  const top = Math.min(safeTop + (w >= 550 ? 140 : 118), h - safeBottom - 180);
  const bottom = h - safeBottom - 14;
  const contentWidth = Math.min(w - 28, 568);
  const left = (w - contentWidth) / 2;
  const gap = Math.max(8, Math.min(14, w * .025));
  const smallWidth = (contentWidth - gap) / 2;
  const smallHeight = Math.min(306, Math.max(196, Math.round(smallWidth * 1.38)));
  const wideHeight = Math.min(184, Math.max(138, Math.round(smallWidth * .86)));
  const chapterHeader = w < 350 ? 38 : 42;
  const chapterGap = w < 350 ? 22 : 28;
  const cards: Rect[] = [];
  const chapters: LevelChapter[] = [];
  let offset = 0;
  for (let chapter = 0; chapter < Math.ceil(count / 5); chapter++) {
    const first = chapter * 5, last = Math.min(count, first + 5);
    chapters.push({ index: chapter, first: first + 1, last, y: top + offset });
    const pairCount = Math.min(4, last - first);
    for (let local = 0; local < pairCount; local++) cards.push({
      x: left + (local % 2) * (smallWidth + gap),
      y: top + offset + chapterHeader + Math.floor(local / 2) * (smallHeight + gap),
      width: smallWidth, height: smallHeight,
    });
    const rows = Math.ceil(pairCount / 2);
    const pairHeight = rows * smallHeight + Math.max(0, rows - 1) * gap;
    if (last - first === 5) cards.push({
      x: left, y: top + offset + chapterHeader + pairHeight + gap,
      width: contentWidth, height: wideHeight,
    });
    offset += chapterHeader + pairHeight + (last - first === 5 ? gap + wideHeight : 0) + chapterGap;
  }
  const contentHeight = offset;
  const maxScroll = Math.max(0, contentHeight - (bottom - top));
  const scroll = Math.max(0, Math.min(maxScroll, requestedScroll));
  for (const card of cards) card.y -= scroll;
  for (const chapter of chapters) chapter.y -= scroll;
  return { cards, chapters, top, bottom, left, contentWidth, contentHeight, scroll, maxScroll };
}

/** Fit the whole painting inside a frame without cropping or distortion. */
export function fitPainting(frame: Rect, sourceWidth: number, sourceHeight: number): Rect {
  const scale = Math.min(frame.width / sourceWidth, frame.height / sourceHeight);
  const width = sourceWidth * scale, height = sourceHeight * scale;
  return { x: frame.x + (frame.width - width) / 2, y: frame.y + (frame.height - height) / 2,
    width, height };
}
