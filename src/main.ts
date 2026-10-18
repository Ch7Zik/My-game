/// <reference types="vite/client" />
import Phaser from 'phaser';
import { createRegions, inspectRegions, qualityProblems, type PieceRegion, type Point } from './geometry';
import { canAdvance, canDrag, isComplete, shouldSnap, wasDragged } from './puzzleRules';
import { gameLayout, looseScale, startPosition, SLOT_ORDER, type Rect } from './layout';
import { LEVELS, levelById, type LevelConfig } from './levels';
import { completeLevel, isInGallery, isUnlocked, nextUnplayed, restoreProgress, saveProgress, selectLevel, type Progress } from './progress';
import './style.css';

type Piece = { id: number; sprite: Phaser.GameObjects.Image; region: PieceRegion; placed: boolean; home: Point; slot: number; hit: Uint8Array; texW: number; texH: number; baseW: number; baseH: number };
const safeStorage = {
  getItem(key: string): string | null { try { return localStorage.getItem(key); } catch { return null; } },
  setItem(key: string, value: string): void { try { localStorage.setItem(key, value); } catch { /* Storage may be disabled. */ } },
};
class PuzzleScene extends Phaser.Scene {
  private art!: HTMLImageElement;
  private artLoaded = false;
  private level: LevelConfig = LEVELS[0];
  private progress: Progress = restoreProgress(safeStorage);
  private pieces: Piece[] = [];
  private mode: 'menu' | 'levels' | 'gallery' | 'view' | 'game' | 'complete' = 'menu';
  private viewedLevel = 1;
  private menuPressed = false;
  private tutorialDone = false;
  private dragging: Piece | null = null;
  private pointerOffset: Point = { x: 0, y: 0 };
  private dragOrigin: Point = { x: 0, y: 0 };
  private board: Rect = { x: 0, y: 0, width: 0, height: 0 };
  private preview: Rect | null = null;
  private hintPiece: Piece | null = null;
  private hintUntil = 0;
  private bg!: Phaser.GameObjects.Graphics;
  private boardG!: Phaser.GameObjects.Graphics;
  private chrome!: Phaser.GameObjects.Graphics;
  private fx!: Phaser.GameObjects.Graphics;
  private menuArt: Phaser.GameObjects.Image | null = null;
  private uiImages: Phaser.GameObjects.Image[] = [];
  private guideImage: Phaser.GameObjects.Image | null = null;
  private previewImage: Phaser.GameObjects.Image | null = null;
  private completeImage: Phaser.GameObjects.Image | null = null;
  private raster = { width: 0, height: 0 };

