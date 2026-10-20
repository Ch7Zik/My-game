import type { Rect } from './layout';

export interface VictoryScreenLayout {
  picture: Rect;
  button: Rect;
  titleY: number;
  nameY: number;
  starsY: number;
  timeY: number;
  contentX: number;
  contentWidth: number;
  starRadius: number;
  portrait: boolean;
}

// Three calm beats finish within one second of the actual puzzle completion.
// The result layout and button never wait for this decorative progress.
export function victoryAwardProgress(elapsedMs: number, index: number, reducedMotion = false): number {
  if (reducedMotion) return 1;
  const step = Math.max(0, Math.min(1, (elapsedMs - 260 - index * 190) / 250));
  return step * step * (3 - 2 * step);
}

// Text bounds come from the rendered Phaser objects, including their font
// metrics. The glow must have its own clearance from the name and art frame.
export function fitVictoryStars(nameBottom: number, frameTop: number, preferredY: number, starRadius: number) {
  const gap = 3;
  const preferredGlow = starRadius * 1.12;
  const requiredShift = Math.max(0, preferredGlow * 2 + gap * 2 - (frameTop - nameBottom));
  const headingShift = Math.min(6, requiredShift);
  const adjustedBottom = nameBottom - headingShift;
  const glowRadius = Math.min(preferredGlow, (frameTop - adjustedBottom - gap * 2) / 2);
  const minimumY = adjustedBottom + gap + glowRadius;
  const maximumY = frameTop - gap - glowRadius;
  return { headingShift, glowRadius,
    y: Math.max(minimumY, Math.min(preferredY, maximumY)), gap };
}

// The finished art has its own layout. No puzzle board coordinates or gameplay
// HUD positions are used here, so a resize cannot push the result offscreen.
export function victoryScreenLayout(w: number, h: number, safeTop = 0, safeBottom = 0): VictoryScreenLayout {
  const top = Math.max(0, Math.min(60, safeTop));
  const bottom = Math.max(0, Math.min(60, safeBottom));
  const portrait = w < 900;
  if (portrait) {
    const compact = h < 720;
    const topBlock = compact ? 84 : 98;
    const bottomBlock = compact ? 84 : 94;
    const maxPictureHeight = Math.max(180, h - top - bottom - topBlock - bottomBlock - 12);
    const pictureHeight = Math.min((w - (compact ? 22 : 16)) * 1.5, maxPictureHeight);
    const pictureWidth = pictureHeight * 2 / 3;
    const spare = Math.max(0, h - top - bottom - topBlock - pictureHeight - bottomBlock);
    const start = top + spare / 2;
    const picture = { x: (w - pictureWidth) / 2, y: start + topBlock,
      width: pictureWidth, height: pictureHeight };
    const buttonHeight = compact ? 44 : 52;
    const buttonWidth = Math.min(310, w - 56);
    return { portrait, picture,
      button: { x: (w - buttonWidth) / 2, y: picture.y + picture.height + (compact ? 36 : 40),
        width: buttonWidth, height: buttonHeight },
      titleY: start + (compact ? 17 : 21), nameY: start + (compact ? 42 : 49),
      starsY: start + (compact ? 64 : 73), timeY: picture.y + picture.height + (compact ? 16 : 19),
      contentX: w / 2, contentWidth: w - 70, starRadius: compact ? 9 : 11 };
  }
  const pictureHeight = Math.min(h - top - bottom - 104, 870);
  const pictureWidth = pictureHeight * 2 / 3;
  const gap = Math.min(72, w * .045);
  const contentWidth = Math.min(380, w * .24);
  const totalWidth = pictureWidth + gap + contentWidth;
  const picture = { x: (w - totalWidth) / 2, y: (h - pictureHeight) / 2,
    width: pictureWidth, height: pictureHeight };
  const contentX = picture.x + picture.width + gap + contentWidth / 2;
  return { portrait, picture, contentX, contentWidth,
    titleY: h * .235, nameY: h * .3, starsY: h * .39, timeY: h * .63,
    button: { x: contentX - Math.min(300, contentWidth) / 2, y: h * .72,
      width: Math.min(300, contentWidth), height: 62 }, starRadius: 22 };
}
