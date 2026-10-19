import type { Rect } from './layout';

export interface MobileVictoryLayout {
  headerTop: number;
  picture: Rect;
  results: Rect;
  button: Rect;
  titleY: number;
  detailsY: number;
  compact: boolean;
}

// Victory is presentation only. The puzzle board and every piece keep their
// original coordinates; the finished picture is fitted into the space above
// a dedicated, always visible results area.
export function mobileVictoryLayout(w: number, h: number, board: Rect, safeTop = 0, safeBottom = 0): MobileVictoryLayout {
  const top = Math.max(0, Math.min(60, safeTop));
  const bottom = Math.max(0, Math.min(60, safeBottom));
  const compact = h < 720;
  const resultsHeight = compact ? 112 : 124;
  const pictureY = Math.max(board.y, top + 60);
  const availableBottom = h - bottom - 8;
  const pictureHeight = Math.max(120, Math.min(board.height, (w - 8) * 1.5,
    availableBottom - resultsHeight - 8 - pictureY));
  const pictureWidth = pictureHeight * 2 / 3;
  const picture = { x: (w - pictureWidth) / 2, y: pictureY, width: pictureWidth, height: pictureHeight };
  const resultsY = pictureY + pictureHeight + 8;
  const results = { x: 12, y: resultsY, width: w - 24, height: resultsHeight };
  const buttonHeight = compact ? 44 : 50;
  const buttonWidth = Math.min(310, w * .78);
  const button = { x: (w - buttonWidth) / 2, y: resultsY + resultsHeight - buttonHeight - 4,
    width: buttonWidth, height: buttonHeight };
  return { headerTop: top, picture, results, button,
    titleY: resultsY + (compact ? 16 : 19), detailsY: resultsY + (compact ? 43 : 52), compact };
}
