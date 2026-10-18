/// <reference types="vite/client" />
import Phaser from 'phaser';
import { createRegions, inspectRegions, qualityProblems, type PieceRegion, type Point } from './geometry';
import { canAdvance, canDrag, isComplete, shouldSnap } from './puzzleRules';
import { gameLayout, looseScale, startPosition, SLOT_ORDER, type Rect } from './layout';
import './style.css';

type Piece = { id: number; sprite: Phaser.GameObjects.Image; region: PieceRegion; placed: boolean; home: Point; slot: number; hit: Uint8Array; texW: number; texH: number; baseW: number; baseH: number };
const ART = '/assets/moonlit-cottage.png';

class PuzzleScene extends Phaser.Scene {
  private art!: HTMLImageElement;
  private artLoaded = false;
  private pieces: Piece[] = [];
  private mode: 'menu' | 'game' | 'complete' | 'soon' = 'menu';
  private dragging: Piece | null = null;
  private pointerOffset: Point = { x: 0, y: 0 };
  private board: Rect = { x: 0, y: 0, width: 0, height: 0 };
  private preview: Rect | null = null;
  private hintPiece: Piece | null = null;
  private hintUntil = 0;
  private bg!: Phaser.GameObjects.Graphics;
  private boardG!: Phaser.GameObjects.Graphics;
  private chrome!: Phaser.GameObjects.Graphics;
  private fx!: Phaser.GameObjects.Graphics;
  private menuArt: Phaser.GameObjects.Image | null = null;
  private guideImage: Phaser.GameObjects.Image | null = null;
  private previewImage: Phaser.GameObjects.Image | null = null;
  private completeImage: Phaser.GameObjects.Image | null = null;
  private raster = { width: 0, height: 0 };