  constructor() { super('puzzle'); }
  preload() {
    this.load.image('menu-forest', '/assets/menu-forest.webp');
    this.load.image('menu-forest-wide', '/assets/menu-forest-wide.webp');
    for (const level of LEVELS) this.load.image(`art-${level.id}`, level.art);
  }
  create() {
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
    const { labels, regions } = createRegions(cw, ch, this.level.columns, this.level.rows, this.level.seed);
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
      // A soft two-pixel rim follows the silhouette. Placed pieces use the clean texture.
      const rim = lctx.createImageData(tw, th);
      for (let py = 2; py < th - 2; py++) for (let px = 2; px < tw - 2; px++) {
        const index = py * tw + px;
        if (hit[index]) continue;
        const inner = hit[index - 1] || hit[index + 1] || hit[index - tw] || hit[index + tw]
          || hit[index - tw - 1] || hit[index - tw + 1] || hit[index + tw - 1] || hit[index + tw + 1];
        const outer = hit[index - 2] || hit[index + 2] || hit[index - tw * 2] || hit[index + tw * 2];
        if (!inner && !outer) continue;
        const q = index * 4; rim.data[q] = 242; rim.data[q + 1] = 202; rim.data[q + 2] = 129; rim.data[q + 3] = inner ? 220 : 90;
      }
      const rimCanvas = document.createElement('canvas'); rimCanvas.width = tw; rimCanvas.height = th;
      rimCanvas.getContext('2d')!.putImageData(rim, 0, 0);
      lctx.drawImage(rimCanvas, 0, 0); lctx.drawImage(clean, 0, 0);
      this.textures.addCanvas(`piece-clean-${region.id}`, clean);
      this.textures.addCanvas(`piece-loose-${region.id}`, loose);
      const sprite = this.add.image(0, 0, `piece-loose-${region.id}`).setDepth(10 + region.id);
      const piece: Piece = { id: region.id, sprite, region, placed: false, home: { x: 0, y: 0 }, slot: this.level.slots[region.id] ?? SLOT_ORDER[region.id], hit, texW: tw, texH: th, baseW: 0, baseH: 0 };
      this.pieces.push(piece);
    }
    this.reflowPieces(); this.mode = 'game'; this.draw();
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
    if (this.mode === 'menu') {
      if (this.menuButton().contains(x, y)) {
        const next = nextUnplayed(this.progress);
        this.menuPressed = true; this.draw();
        this.time.delayedCall(100, () => {
          this.menuPressed = false;
          if (next > LEVELS.length) { this.mode = 'levels'; this.draw(); } else this.startGame(next);
        });
      } else if (this.levelsButton().contains(x, y)) { this.mode = 'levels'; this.draw(); }
      else if (this.galleryButton().contains(x, y)) { this.mode = 'gallery'; this.draw(); }
      return;
    }
    if (this.mode === 'levels' || this.mode === 'gallery') {
      if (this.backButton().contains(x, y)) { this.mode = 'menu'; this.draw(); return; }
      const id = this.cardAt(x, y);
      if (id && this.mode === 'levels' && isUnlocked(this.progress, id)) this.startGame(id);
      else if (id && this.mode === 'gallery' && isInGallery(this.progress, id)) { this.viewedLevel = id; this.mode = 'view'; this.draw(); }
      return;
    }
    if (this.mode === 'view') { if (this.backButton().contains(x, y)) { this.mode = 'gallery'; this.draw(); } return; }
    if (this.backButton().contains(x, y)) { this.mode = 'levels'; this.removePieces(); this.draw(); return; }
    if (this.mode === 'complete') {
      if (this.hintButton().contains(x, y)) { this.removePieces(); this.mode = 'gallery'; this.draw(); return; }
      if (canAdvance(true, this.nextButton().contains(x, y))) {
        const next = this.level.id + 1;
        if (next <= LEVELS.length) this.startGame(next);
        else { this.removePieces(); this.mode = 'gallery'; this.draw(); }
      }
      return;
    }
    if (this.hintButton().contains(x, y)) { this.showHint(); return; }
    const hit = [...this.pieces].sort((a, b) => b.sprite.depth - a.sprite.depth).find(p => canDrag(p.placed) && this.pieceContains(p, x, y));
    if (!hit) return;
    this.dragging = hit;
    hit.sprite.setDepth(100).setTint(0xfff3cf);
    this.pointerOffset = { x: hit.sprite.x - x, y: hit.sprite.y - y };
    this.dragOrigin = { x: hit.sprite.x, y: hit.sprite.y };
    const scale = looseScale(this.scale.width, this.scale.height) * 1.025;
    hit.sprite.setDisplaySize(hit.baseW * scale, hit.baseH * scale);
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
    const moved = wasDragged(this.dragOrigin, { x: p.sprite.x, y: p.sprite.y });
    const scale = looseScale(this.scale.width, this.scale.height);
    p.sprite.setDisplaySize(p.baseW * scale, p.baseH * scale);
    const radius = Math.max(28, this.board.width * .14);
    if (moved && shouldSnap({ x: p.sprite.x, y: p.sprite.y }, p.home, radius)) {
      p.placed = true; if (this.level.id === 1) this.tutorialDone = true;
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
    this.progress = completeLevel(this.progress, this.level.id);
    saveProgress(safeStorage, this.progress);
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
  private startGame(id: number) {
    if (!isUnlocked(this.progress, id)) return;
    this.removePieces();
    this.level = levelById(id);
    this.progress = selectLevel(this.progress, id);
    saveProgress(safeStorage, this.progress);
    this.mode = 'game'; this.artLoaded = false; this.tutorialDone = false;
    const selected = id;
    this.art = new Image();
    this.art.onload = () => { if (this.mode !== 'game' || this.level.id !== selected) return; this.artLoaded = true; this.preparePieces(); this.draw(); };
    this.art.src = this.level.art;
    this.draw();
  }
  private removePieces() {
    this.dragging = null; this.hintPiece = null; this.pieces.forEach(p => p.sprite.destroy()); this.pieces = [];
    this.guideImage?.destroy(); this.guideImage = null; this.previewImage?.destroy(); this.previewImage = null;
    this.completeImage?.destroy(); this.completeImage = null;
    for (let id = 0; id < 8; id++) { if (this.textures.exists(`piece-clean-${id}`)) this.textures.remove(`piece-clean-${id}`); if (this.textures.exists(`piece-loose-${id}`)) this.textures.remove(`piece-loose-${id}`); }
    if (this.textures.exists('whole-picture')) this.textures.remove('whole-picture');
  }
  private menuButton() { const w = this.scale.width, h = this.scale.height, width = Math.min(w >= 900 ? 340 : 296, w * .7); return new Phaser.Geom.Rectangle(w / 2 - width / 2, h - (h < 700 ? 112 : 138), width, w >= 900 ? 68 : 62); }
  private galleryButton() { const w = this.scale.width, h = this.scale.height, width = Math.min(w >= 900 ? 170 : 155, w * .41); return new Phaser.Geom.Rectangle(w / 2 + 7, h < 700 ? h - 49 : h - 73, width, h < 700 ? 38 : 43); }
  private levelsButton() { const w = this.scale.width, h = this.scale.height, width = Math.min(w >= 900 ? 170 : 155, w * .41); return new Phaser.Geom.Rectangle(w / 2 - width - 7, h < 700 ? h - 49 : h - 73, width, h < 700 ? 38 : 43); }
  private nextButton() { const w = this.scale.width, h = this.scale.height; return new Phaser.Geom.Rectangle(w / 2 - Math.min(310, w * .76) / 2, h < 700 ? h - 48 : h - 65, Math.min(310, w * .76), h < 700 ? 46 : 52); }
  private backButton() { const h = this.scale.height; return new Phaser.Geom.Circle(this.headerCenter() - this.headerWidth() / 2 + 31, h < 700 ? 36 : 43, 25); }
  private hintButton() { const h = this.scale.height; return new Phaser.Geom.Circle(this.headerCenter() + this.headerWidth() / 2 - 31, h < 700 ? 36 : 43, 25); }
  private headerCenter() { return this.preview ? (this.board.x + this.preview.x + this.preview.width) / 2 : this.scale.width / 2; }
  private headerWidth() { return this.preview ? this.preview.x + this.preview.width - this.board.x : Math.min(this.scale.width - 16, 440); }

  update() {
    this.fx.clear();
    if (this.dragging) {
      const p = this.dragging, distance = Math.hypot(p.sprite.x - p.home.x, p.sprite.y - p.home.y);
      const range = Math.max(70, this.board.width * .27);
      if (distance < range) {
        const glow = (1 - distance / range) * .6;
        this.fx.lineStyle(2, 0xffd582, glow).strokeCircle(p.home.x, p.home.y, 22 + 8 * (1 - glow));
        this.fx.lineStyle(1, 0xffedbd, glow * .7).strokeCircle(p.home.x, p.home.y, 32 + 8 * (1 - glow));
      }
    }
    if (this.mode === 'game' && this.hintPiece && this.time.now < this.hintUntil) {
      const p = this.hintPiece;
      this.fx.lineStyle(3, 0xffda7c, .8).strokeCircle(p.home.x, p.home.y, 31 + Math.sin(this.time.now / 120) * 4);
      this.fx.lineStyle(1, 0xffeec3, .6).strokeCircle(p.home.x, p.home.y, 40 + Math.sin(this.time.now / 120) * 4);
    }
    if (this.mode === 'game' && this.level.id === 1 && !this.tutorialDone && !this.dragging && this.pieces.length) {
      const p = this.pieces[0];
      const phase = (Math.sin(this.time.now / 500) + 1) / 2;
      const dx = p.home.x - p.sprite.x, dy = p.home.y - p.sprite.y, length = Math.hypot(dx, dy) || 1;
      const x = p.sprite.x + dx / length * phase * 35, y = p.sprite.y + dy / length * phase * 35;
      this.fx.lineStyle(2, 0xffdc86, .5).lineBetween(p.sprite.x, p.sprite.y, p.sprite.x + dx / length * 48, p.sprite.y + dy / length * 48);
      this.fx.fillStyle(0xffedba, .74).fillCircle(x, y, 10);
      this.fx.lineStyle(2, 0x9c6e38, .9).strokeCircle(x, y, 10);
    }
  }
  private draw() {
    if (!this.bg) return;
    const w = this.scale.width, h = this.scale.height;
    this.layout(); this.bg.clear(); this.boardG.clear(); this.chrome.clear();
    this.children.list.filter(c => c.getData('uiText')).forEach(c => c.destroy());
    this.uiImages.forEach(image => image.destroy()); this.uiImages = [];
    this.menuArt?.setVisible(this.mode === 'menu');
    this.bg.fillGradientStyle(0x050e1c, 0x050e1c, 0x132d43, 0x132d43, 1).fillRect(0, 0, w, h);
    this.drawAtmosphere(w, h);
    if (this.mode === 'menu') this.drawMenu(w, h);
    else if (this.mode === 'levels' || this.mode === 'gallery') this.drawCards(w, h);
    else if (this.mode === 'view') this.drawGalleryView(w, h);
    else this.drawGame(w, h);
  }
  private drawAtmosphere(w: number, h: number) {
    this.bg.fillStyle(0xffde9c, .35);
    for (let i = 0; i < 62; i++) { const x = (i * 91 + 29) % w, y = (i * 157 + 11) % h; this.bg.fillCircle(x, y, i % 9 === 0 ? 1.7 : .75); }
    this.bg.lineStyle(1, 0xc28d51, .12);
    for (let i = 0; i < 5; i++) this.bg.strokeCircle(w * (i % 2 ? .93 : .07), h * (.15 + i * .2), 32 + i * 11);
  }
  private drawMenu(w: number, h: number) {
    const key = w >= 900 ? 'menu-forest-wide' : 'menu-forest';
    if (!this.menuArt || !this.menuArt.active || this.menuArt.texture.key !== key) {
      this.menuArt?.destroy(); this.menuArt = this.add.image(w / 2, h / 2, key).setDepth(1);
    }
    const source = this.textures.get(key).getSourceImage() as HTMLImageElement;
    const scale = Math.max(w / source.width, h / source.height);
    this.menuArt.setVisible(true).setPosition(w / 2, h / 2).setDisplaySize(source.width * scale, source.height * scale);
    this.boardG.fillStyle(0x03101a, .3).fillRect(0, 0, w, h * .27);
    this.boardG.fillStyle(0x020a11, .55).fillRect(0, h * .78, w, h * .22);
    const signW = Math.min(w >= 900 ? 500 : 340, w - 30), signH = h < 700 ? 122 : w >= 900 ? 174 : 142, signY = h < 700 ? 91 : w >= 900 ? 130 : 109;
    for (const side of [-1, 1]) {
      const lx = w / 2 + side * (signW / 2 - 29);
      this.chrome.lineStyle(2, 0xb88546, .8).lineBetween(lx, 1, lx, signY - signH / 2 + 17);
    }
    this.chrome.fillStyle(0x030609, .65).fillRoundedRect(w / 2 - signW / 2 + 4, signY - signH / 2 + 7, signW, signH, 24);
    this.chrome.fillGradientStyle(0x694122, 0x392315, 0x21170f, 0x5c361b, 1).fillRoundedRect(w / 2 - signW / 2, signY - signH / 2, signW, signH, 23);
    this.chrome.lineStyle(3, 0xd69b4d, .95).strokeRoundedRect(w / 2 - signW / 2 + 3, signY - signH / 2 + 3, signW - 6, signH - 6, 20);
    this.chrome.lineStyle(1, 0xf5d184, .65).strokeRoundedRect(w / 2 - signW / 2 + 9, signY - signH / 2 + 9, signW - 18, signH - 18, 16);
    for (let i = 0; i < 8; i++) {
      const yy = signY - signH / 2 + 21 + i * (signH - 40) / 7;
      this.chrome.lineStyle(1, i % 2 ? 0xe0aa65 : 0x120b08, .14).lineBetween(w / 2 - signW / 2 + 19, yy, w / 2 + signW / 2 - 20 - (i % 3) * 15, yy + (i % 2 ? 2 : -2));
    }
    this.chrome.fillStyle(0xffe1a0, .15).fillRoundedRect(w / 2 - signW / 2 + 13, signY - signH / 2 + 13, signW - 26, 7, 3);
    for (const side of [-1, 1]) { this.chrome.fillStyle(0xffdc8c, .8).fillCircle(w / 2 + side * (signW / 2 - 18), signY, 3); }
    for (const side of [-1, 1]) this.lantern(w / 2 + side * (signW / 2 - 29), signY - signH / 2 + 19);
    this.txt(w / 2, signY - (w >= 900 ? 31 : 25), 'Мистические', Math.min(w >= 900 ? 52 : 37, w * .097), '#ffe1a1', true);
    this.txt(w / 2, signY + (w >= 900 ? 36 : 26), 'Пазлы', Math.min(w >= 900 ? 72 : 55, w * .145), '#ffd177', true);
    this.txt(w / 2, h - (h < 700 ? 159 : 184), 'Собирай волшебные картины', Math.min(w >= 900 ? 21 : 17, w * .043), '#fff0cc', true);
    const button = this.menuButton(); this.button(button.centerX, button.centerY + (this.menuPressed ? 3 : 0), button.width, button.height - (this.menuPressed ? 4 : 0), 'Играть');
    for (const [rect, label] of [[this.levelsButton(), 'Уровни'], [this.galleryButton(), 'Галерея']] as const) {
      this.chrome.fillStyle(0x302215, .94).fillRoundedRect(rect.x, rect.y, rect.width, rect.height, 12);
      this.chrome.lineStyle(1.4, 0xd4a463, .9).strokeRoundedRect(rect.x + 1, rect.y + 1, rect.width - 2, rect.height - 2, 11);
      this.txt(rect.centerX, rect.centerY, label, h < 700 ? 15 : 17, '#f4ddb4', true);
    }
  }
  private cardRects(): Phaser.Geom.Rectangle[] {
    const w = this.scale.width, h = this.scale.height;
    if (w >= 900) {
      const gap = 15, group = Math.min(w - 80, 1380), width = (group - gap * 4) / 5;
      return LEVELS.map((_, i) => new Phaser.Geom.Rectangle((w - group) / 2 + i * (width + gap), Math.max(135, (h - 420) / 2), width, 420));
    }
    const top = h < 700 ? 78 : 112, gap = h < 700 ? 7 : 11;
    const height = Math.min(116, (h - top - 69 - gap * 4) / 5);
    return LEVELS.map((_, i) => new Phaser.Geom.Rectangle(14, top + i * (height + gap), w - 28, height));
  }
  private cardAt(x: number, y: number): number | null {
    const index = this.cardRects().findIndex(rect => rect.contains(x, y));
    return index < 0 ? null : LEVELS[index].id;
  }
  private drawCards(w: number, h: number) {
    const isGallery = this.mode === 'gallery';
    const back = this.backButton(); this.iconCircle(back.x, back.y); this.backArrow(back.x, back.y);
    this.txt(w / 2, h < 700 ? 37 : 45, isGallery ? 'Галерея картин' : 'Выбор уровня', Math.min(28, w * .07), '#ffe1a0', true);
    const desktop = w >= 900;
    const rects = this.cardRects();
    for (let index = 0; index < LEVELS.length; index++) {
      const level = LEVELS[index], r = rects[index];
      const open = isGallery ? isInGallery(this.progress, level.id) : isUnlocked(this.progress, level.id);
      const done = this.progress.completed.includes(level.id);
      this.boardG.fillStyle(0x050d17, .85).fillRoundedRect(r.x + 2, r.y + 5, r.width, r.height, 15);
      this.boardG.fillGradientStyle(0x344456, 0x283944, 0x142b37, 0x14212d, .96).fillRoundedRect(r.x, r.y, r.width, r.height, 14);
      this.boardG.lineStyle(2, open ? 0xd5a15c : 0x617080, open ? .95 : .65).strokeRoundedRect(r.x, r.y, r.width, r.height, 14);
      const imageW = desktop ? r.width - 16 : Math.min(70, r.height * .73);
      const imageH = desktop ? r.height - 86 : r.height - 12;
      const imageX = desktop ? r.centerX : r.x + 9 + imageW / 2;
      const imageY = desktop ? r.y + 8 + imageH / 2 : r.centerY;
      const thumbnail = this.add.image(imageX, imageY, `art-${level.id}`).setDepth(5).setDisplaySize(imageW, imageH);
      this.uiImages.push(thumbnail);
      this.chrome.lineStyle(1.4, 0xffdda0, open ? .8 : .35).strokeRoundedRect(imageX - imageW / 2, imageY - imageH / 2, imageW, imageH, 7);
      if (!open) this.chrome.fillStyle(0x020812, .7).fillRoundedRect(imageX - imageW / 2, imageY - imageH / 2, imageW, imageH, 7);
      const tx = desktop ? r.centerX : r.x + imageW + 24;
      this.txt(tx, desktop ? r.y + r.height - 65 : r.y + r.height * .30, `Уровень ${level.id}`, desktop ? 18 : 17, open ? '#ffe4ac' : '#b4b8ba', true, desktop ? 'center' : 'left');
      this.txt(tx, desktop ? r.y + r.height - 40 : r.y + r.height * .56, level.title, desktop ? 15 : Math.min(15, w * .039), open ? '#f6ead4' : '#a6b0b5', false, desktop ? 'center' : 'left');
      if (done) this.drawStars(desktop ? r.centerX : r.x + r.width - 51, desktop ? r.y + r.height - 18 : r.y + r.height * .77, 3, 10);
      else if (!open) this.drawLock(desktop ? r.centerX : r.x + r.width - 39, desktop ? r.y + r.height - 17 : r.centerY);
      else if (!isGallery) this.txt(desktop ? r.centerX : r.x + r.width - 51, desktop ? r.y + r.height - 17 : r.y + r.height * .78, 'Открыт', 12, '#b9d39c', true);
    }
    this.txt(w / 2, h - 22, isGallery ? 'Собранные картины можно рассмотреть целиком' : 'Следующая картина открывается после сборки', Math.min(14, w * .034), '#dfd0af');
  }
  private drawGalleryView(w: number, h: number) {
    const level = levelById(this.viewedLevel);
    const back = this.backButton(); this.iconCircle(back.x, back.y); this.backArrow(back.x, back.y);
    this.txt(w / 2, h < 700 ? 37 : 45, level.title, Math.min(26, w * .067), '#ffe1a0', true);
    const width = Math.min(w - 34, (h - (h < 700 ? 174 : 206)) * 2 / 3, 530), height = width * 1.5;
    const top = Math.max(h < 700 ? 73 : 91, (h - height - 54) / 2);
    const view = this.add.image(w / 2, top + height / 2, `art-${level.id}`).setDepth(5).setDisplaySize(width, height);
    this.uiImages.push(view);
    this.chrome.lineStyle(3, 0xd5a365, .95).strokeRoundedRect(w / 2 - width / 2 - 4, top - 4, width + 8, height + 8, 10);
    this.txt(w / 2, Math.min(h - 31, top + height + 28), level.phrase, Math.min(16, w * .039), '#ffe4b8', true);
  }
  private drawGame(w: number, h: number) {
    this.menuArt?.setVisible(false);
    const b = this.board;
    this.boardG.fillStyle(0x02070e, .63).fillRoundedRect(b.x - 7, b.y - 7, b.width + 14, b.height + 14, 15);
    this.boardG.lineStyle(2, 0xbf8d4b, .85).strokeRoundedRect(b.x - 7, b.y - 7, b.width + 14, b.height + 14, 15);
    this.boardG.lineStyle(1, 0xffdd99, .3).strokeRoundedRect(b.x - 3, b.y - 3, b.width + 6, b.height + 6, 12);
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      this.boardG.fillStyle(0xc79957, .8).fillCircle(b.x + b.width / 2 + sx * (b.width / 2 - 9), b.y + b.height / 2 + sy * (b.height / 2 - 9), 2);
    }
    this.guideImage?.setPosition(b.x + b.width / 2, b.y + b.height / 2).setDisplaySize(b.width, b.height);
    this.completeImage?.setPosition(b.x + b.width / 2, b.y + b.height / 2).setDisplaySize(b.width, b.height);
    if (this.preview && this.mode === 'game' && this.previewImage) {
      const p = this.preview;
      this.boardG.fillStyle(0x090e18, .85).fillRoundedRect(p.x - 8, p.y - 8, p.width + 16, p.height + 16, 12);
      this.boardG.lineStyle(2, 0xbd8f53, .9).strokeRoundedRect(p.x - 8, p.y - 8, p.width + 16, p.height + 16, 12);
      this.previewImage.setVisible(true).setPosition(p.x + p.width / 2, p.y + p.height / 2).setDisplaySize(p.width, p.height);
      this.chrome.lineStyle(1, 0xffdd9b, .42).strokeRoundedRect(p.x - 3, p.y - 3, p.width + 6, p.height + 6, 10);
      this.chrome.fillGradientStyle(0x57371f, 0x3c291d, 0x221911, 0x302116, .94).fillRoundedRect(p.x + p.width / 2 - 118, p.y - 56, 236, 34, 9);
      this.chrome.lineStyle(1.4, 0xe0ad69, .85).strokeRoundedRect(p.x + p.width / 2 - 117, p.y - 55, 234, 32, 8);
      this.txt(p.x + p.width / 2, p.y - 34, 'ВОЛШЕБНАЯ КАРТИНА', 15, '#ffe4ad', true);
    } else this.previewImage?.setVisible(false);
    const hw = this.headerWidth(), hx = this.headerCenter(), hy = h < 700 ? 36 : 43;
    this.chrome.fillGradientStyle(0x142b3b, 0x182b39, 0x071421, 0x0a1a2b, 1).fillRoundedRect(hx - hw / 2, 7, hw, hy * 2 - 7, 16);
    this.chrome.lineStyle(1.5, 0xbd8546, .8).strokeRoundedRect(hx - hw / 2 + 1, 8, hw - 2, hy * 2 - 9, 15);
    this.chrome.fillStyle(0xffd695, .1).fillRoundedRect(hx - hw / 2 + 10, 12, hw - 20, 3, 2);
    const back = this.backButton(), hint = this.hintButton();
    this.iconCircle(back.x, back.y); this.iconCircle(hint.x, hint.y);
    this.backArrow(back.x, back.y);
    if (this.mode === 'complete') this.galleryIcon(hint.x, hint.y); else this.bulb(hint.x, hint.y);
    const plaqueW = Math.min(158, hw - 135);
    this.chrome.fillStyle(0x48301b, .95).fillRoundedRect(hx - plaqueW / 2, 13, plaqueW, hy * 2 - 19, 9);
    this.chrome.lineStyle(1.2, 0xe2ad62, .88).strokeRoundedRect(hx - plaqueW / 2 + 2, 15, plaqueW - 4, hy * 2 - 23, 8);
    this.chrome.lineStyle(1, 0xffd489, .17).lineBetween(hx - plaqueW / 2 + 13, 21, hx + plaqueW / 2 - 13, 20);
    this.txt(hx, h < 700 ? 24 : 29, this.mode === 'complete' && this.level.id === LEVELS.length ? 'Подборка собрана' : `Уровень ${this.level.id}`, h < 700 ? 13 : 15, '#fff2d4', true);
    const count = this.pieces.filter(p => p.placed).length;
    this.drawStars(hx, h < 700 ? 48 : 58, this.mode === 'complete' ? 3 : 0, 10);
    if (this.mode === 'complete') {
      if (this.preview) {
        const p = this.preview, center = p.x + p.width / 2;
        this.boardG.fillGradientStyle(0x142b3b, 0x142b3b, 0x07131f, 0x07131f, .8).fillRoundedRect(p.x - 8, p.y + 80, p.width + 16, p.height - 160, 18);
        this.boardG.lineStyle(1.5, 0xc69553, .75).strokeRoundedRect(p.x - 8, p.y + 80, p.width + 16, p.height - 160, 18);
        this.boardG.lineStyle(1, 0xffdca0, .25).strokeRoundedRect(p.x - 3, p.y + 85, p.width + 6, p.height - 170, 14);
        this.drawStars(center, p.y + 190, 3, 18);
        this.txt(center, p.y + 265, this.level.id === LEVELS.length ? 'Подборка собрана' : 'Картина ожила', 30, '#ffe5b1', true);
        this.txt(center, p.y + 335, this.level.title, 19, '#e9dac1');
      }
      this.txt(b.x + b.width / 2, b.y + b.height + 29, this.level.phrase, h < 700 ? 12 : Math.min(16, w * .04), '#ffe8b8', true);
      const next = this.nextButton(); this.button(next.centerX, next.centerY, next.width, next.height, this.level.id === LEVELS.length ? 'Открыть галерею' : 'Следующий уровень');
    } else {
      const panelH = h < 700 ? 62 : 76, spare = h - b.y - b.height;
      const panelY = b.y + b.height + Math.max(10, (spare - panelH) / 2);
      const panelW = Math.min(b.width * .88, 405), panelX = b.x + b.width / 2 - panelW / 2;
      this.boardG.fillGradientStyle(0x442c1c, 0x3b271b, 0x0a1a27, 0x102437, .86).fillRoundedRect(panelX, panelY, panelW, panelH, 12);
      this.boardG.lineStyle(1.5, 0xd5a866, .77).strokeRoundedRect(panelX, panelY, panelW, panelH, 12);
      this.boardG.lineStyle(1, 0xffdda1, .25).strokeRoundedRect(panelX + 4, panelY + 4, panelW - 8, panelH - 8, 9);
      this.txt(panelX + panelW / 2, panelY + (h < 700 ? 19 : 24), `${count} / ${this.level.pieces} собрано`, h < 700 ? 14 : 16, '#ffdfa5', true);
      this.txt(panelX + panelW / 2, panelY + (h < 700 ? 44 : 53), 'Перетаскивай фрагменты на картину', Math.min(14, w * .035), '#f2e3c7');
    }
  }
  private backArrow(x: number, y: number) {
    this.chrome.lineStyle(3, 0xffe4ac, 1).lineBetween(x + 9, y, x - 7, y);
    this.chrome.lineBetween(x - 7, y, x, y - 8);
    this.chrome.lineBetween(x - 7, y, x, y + 8);
  }
  private drawLock(x: number, y: number) {
    this.chrome.lineStyle(2, 0xc9b18a, .9).strokeRoundedRect(x - 7, y - 13, 14, 18, 7);
    this.chrome.fillStyle(0xc9a46b, .9).fillRoundedRect(x - 10, y - 3, 20, 16, 3);
    this.chrome.fillStyle(0x473322, 1).fillCircle(x, y + 3, 2);
  }
  private drawStars(x: number, y: number, filled: number, radius: number) {
    for (let star = 0; star < 3; star++) {
      const cx = x + (star - 1) * radius * 2.6;
      const points = Array.from({ length: 10 }, (_, i) => new Phaser.Geom.Point(cx + Math.cos(-Math.PI / 2 + i * Math.PI / 5) * (i % 2 ? radius * .45 : radius), y + Math.sin(-Math.PI / 2 + i * Math.PI / 5) * (i % 2 ? radius * .45 : radius)));
      if (star < filled) this.chrome.fillStyle(0xffd578, 1).fillPoints(points, true);
      this.chrome.lineStyle(1.5, 0xffd578, .95).strokePoints(points, true);
    }
  }
  private iconCircle(x: number, y: number) {
    this.chrome.fillStyle(0x050b11, .7).fillCircle(x, y + 3, 22);
    this.chrome.fillStyle(0xbb813b, 1).fillCircle(x, y, 21);
    this.chrome.fillStyle(0x412714, 1).fillCircle(x, y, 17);
    this.chrome.lineStyle(1, 0xffdc91, .8).strokeCircle(x, y, 18);
  }
  private bulb(x: number, y: number) {
    this.chrome.fillStyle(0xffd671, .12).fillCircle(x, y - 4, 16);
    this.chrome.lineStyle(1.8, 0xffe1a0, .9);
    this.chrome.lineBetween(x, y - 17, x, y - 14);
    this.chrome.lineBetween(x - 13, y - 9, x - 16, y - 11);
    this.chrome.lineBetween(x + 13, y - 9, x + 16, y - 11);
    this.chrome.lineBetween(x - 14, y + 1, x - 17, y + 2);
    this.chrome.lineBetween(x + 14, y + 1, x + 17, y + 2);
    this.chrome.fillStyle(0xffe5a0, 1).fillCircle(x, y - 5, 8);
    this.chrome.lineStyle(2, 0xfff4cc, .95).strokeCircle(x, y - 5, 8);
    this.chrome.lineStyle(1.5, 0x9a5f2e, .9).lineBetween(x - 3, y - 5, x, y - 1);
    this.chrome.lineBetween(x + 3, y - 5, x, y - 1);
    this.chrome.fillStyle(0xf5c66b, 1).fillRoundedRect(x - 4, y + 1, 8, 7, 2);
    this.chrome.fillStyle(0x9b632e, 1).fillRoundedRect(x - 5, y + 7, 10, 3, 1);
    this.chrome.fillStyle(0xffd47b, 1).fillRoundedRect(x - 5, y + 10, 10, 3, 1);
    this.chrome.fillStyle(0x9b632e, 1).fillRoundedRect(x - 3, y + 13, 6, 2, 1);
  }
  private galleryIcon(x: number, y: number) {
    this.chrome.lineStyle(2, 0xffe1a0, .95).strokeRoundedRect(x - 12, y - 9, 24, 18, 3);
    this.chrome.fillStyle(0xffdb85, .9).fillCircle(x + 5, y - 3, 2.5);
    this.chrome.lineStyle(2, 0xffe1a0, .95).lineBetween(x - 9, y + 5, x - 2, y - 1);
    this.chrome.lineBetween(x - 2, y - 1, x + 2, y + 3);
    this.chrome.lineBetween(x + 2, y + 3, x + 6, y);
    this.chrome.lineBetween(x + 6, y, x + 10, y + 5);
  }
  private lantern(x: number, y: number) {
    for (const [r, a] of [[30, .06], [21, .10], [14, .16]] as const) this.chrome.fillStyle(0xffbd55, a).fillCircle(x, y + 3, r);
    this.chrome.fillStyle(0x4a2b16, .95).fillRoundedRect(x - 9, y - 10, 18, 24, 3);
    this.chrome.lineStyle(2, 0xd99a4d, .9).strokeRoundedRect(x - 9, y - 10, 18, 24, 3);
    this.chrome.fillStyle(0xffd26b, .95).fillRoundedRect(x - 5, y - 6, 10, 15, 2);
    this.chrome.fillStyle(0xfff0bb, .7).fillCircle(x, y + 1, 3);
    this.chrome.lineStyle(2, 0x3a2517, .9).lineBetween(x, y - 8, x, y + 10);
    this.chrome.fillStyle(0xb9823e, 1).fillTriangle(x - 11, y - 10, x + 11, y - 10, x, y - 16);
  }
  private button(x: number, y: number, w: number, h: number, label: string) {
    this.chrome.fillStyle(0x020704, .65).fillRoundedRect(x - w / 2 + 2, y - h / 2 + 6, w, h, h / 2);
    this.chrome.fillStyle(0xbd8741, 1).fillRoundedRect(x - w / 2, y - h / 2, w, h, h / 2);
    this.chrome.fillGradientStyle(0x4d994d, 0x34783d, 0x174a31, 0x1d5938, 1).fillRoundedRect(x - w / 2 + 4, y - h / 2 + 4, w - 8, h - 8, h / 2);
    this.chrome.lineStyle(1.2, 0xffe5a1, .85).strokeRoundedRect(x - w / 2 + 7, y - h / 2 + 7, w - 14, h - 14, h / 2);
    this.txt(x, y - 1, label, Math.min(22, h * .37), '#fff5da', true);
  }
  private txt(x: number, y: number, value: string, size: number, color: string, bold = false, align: 'center' | 'left' = 'center') {
    this.add.text(x, y, value, { fontFamily: 'Georgia, serif', fontSize: `${size}px`, color, fontStyle: bold ? 'bold' : 'normal', align, shadow: { color: '#05070c', blur: 6, fill: true, offsetY: 2 } }).setOrigin(align === 'left' ? 0 : .5, .5).setDepth(200).setData('uiText', true);
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