  constructor() { super('puzzle'); }
  preload() { this.load.image('moonlit', ART); }
  create() {
    this.art = new Image(); this.art.src = ART;
    this.art.onload = () => { this.artLoaded = true; if (this.mode === 'game') this.preparePieces(); this.draw(); };
    this.bg = this.add.graphics().setDepth(0);
    this.boardG = this.add.graphics().setDepth(2);
    this.chrome = this.add.graphics().setDepth(120);
    this.fx = this.add.graphics().setDepth(125);
    this.scale.on('resize', () => { this.layout(); this.reflowPieces(); this.draw(); });
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => this.pointerDown(p));
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => this.pointerMove(p));
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => this.pointerUp(p));
    this.input.on('pointerupoutside', (p: Phaser.Input.Pointer) => this.pointerUp(p));
    this.layout(); this.draw();
  }

  private layout() { const layout = gameLayout(this.scale.width, this.scale.height); this.board = layout.board; this.preview = layout.preview; }

  private preparePieces() {
    if (!this.artLoaded || this.pieces.length) return;
    this.layout();
    const cw = 720, ch = 1080, pad = 18;
    this.raster = { width: cw, height: ch };
    this.ensureWholeTexture();
    this.guideImage = this.add.image(this.board.x + this.board.width / 2, this.board.y + this.board.height / 2, 'whole-picture').setDepth(1).setDisplaySize(this.board.width, this.board.height).setAlpha(.23);
    if (this.preview) this.previewImage = this.add.image(0, 0, 'whole-picture').setDepth(3);
    const source = document.createElement('canvas'); source.width = cw; source.height = ch;
    const sctx = source.getContext('2d', { willReadFrequently: true })!;
    sctx.drawImage(this.art, 0, 0, cw, ch);
    const sourcePixels = sctx.getImageData(0, 0, cw, ch).data;
    const { labels, regions } = createRegions(cw, ch);
    const quality = inspectRegions(cw, ch, labels, regions);
    const problems = qualityProblems(quality);
    if (problems.length) console.warn('Puzzle geometry:', problems);
    for (const region of regions) {
      const { x, y, width, height } = region.bounds;
      const tw = width + pad * 2, th = height + pad * 2;
      const clean = document.createElement('canvas'); clean.width = tw; clean.height = th;
      const cctx = clean.getContext('2d')!;
      const pixels = cctx.createImageData(tw, th);
      const hit = new Uint8Array(tw * th);
      for (let py = 0; py < height; py++) for (let px = 0; px < width; px++) {
        const gx = x + px, gy = y + py;
        if (labels[gy * cw + gx] !== region.id) continue;
        const target = ((py + pad) * tw + px + pad) * 4, src = (gy * cw + gx) * 4;
        pixels.data[target] = sourcePixels[src]; pixels.data[target + 1] = sourcePixels[src + 1];
        pixels.data[target + 2] = sourcePixels[src + 2]; pixels.data[target + 3] = 255;
        hit[(py + pad) * tw + px + pad] = 1;
      }
      cctx.putImageData(pixels, 0, 0);
      const loose = document.createElement('canvas'); loose.width = tw; loose.height = th;
      const lctx = loose.getContext('2d')!;
      lctx.save(); lctx.shadowColor = 'rgba(0,0,0,.85)'; lctx.shadowBlur = 22; lctx.shadowOffsetY = 9;
      lctx.drawImage(clean, 0, 0); lctx.restore();
      // A two pixel warm rim follows the actual silhouette. The clean placed texture has no rim.
      const rim = lctx.createImageData(tw, th);
      for (let py = 2; py < th - 2; py++) for (let px = 2; px < tw - 2; px++) {
        const index = py * tw + px;
        if (hit[index]) continue;
        const near = hit[index - 1] || hit[index + 1] || hit[index - tw] || hit[index + tw]
          || hit[index - tw - 1] || hit[index - tw + 1] || hit[index + tw - 1] || hit[index + tw + 1];
        if (!near) continue;
        const q = index * 4; rim.data[q] = 242; rim.data[q + 1] = 202; rim.data[q + 2] = 129; rim.data[q + 3] = 210;
      }
      const rimCanvas = document.createElement('canvas'); rimCanvas.width = tw; rimCanvas.height = th;
      rimCanvas.getContext('2d')!.putImageData(rim, 0, 0);
      lctx.drawImage(rimCanvas, 0, 0); lctx.drawImage(clean, 0, 0);
      this.textures.addCanvas(`piece-clean-${region.id}`, clean);
      this.textures.addCanvas(`piece-loose-${region.id}`, loose);
      const sprite = this.add.image(0, 0, `piece-loose-${region.id}`).setDepth(10 + region.id);
      const piece: Piece = { id: region.id, sprite, region, placed: false, home: { x: 0, y: 0 }, slot: SLOT_ORDER[region.id], hit, texW: tw, texH: th, baseW: 0, baseH: 0 };
      this.pieces.push(piece);
    }
    this.reflowPieces(); this.mode = 'game'; this.persistProgress(); this.draw();
  }

  private reflowPieces() {
    if (!this.pieces.length) return;
    this.dragging = null;
    const cw = this.raster.width, ch = this.raster.height, scale = looseScale(this.scale.width, this.scale.height);
    for (const piece of this.pieces) {
      const b = piece.region.bounds;
      piece.baseW = piece.texW * this.board.width / cw;
      piece.baseH = piece.texH * this.board.height / ch;
      piece.home = { x: this.board.x + (b.x + b.width / 2) / cw * this.board.width, y: this.board.y + (b.y + b.height / 2) / ch * this.board.height };
      const effective = piece.placed ? 1 : scale;
      piece.sprite.setDisplaySize(piece.baseW * effective, piece.baseH * effective);
      const start = startPosition(this.board, this.scale.width, piece.slot, piece.sprite.displayWidth, piece.sprite.displayHeight);
      piece.sprite.setPosition(piece.placed ? piece.home.x : start.x, piece.placed ? piece.home.y : start.y);
    }
    this.guideImage?.setPosition(this.board.x + this.board.width / 2, this.board.y + this.board.height / 2).setDisplaySize(this.board.width, this.board.height);
    this.completeImage?.setPosition(this.board.x + this.board.width / 2, this.board.y + this.board.height / 2).setDisplaySize(this.board.width, this.board.height);
  }

  private pointerDown(pointer: Phaser.Input.Pointer) {
    const { x, y } = pointer;
    if (this.mode === 'menu') { if (this.menuButton().contains(x, y)) this.startGame(); return; }
    if (this.mode === 'soon') { this.mode = 'menu'; this.draw(); return; }
    if (this.backButton().contains(x, y)) { this.mode = 'menu'; this.removePieces(); this.draw(); return; }
    if (this.mode === 'complete') { if (canAdvance(true, this.nextButton().contains(x, y))) { this.removePieces(); this.mode = 'soon'; this.draw(); } return; }
    if (this.hintButton().contains(x, y)) { this.showHint(); return; }
    const hit = [...this.pieces].sort((a, b) => b.sprite.depth - a.sprite.depth).find(p => canDrag(p.placed) && this.pieceContains(p, x, y));
    if (!hit) return;
    this.dragging = hit;
    hit.sprite.setDepth(100).setTint(0xfff3cf);
    this.pointerOffset = { x: hit.sprite.x - x, y: hit.sprite.y - y };
  }
  private pointerMove(pointer: Phaser.Input.Pointer) {
    if (!this.dragging) return;
    const p = this.dragging;
    p.sprite.x = Phaser.Math.Clamp(pointer.x + this.pointerOffset.x, 3 + p.sprite.displayWidth / 2, this.scale.width - 3 - p.sprite.displayWidth / 2);
    p.sprite.y = Phaser.Math.Clamp(pointer.y + this.pointerOffset.y, this.board.y + p.sprite.displayHeight / 2, this.board.y + this.board.height - p.sprite.displayHeight / 2);
  }
  private pointerUp(_pointer: Phaser.Input.Pointer) {
    if (!this.dragging) return;
    const p = this.dragging; this.dragging = null;
    p.sprite.clearTint().setDepth(10 + p.id);
    const radius = Math.max(28, this.board.width * .14);
    if (shouldSnap({ x: p.sprite.x, y: p.sprite.y }, p.home, radius)) {
      p.placed = true; this.persistProgress();
      this.tweens.add({ targets: p.sprite, x: p.home.x, y: p.home.y, displayWidth: p.baseW, displayHeight: p.baseH, duration: 250, ease: 'Sine.Out', onComplete: () => {
        p.sprite.setTexture(`piece-clean-${p.id}`).setDisplaySize(p.baseW, p.baseH);
        this.playChime();
        if (isComplete(this.pieces.map(piece => piece.placed))) this.finish();
        this.draw();
      } });
    } else this.draw();
  }
  private pieceContains(piece: Piece, x: number, y: number) {
    const sprite = piece.sprite;
    const px = Math.floor((x - (sprite.x - sprite.displayWidth / 2)) / sprite.displayWidth * piece.texW);
    const py = Math.floor((y - (sprite.y - sprite.displayHeight / 2)) / sprite.displayHeight * piece.texH);
    return px >= 0 && py >= 0 && px < piece.texW && py < piece.texH && piece.hit[py * piece.texW + px] === 1;
  }
  private showHint() {
    const piece = this.pieces.find(p => !p.placed); if (!piece) return;
    this.hintPiece = piece; this.hintUntil = this.time.now + 1800;
    this.tweens.add({ targets: piece.sprite, alpha: .48, yoyo: true, repeat: 3, duration: 185, onComplete: () => piece.sprite.setAlpha(1) });
  }
  private finish() {
    this.mode = 'complete';
    this.completeImage = this.add.image(this.board.x + this.board.width / 2, this.board.y + this.board.height / 2, 'whole-picture').setDepth(60).setDisplaySize(this.board.width, this.board.height).setAlpha(0);
    this.tweens.add({ targets: this.completeImage, alpha: 1, duration: 650, ease: 'Sine.Out', onComplete: () => { this.pieces.forEach(p => p.sprite.setVisible(false)); this.guideImage?.setVisible(false); } });
    localStorage.setItem('mystic-puzzles-complete', 'true');
    this.draw();
  }
  private playChime() {
    try {
      const Audio = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Audio) return;
      const ctx = new Audio(), osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.type = 'sine'; osc.frequency.setValueAtTime(660, ctx.currentTime); osc.frequency.exponentialRampToValueAtTime(990, ctx.currentTime + .16);
      gain.gain.setValueAtTime(.0001, ctx.currentTime); gain.gain.exponentialRampToValueAtTime(.12, ctx.currentTime + .02); gain.gain.exponentialRampToValueAtTime(.0001, ctx.currentTime + .5);
      osc.connect(gain); gain.connect(ctx.destination); osc.start(); osc.stop(ctx.currentTime + .5); osc.onended = () => void ctx.close();
    } catch { /* Sound is optional on devices without Web Audio. */ }
  }
  private startGame() { this.menuArt?.destroy(); this.menuArt = null; this.mode = 'game'; this.preparePieces(); this.draw(); }
  private removePieces() {
    this.dragging = null; this.pieces.forEach(p => p.sprite.destroy()); this.pieces = [];
    this.guideImage?.destroy(); this.guideImage = null; this.previewImage?.destroy(); this.previewImage = null;
    this.completeImage?.destroy(); this.completeImage = null;
    for (let id = 0; id < 8; id++) { this.textures.remove(`piece-clean-${id}`); this.textures.remove(`piece-loose-${id}`); }
  }
  private persistProgress() { localStorage.setItem('mystic-puzzles-progress', JSON.stringify({ level: 1, placed: this.pieces.filter(p => p.placed).map(p => p.id) })); }
  private menuButton() { const w = this.scale.width, h = this.scale.height; return new Phaser.Geom.Rectangle(w / 2 - Math.min(296, w * .7) / 2, h - (h < 700 ? 112 : 138), Math.min(296, w * .7), 62); }
  private nextButton() { const w = this.scale.width, h = this.scale.height; return new Phaser.Geom.Rectangle(w / 2 - Math.min(310, w * .76) / 2, h - 65, Math.min(310, w * .76), 52); }
  private backButton() { const h = this.scale.height; return new Phaser.Geom.Circle(this.headerCenter() - this.headerWidth() / 2 + 31, h < 700 ? 36 : 43, 25); }
  private hintButton() { const h = this.scale.height; return new Phaser.Geom.Circle(this.headerCenter() + this.headerWidth() / 2 - 31, h < 700 ? 36 : 43, 25); }
  private headerCenter() { return this.preview ? (this.board.x + this.preview.x + this.preview.width) / 2 : this.scale.width / 2; }
  private headerWidth() { return this.preview ? this.preview.x + this.preview.width - this.board.x : Math.min(this.scale.width - 16, 440); }

  update() {
    this.fx.clear();
    if (this.mode === 'game' && this.hintPiece && this.time.now < this.hintUntil) {
      const p = this.hintPiece;
      this.fx.lineStyle(3, 0xffda7c, .8).strokeCircle(p.home.x, p.home.y, 31 + Math.sin(this.time.now / 120) * 4);
      this.fx.lineStyle(1, 0xffeec3, .6).strokeCircle(p.home.x, p.home.y, 40 + Math.sin(this.time.now / 120) * 4);
    }
  }
  private draw() {
    if (!this.bg) return;
    const w = this.scale.width, h = this.scale.height;
    this.layout(); this.bg.clear(); this.boardG.clear(); this.chrome.clear();
    this.children.list.filter(c => c.getData('uiText')).forEach(c => c.destroy());
    this.bg.fillGradientStyle(0x050e1c, 0x050e1c, 0x132d43, 0x132d43, 1).fillRect(0, 0, w, h);
    this.drawAtmosphere(w, h);
    if (this.mode === 'menu') this.drawMenu(w, h);
    else if (this.mode === 'soon') this.drawSoon(w, h);
    else this.drawGame(w, h);
  }
  private drawAtmosphere(w: number, h: number) {
    this.bg.fillStyle(0xffde9c, .35);
    for (let i = 0; i < 62; i++) { const x = (i * 91 + 29) % w, y = (i * 157 + 11) % h; this.bg.fillCircle(x, y, i % 9 === 0 ? 1.7 : .75); }
    this.bg.lineStyle(1, 0xc28d51, .12);
    for (let i = 0; i < 5; i++) this.bg.strokeCircle(w * (i % 2 ? .93 : .07), h * (.15 + i * .2), 32 + i * 11);
  }
  private drawMenu(w: number, h: number) {
    if (this.artLoaded) {
      if (!this.menuArt || !this.menuArt.active) this.menuArt = this.add.image(w / 2, h / 2, 'moonlit').setDepth(1);
      const artW = Math.min(w * (w > 700 ? .52 : .97), (h - 132) * 2 / 3);
      this.menuArt.setVisible(true).setPosition(w / 2, h * .51).setDisplaySize(artW, artW * 1.5).setAlpha(.95);
      this.boardG.lineStyle(2, 0xc7914b, .8).strokeRoundedRect(w / 2 - artW / 2 - 3, h * .51 - artW * .75 - 3, artW + 6, artW * 1.5 + 6, 18);
    }
    const signW = Math.min(340, w - 30), signH = h < 700 ? 122 : 142, signY = h < 700 ? 91 : 109;
    this.chrome.fillStyle(0x030609, .65).fillRoundedRect(w / 2 - signW / 2 + 4, signY - signH / 2 + 7, signW, signH, 24);
    this.chrome.fillGradientStyle(0x694122, 0x392315, 0x21170f, 0x5c361b, 1).fillRoundedRect(w / 2 - signW / 2, signY - signH / 2, signW, signH, 23);
    this.chrome.lineStyle(3, 0xd69b4d, .95).strokeRoundedRect(w / 2 - signW / 2 + 3, signY - signH / 2 + 3, signW - 6, signH - 6, 20);
    this.chrome.lineStyle(1, 0xf5d184, .65).strokeRoundedRect(w / 2 - signW / 2 + 9, signY - signH / 2 + 9, signW - 18, signH - 18, 16);
    for (const side of [-1, 1]) { this.chrome.fillStyle(0xffdc8c, .8).fillCircle(w / 2 + side * (signW / 2 - 18), signY, 3); }
    this.txt(w / 2, signY - 25, 'Мистические', Math.min(37, w * .097), '#ffe1a1', true);
    this.txt(w / 2, signY + 26, 'Пазлы', Math.min(55, w * .145), '#ffd177', true);
    this.txt(w / 2, h - (h < 700 ? 144 : 174), 'Собирай волшебные картины', Math.min(17, w * .043), '#fff0cc', true);
    const button = this.menuButton(); this.button(button.centerX, button.centerY, button.width, button.height, 'Играть');
    this.txt(w / 2, h - 39, 'Галерея откроется в следующих версиях', 12, '#d9c7a4');
  }
  private drawGame(w: number, h: number) {
    this.menuArt?.setVisible(false);
    const b = this.board;
    this.boardG.fillStyle(0x02070e, .63).fillRoundedRect(b.x - 7, b.y - 7, b.width + 14, b.height + 14, 15);
    this.boardG.lineStyle(2, 0xbf8d4b, .85).strokeRoundedRect(b.x - 7, b.y - 7, b.width + 14, b.height + 14, 15);
    this.boardG.lineStyle(1, 0xffdd99, .3).strokeRoundedRect(b.x - 3, b.y - 3, b.width + 6, b.height + 6, 12);
    this.guideImage?.setPosition(b.x + b.width / 2, b.y + b.height / 2).setDisplaySize(b.width, b.height);
    this.completeImage?.setPosition(b.x + b.width / 2, b.y + b.height / 2).setDisplaySize(b.width, b.height);
    if (this.preview && this.mode === 'game' && this.previewImage) {
      const p = this.preview;
      this.boardG.fillStyle(0x090e18, .85).fillRoundedRect(p.x - 8, p.y - 8, p.width + 16, p.height + 16, 12);
      this.boardG.lineStyle(2, 0xbd8f53, .9).strokeRoundedRect(p.x - 8, p.y - 8, p.width + 16, p.height + 16, 12);
      this.previewImage.setVisible(true).setPosition(p.x + p.width / 2, p.y + p.height / 2).setDisplaySize(p.width, p.height);
      this.txt(p.x + p.width / 2, p.y - 34, 'ВОЛШЕБНАЯ КАРТИНА', 15, '#ffe4ad', true);
    } else this.previewImage?.setVisible(false);
    const hw = this.headerWidth(), hx = this.headerCenter(), hy = h < 700 ? 36 : 43;
    this.chrome.fillGradientStyle(0x142b3b, 0x182b39, 0x071421, 0x0a1a2b, 1).fillRoundedRect(hx - hw / 2, 7, hw, hy * 2 - 7, 16);
    this.chrome.lineStyle(1.5, 0xbd8546, .8).strokeRoundedRect(hx - hw / 2 + 1, 8, hw - 2, hy * 2 - 9, 15);
    const back = this.backButton(), hint = this.hintButton();
    this.iconCircle(back.x, back.y); this.iconCircle(hint.x, hint.y);
    this.txt(back.x, back.y - 1, '‹', 37, '#ffe5ae', true);
    this.bulb(hint.x, hint.y);
    const plaqueW = Math.min(158, hw - 135);
    this.chrome.fillStyle(0x48301b, .95).fillRoundedRect(hx - plaqueW / 2, 13, plaqueW, hy * 2 - 19, 9);
    this.chrome.lineStyle(1.2, 0xe2ad62, .88).strokeRoundedRect(hx - plaqueW / 2 + 2, 15, plaqueW - 4, hy * 2 - 23, 8);
    this.txt(hx, h < 700 ? 24 : 29, 'Уровень 1', h < 700 ? 13 : 15, '#fff2d4', true);
    const count = this.pieces.filter(p => p.placed).length;
    const stars = this.mode === 'complete' ? '★  ★  ★' : count >= 5 ? '★  ★  ☆' : count > 0 ? '★  ☆  ☆' : '☆  ☆  ☆';
    this.txt(hx, h < 700 ? 48 : 58, stars, 20, '#ffcf69', true);
    if (this.mode === 'complete') {
      if (this.preview) {
        const p = this.preview, center = p.x + p.width / 2;
        this.boardG.fillGradientStyle(0x142b3b, 0x142b3b, 0x07131f, 0x07131f, .8).fillRoundedRect(p.x - 8, p.y + 80, p.width + 16, p.height - 160, 18);
        this.boardG.lineStyle(1.5, 0xc69553, .75).strokeRoundedRect(p.x - 8, p.y + 80, p.width + 16, p.height - 160, 18);
        this.txt(center, p.y + 190, '✦  ★  ★  ★  ✦', 30, '#ffdc8f', true);
        this.txt(center, p.y + 265, 'Картина ожила', 30, '#ffe5b1', true);
        this.txt(center, p.y + 335, 'Самые тёплые огни', 19, '#e9dac1');
        this.txt(center, p.y + 364, 'видны в тишине…', 19, '#e9dac1');
      }
      this.txt(b.x + b.width / 2, b.y + b.height + 29, 'Самые тёплые огни видны в тишине…', Math.min(16, w * .04), '#ffe8b8', true);
      const next = this.nextButton(); this.button(next.centerX, next.centerY, next.width, next.height, 'Следующий уровень');
    } else {
      this.txt(b.x + b.width / 2, b.y + b.height + 27, `${count} / 8 собрано`, 16, '#f4d9a6', true);
      this.txt(b.x + b.width / 2, Math.min(h - 28, b.y + b.height + 64), 'Перетаскивай фрагменты на картину', Math.min(14, w * .035), '#e7d7bc');
    }
  }
  private drawSoon(w: number, h: number) {
    this.txt(w / 2, h * .4, 'Новые картины скоро', 27, '#ffe0aa', true);
    this.button(w / 2, h * .62, Math.min(270, w * .7), 54, 'В главное меню');
  }
  private iconCircle(x: number, y: number) {
    this.chrome.fillStyle(0x050b11, .7).fillCircle(x, y + 3, 22);
    this.chrome.fillStyle(0xbb813b, 1).fillCircle(x, y, 21);
    this.chrome.fillStyle(0x412714, 1).fillCircle(x, y, 17);
    this.chrome.lineStyle(1, 0xffdc91, .8).strokeCircle(x, y, 18);
  }
  private bulb(x: number, y: number) {
    this.chrome.fillStyle(0xffdf88, 1).fillCircle(x, y - 4, 9);
    this.chrome.fillStyle(0xffca5d, 1).fillRoundedRect(x - 5, y + 3, 10, 10, 3);
    this.chrome.fillStyle(0x724421, 1).fillRoundedRect(x - 4, y + 11, 8, 3, 2);
    this.chrome.lineStyle(2, 0xffe6a6, .85).strokeCircle(x, y - 4, 10);
  }
  private button(x: number, y: number, w: number, h: number, label: string) {
    this.chrome.fillStyle(0x020704, .65).fillRoundedRect(x - w / 2 + 2, y - h / 2 + 6, w, h, h / 2);
    this.chrome.fillStyle(0xbd8741, 1).fillRoundedRect(x - w / 2, y - h / 2, w, h, h / 2);
    this.chrome.fillGradientStyle(0x4d994d, 0x34783d, 0x174a31, 0x1d5938, 1).fillRoundedRect(x - w / 2 + 4, y - h / 2 + 4, w - 8, h - 8, h / 2);
    this.chrome.lineStyle(1.2, 0xffe5a1, .85).strokeRoundedRect(x - w / 2 + 7, y - h / 2 + 7, w - 14, h - 14, h / 2);
    this.txt(x, y - 1, label, Math.min(22, h * .37), '#fff5da', true);
  }
  private txt(x: number, y: number, value: string, size: number, color: string, bold = false) {
    this.add.text(x, y, value, { fontFamily: 'Georgia, serif', fontSize: `${size}px`, color, fontStyle: bold ? 'bold' : 'normal', align: 'center', shadow: { color: '#05070c', blur: 6, fill: true, offsetY: 2 } }).setOrigin(.5).setDepth(200).setData('uiText', true);
  }
  private ensureWholeTexture() {
    if (this.textures.exists('whole-picture')) return;
    const canvas = document.createElement('canvas'); canvas.width = 720; canvas.height = 1080;
    canvas.getContext('2d')!.drawImage(this.art, 0, 0, 720, 1080);
    this.textures.addCanvas('whole-picture', canvas);
  }
}

const game = new Phaser.Game({
  type: Phaser.AUTO, parent: 'game', backgroundColor: '#071326', antialias: true,
  scale: { mode: Phaser.Scale.RESIZE, autoCenter: Phaser.Scale.CENTER_BOTH, width: window.innerWidth, height: window.innerHeight },
  input: { activePointers: 1, smoothFactor: 0 }, render: { pixelArt: false, roundPixels: false }, scene: [PuzzleScene],
});

if (import.meta.env.DEV) Object.assign(window, { __mysticGame: game });
