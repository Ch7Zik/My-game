/// <reference types="vite/client" />
import Phaser from 'phaser';
import { createRegions, inspectRegions, qualityProblems, type PieceRegion, type Point } from './geometry';
import { canAdvance, canDrag, isComplete, shouldSnap, wasDragged } from './puzzleRules';
import { gameLayout, looseScale, startPosition, SLOT_ORDER, type Rect } from './layout';
import { LEVELS, levelById, type LevelConfig } from './levels';
import { assetUrl } from './assetUrl';
import { PuzzleAudio } from './audio';
import { completeLevel, isInGallery, isUnlocked, nextUnplayed, restoreProgress, saveProgress, selectLevel, type Progress } from './progress';
import './style.css';

type Piece = { id: number; sprite: Phaser.GameObjects.Image; region: PieceRegion; placed: boolean; home: Point; slot: number; hit: Uint8Array; texW: number; texH: number; baseW: number; baseH: number };
const RENDER_SCALE = Math.min(window.devicePixelRatio || 1, window.innerWidth >= 900 ? 1.5 : window.innerWidth >= 700 ? 1.75 : 2);
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
  private audio = new PuzzleAudio(safeStorage);
  private soundPanelOpen = false;

  constructor() { super('puzzle'); }
  preload() {
    this.load.image('menu-forest', assetUrl('assets/menu-forest.webp'));
    this.load.image('menu-forest-wide', assetUrl('assets/menu-forest-wide.webp'));
    for (const level of LEVELS) this.load.image(`art-${level.id}`, level.art);
  }
  create() {
    this.cameras.main.setOrigin(0, 0).setZoom(RENDER_SCALE);
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

  private viewWidth() { return this.scale.width / RENDER_SCALE; }
  private viewHeight() { return this.scale.height / RENDER_SCALE; }
  private layout() { const layout = gameLayout(this.viewWidth(), this.viewHeight()); this.board = layout.board; this.preview = layout.preview; }

  private preparePieces() {
    if (!this.artLoaded || this.pieces.length) return;
    this.layout();
    const cw = this.viewWidth() < 700 ? 840 : 960, ch = cw * 1.5, pad = Math.round(cw / 40);
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
    const cw = this.raster.width, ch = this.raster.height, scale = looseScale(this.viewWidth(), this.viewHeight());
    for (const piece of this.pieces) {
      const b = piece.region.bounds;
      piece.baseW = piece.texW * this.board.width / cw;
      piece.baseH = piece.texH * this.board.height / ch;
      piece.home = { x: this.board.x + (b.x + b.width / 2) / cw * this.board.width, y: this.board.y + (b.y + b.height / 2) / ch * this.board.height };
      const effective = piece.placed ? 1 : scale;
      piece.sprite.setDisplaySize(piece.baseW * effective, piece.baseH * effective);
      const start = startPosition(this.board, this.viewWidth(), piece.slot, piece.sprite.displayWidth, piece.sprite.displayHeight);
      piece.sprite.setPosition(piece.placed ? piece.home.x : start.x, piece.placed ? piece.home.y : start.y);
    }
    this.guideImage?.setPosition(this.board.x + this.board.width / 2, this.board.y + this.board.height / 2).setDisplaySize(this.board.width, this.board.height);
    this.completeImage?.setPosition(this.board.x + this.board.width / 2, this.board.y + this.board.height / 2).setDisplaySize(this.board.width, this.board.height);
  }

  private pointerDown(pointer: Phaser.Input.Pointer) {
    const x = pointer.x / RENDER_SCALE, y = pointer.y / RENDER_SCALE;
    this.audio.unlock();
    if (this.mode === 'menu') {
      if (this.soundButton().contains(x, y)) { this.soundPanelOpen = !this.soundPanelOpen; this.draw(); return; }
      if (this.soundPanelOpen) {
        if (this.musicButton().contains(x, y)) { this.audio.setMusic(!this.audio.settings.music); this.draw(); return; }
        if (this.effectsButton().contains(x, y)) { this.audio.setEffects(!this.audio.settings.effects); this.draw(); return; }
        this.soundPanelOpen = false; this.draw(); return;
      }
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
      if (id && this.mode === 'levels' && isUnlocked(this.progress, id)) { this.startGame(id); }
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
    const scale = looseScale(this.viewWidth(), this.viewHeight()) * 1.025;
    hit.sprite.setDisplaySize(hit.baseW * scale, hit.baseH * scale);
  }
  private pointerMove(pointer: Phaser.Input.Pointer) {
    if (!this.dragging) return;
    const p = this.dragging;
    p.sprite.x = Phaser.Math.Clamp(pointer.x / RENDER_SCALE + this.pointerOffset.x, 3 + p.sprite.displayWidth / 2, this.viewWidth() - 3 - p.sprite.displayWidth / 2);
    p.sprite.y = Phaser.Math.Clamp(pointer.y / RENDER_SCALE + this.pointerOffset.y, this.board.y + p.sprite.displayHeight / 2, this.board.y + this.board.height - p.sprite.displayHeight / 2);
  }
  private pointerUp(_pointer: Phaser.Input.Pointer) {
    if (!this.dragging) return;
    const p = this.dragging; this.dragging = null;
    p.sprite.clearTint().setDepth(10 + p.id);
    const moved = wasDragged(this.dragOrigin, { x: p.sprite.x, y: p.sprite.y });
    const scale = looseScale(this.viewWidth(), this.viewHeight());
    p.sprite.setDisplaySize(p.baseW * scale, p.baseH * scale);
    const radius = Math.max(28, this.board.width * .14);
    if (moved && shouldSnap({ x: p.sprite.x, y: p.sprite.y }, p.home, radius)) {
      p.placed = true; if (this.level.id === 1) this.tutorialDone = true;
      this.tweens.add({ targets: p.sprite, x: p.home.x, y: p.home.y, displayWidth: p.baseW, displayHeight: p.baseH, duration: 250, ease: 'Sine.Out', onComplete: () => {
        p.sprite.setTexture(`piece-clean-${p.id}`).setDisplaySize(p.baseW, p.baseH);
        this.audio.play('place');
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
    if (this.mode === 'complete') return;
    this.mode = 'complete';
    window.setTimeout(() => { if (this.mode === 'complete') this.audio.play('complete'); }, 300);
    this.completeImage = this.add.image(this.board.x + this.board.width / 2, this.board.y + this.board.height / 2, 'whole-picture').setDepth(60).setDisplaySize(this.board.width, this.board.height).setAlpha(0);
    this.tweens.add({ targets: this.completeImage, alpha: 1, duration: 650, ease: 'Sine.Out', onComplete: () => { this.pieces.forEach(p => p.sprite.setVisible(false)); this.guideImage?.setVisible(false); } });
    this.progress = completeLevel(this.progress, this.level.id);
    saveProgress(safeStorage, this.progress);
    this.draw();
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
  private soundButton() { const w = this.viewWidth(), h = this.viewHeight(); return new Phaser.Geom.Circle(w >= 900 ? w - 43 : w - 32, w >= 900 ? 43 : h < 700 ? 211 : 223, 24); }
  private soundPanel() { const w = this.viewWidth(), y = this.soundButton().y + 32; return new Phaser.Geom.Rectangle(w - 258, y, 244, 119); }
  private musicButton() { const r = this.soundPanel(); return new Phaser.Geom.Rectangle(r.x + 8, r.y + 9, r.width - 16, 50); }
  private effectsButton() { const r = this.soundPanel(); return new Phaser.Geom.Rectangle(r.x + 8, r.y + 60, r.width - 16, 50); }
  private menuButton() { const w = this.viewWidth(), h = this.viewHeight(), width = Math.min(w >= 900 ? 356 : 320, w * .79); return new Phaser.Geom.Rectangle(w / 2 - width / 2, h - (h < 700 ? 119 : 138), width, w >= 900 ? 68 : 62); }
  private galleryButton() { const w = this.viewWidth(), h = this.viewHeight(), width = Math.min(w >= 900 ? 170 : 155, w * .41); return new Phaser.Geom.Rectangle(w / 2 + 7, h < 700 ? h - 50 : h - 72, width, 44); }
  private levelsButton() { const w = this.viewWidth(), h = this.viewHeight(), width = Math.min(w >= 900 ? 170 : 155, w * .41); return new Phaser.Geom.Rectangle(w / 2 - width - 7, h < 700 ? h - 50 : h - 72, width, 44); }
  private nextButton() { const w = this.viewWidth(), h = this.viewHeight(); return new Phaser.Geom.Rectangle(w / 2 - Math.min(310, w * .76) / 2, h < 700 ? h - 48 : h - 65, Math.min(310, w * .76), h < 700 ? 46 : 52); }
  private backButton() {
    const w = this.viewWidth(), h = this.viewHeight();
    if (this.mode === 'levels' || this.mode === 'gallery' || this.mode === 'view') return new Phaser.Geom.Circle(w >= 900 ? Math.max(54, (w - 1560) / 2 + 30) : 35, h < 700 ? 39 : w >= 900 ? 62 : 46, 25);
    return new Phaser.Geom.Circle(this.headerCenter() - this.headerWidth() / 2 + 31, h < 700 ? 36 : 43, 25);
  }
  private hintButton() { const h = this.viewHeight(); return new Phaser.Geom.Circle(this.headerCenter() + this.headerWidth() / 2 - 31, h < 700 ? 36 : 43, 25); }
  private headerCenter() { return this.preview ? (this.board.x + this.preview.x + this.preview.width) / 2 : this.viewWidth() / 2; }
  private headerWidth() { return this.preview ? this.preview.x + this.preview.width - this.board.x : Math.min(this.viewWidth() - 16, 440); }

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
    const w = this.viewWidth(), h = this.viewHeight();
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
    this.boardG.fillGradientStyle(0x03101a, 0x03101a, 0x03101a, 0x03101a, .42, .42, 0, 0).fillRect(0, 0, w, h * .36);
    this.boardG.fillGradientStyle(0x020a13, 0x020a13, 0x020a13, 0x020a13, 0, 0, .68, .68).fillRect(0, h * .68, w, h * .32);
    const compact = h < 700, desktop = w >= 900;
    const signW = Math.min(desktop ? 490 : 344, w - 26), signH = compact ? 120 : desktop ? 174 : 145;
    const signY = compact ? 88 : desktop ? 129 : 107, signX = w / 2 - signW / 2, signTop = signY - signH / 2;
    this.chrome.fillStyle(0x03070c, .5).fillRoundedRect(signX + 3, signTop + 7, signW, signH, 21);
    this.chrome.fillStyle(0x3f291c, .97).fillRoundedRect(signX, signTop, signW, signH, 20);
    this.chrome.lineStyle(2, 0xe2b46e, .95).strokeRoundedRect(signX + 2, signTop + 2, signW - 4, signH - 4, 18);
    this.chrome.lineStyle(1, 0xf4d39a, .28).strokeRoundedRect(signX + 9, signTop + 9, signW - 18, signH - 18, 13);
    for (const side of [-1, 1]) {
      const x = w / 2 + side * (signW / 2 - 19);
      this.chrome.fillStyle(0xe9bb70, .8).fillCircle(x, signY, 3);
      this.chrome.lineStyle(1, 0xf0cf93, .45).strokeCircle(x, signY, 8);
    }
    this.txt(w / 2, signTop + (compact ? 19 : 22), 'НОЧНАЯ СКАЗКА', desktop ? 12 : 10, '#deb982', true);
    this.chrome.lineStyle(1, 0xd4a665, .45).lineBetween(w / 2 - signW * .27, signTop + (compact ? 33 : 37), w / 2 + signW * .27, signTop + (compact ? 33 : 37));
    this.txt(w / 2, signTop + (compact ? 55 : desktop ? 78 : 67), 'Мистические', Math.min(desktop ? 48 : compact ? 31 : 36, w * .094), '#fff0c9', true);
    this.txt(w / 2, signTop + (compact ? 94 : desktop ? 135 : 115), 'Пазлы', Math.min(desktop ? 66 : compact ? 47 : 55, w * .145), '#f4c779', true);
    const subtitleY = h - (compact ? 159 : 184), subtitleW = Math.min(desktop ? 402 : 324, w - 38);
    this.chrome.fillStyle(0x071724, .72).fillRoundedRect(w / 2 - subtitleW / 2, subtitleY - 21, subtitleW, 42, 20);
    this.chrome.lineStyle(1, 0xd4a96e, .62).strokeRoundedRect(w / 2 - subtitleW / 2, subtitleY - 21, subtitleW, 42, 20);
    this.txt(w / 2, subtitleY, 'Собирай волшебные картины', Math.min(desktop ? 18 : 16, w * .043), '#fff0cf', true);
    this.drawSoundControls();
    const primary = this.menuButton(); this.button(primary.centerX, primary.centerY + (this.menuPressed ? 3 : 0), primary.width, primary.height - (this.menuPressed ? 4 : 0), 'Играть');
    this.secondaryButton(this.levelsButton(), 'Уровни');
    this.secondaryButton(this.galleryButton(), 'Галерея');
  }
  private secondaryButton(rect: Phaser.Geom.Rectangle, label: string) {
    this.chrome.fillStyle(0x071522, .9).fillRoundedRect(rect.x, rect.y, rect.width, rect.height, 11);
    this.chrome.lineStyle(1.4, 0xd5aa70, .88).strokeRoundedRect(rect.x + 1, rect.y + 1, rect.width - 2, rect.height - 2, 10);
    this.chrome.lineStyle(1, 0xffdea4, .19).lineBetween(rect.x + 13, rect.y + 5, rect.right - 13, rect.y + 5);
    this.txt(rect.centerX, rect.centerY, label, rect.height < 40 ? 15 : 17, '#f8e1b8', true);
  }
  private drawSoundControls() {
    const button = this.soundButton(), x = button.x, y = button.y;
    this.iconCircle(x, y);
    this.chrome.fillStyle(0xffe3a2, 1).fillRect(x - 12, y - 5, 5, 10);
    this.chrome.fillStyle(0xffe3a2, 1).fillTriangle(x - 8, y - 5, x + 1, y - 12, x + 1, y + 12);
    if (this.audio.settings.music || this.audio.settings.effects) {
      this.chrome.lineStyle(2, 0xffe3a2, 1).beginPath().arc(x + 1, y, 9, -.8, .8).strokePath();
      this.chrome.beginPath().arc(x + 1, y, 14, -.8, .8).strokePath();
    } else this.chrome.lineStyle(2, 0xffe3a2, 1).lineBetween(x + 6, y - 9, x + 17, y + 9);
    if (!this.soundPanelOpen) return;
    const panel = this.soundPanel();
    this.chrome.fillStyle(0x102734, .98).fillRoundedRect(panel.x, panel.y, panel.width, panel.height, 13);
    this.chrome.lineStyle(1.3, 0xc99a58, .9).strokeRoundedRect(panel.x, panel.y, panel.width, panel.height, 13);
    this.chrome.lineStyle(1, 0xf0cc91, .2).lineBetween(panel.x + 14, panel.y + 59, panel.right - 14, panel.y + 59);
    for (const [rect, label, enabled] of [[this.musicButton(), 'Музыка', this.audio.settings.music], [this.effectsButton(), 'Эффекты', this.audio.settings.effects]] as const) {
      this.txt(rect.x + 17, rect.centerY, label, 17, '#ffe8bb', true, 'left');
      this.chrome.fillStyle(enabled ? 0x75613b : 0x34424a, 1).fillRoundedRect(rect.right - 58, rect.centerY - 13, 51, 26, 13);
      this.chrome.lineStyle(1, 0xe2bd76, .85).strokeRoundedRect(rect.right - 58, rect.centerY - 13, 51, 26, 13);
      this.chrome.fillStyle(0xffe7b5, 1).fillCircle(enabled ? rect.right - 20 : rect.right - 45, rect.centerY, 9);
    }
  }
  private cardRects(): Phaser.Geom.Rectangle[] {
    const w = this.viewWidth(), h = this.viewHeight();
    if (w >= 900) {
      const gap = 16, group = Math.min(w - 140, 1560), width = (group - gap * 4) / 5;
      const height = Math.min(540, Math.max(370, h - 350)), top = Math.max(178, (h - height) / 2 - 8);
      return LEVELS.map((_, i) => new Phaser.Geom.Rectangle((w - group) / 2 + i * (width + gap), top, width, height));
    }
    const top = h < 700 ? 99 : 129, gap = h < 700 ? 7 : 10, bottom = h < 700 ? 21 : 45;
    const height = (h - top - bottom - gap * 4) / 5;
    return LEVELS.map((_, i) => new Phaser.Geom.Rectangle(14, top + i * (height + gap), w - 28, height));
  }
  private cardAt(x: number, y: number): number | null {
    const index = this.cardRects().findIndex(rect => rect.contains(x, y));
    return index < 0 ? null : LEVELS[index].id;
  }
  private drawSectionHeader(w: number, h: number, title: string, subtitle: string) {
    const desktop = w >= 900, compact = h < 700;
    const back = this.backButton(); this.iconCircle(back.x, back.y); this.backArrow(back.x, back.y);
    if (desktop) {
      this.txt(w / 2, 57, 'МИСТИЧЕСКИЕ ПАЗЛЫ', 14, '#cba56b', true);
      this.txt(w / 2, 106, title, 38, '#ffe9bd', true);
      this.txt(w / 2, 151, subtitle, 17, '#e7d5b6');
      this.ornamentRule(w / 2, 194, 375);
    } else {
      this.txt(w / 2, compact ? 15 : 19, 'МИСТИЧЕСКИЕ ПАЗЛЫ', 9, '#cba56b', true);
      this.txt(w / 2, compact ? 41 : 49, title, compact ? 22 : 25, '#ffe9bd', true);
      if (!compact) this.txt(w / 2, 83, subtitle, 12, '#dfcfb1');
      this.ornamentRule(w / 2, compact ? 79 : 108, Math.min(225, w - 120));
    }
  }
  private ornamentRule(x: number, y: number, width: number) {
    this.chrome.lineStyle(1, 0xb88a51, .5).lineBetween(x - width / 2, y, x - 10, y);
    this.chrome.lineBetween(x + 10, y, x + width / 2, y);
    this.chrome.fillStyle(0xe6b971, .85).fillTriangle(x, y - 5, x + 5, y, x, y + 5);
    this.chrome.fillTriangle(x, y - 5, x - 5, y, x, y + 5);
  }
  private drawCards(w: number, h: number) {
    const isGallery = this.mode === 'gallery', desktop = w >= 900;
    this.drawSectionHeader(w, h, isGallery ? 'Галерея картин' : 'Выбор уровня', isGallery ? 'Здесь живут собранные картины' : 'Пять историй, которые ждут своего часа');
    const rects = this.cardRects();
    if (desktop) {
      const first = rects[0], last = rects[rects.length - 1];
      this.boardG.fillStyle(0x061420, .53).fillRoundedRect(first.x - 19, first.y - 20, last.right - first.x + 38, first.height + 40, 22);
      this.boardG.lineStyle(1, 0xb78c55, .22).strokeRoundedRect(first.x - 19, first.y - 20, last.right - first.x + 38, first.height + 40, 22);
    }
    for (let index = 0; index < LEVELS.length; index++) {
      const level = LEVELS[index], r = rects[index];
      const open = isGallery ? isInGallery(this.progress, level.id) : isUnlocked(this.progress, level.id);
      const done = this.progress.completed.includes(level.id);
      this.boardG.fillStyle(0x01060d, .65).fillRoundedRect(r.x + 2, r.y + 5, r.width, r.height, 15);
      this.boardG.fillStyle(0x172e3b, 1).fillRoundedRect(r.x, r.y, r.width, r.height, 14);
      this.boardG.fillStyle(0xf1d9af, .035).fillRoundedRect(r.x + 5, r.y + 5, r.width - 10, Math.min(25, r.height * .24), 8);
      this.boardG.lineStyle(open ? 1.8 : 1.1, open ? 0xd0a363 : 0x75818a, open ? .9 : .55).strokeRoundedRect(r.x + 1, r.y + 1, r.width - 2, r.height - 2, 13);
      const imageH = desktop ? r.height - 118 : r.height - 14;
      const imageW = desktop ? r.width - 16 : imageH * 2 / 3;
      const imageX = desktop ? r.centerX : r.x + 8 + imageW / 2;
      const imageY = desktop ? r.y + 8 + imageH / 2 : r.centerY;
      const thumbnail = this.add.image(imageX, imageY, `art-${level.id}`).setDepth(5).setDisplaySize(imageW, imageH);
      this.uiImages.push(thumbnail);
      this.chrome.lineStyle(1, 0xf4cd88, open ? .75 : .28).strokeRoundedRect(imageX - imageW / 2, imageY - imageH / 2, imageW, imageH, 7);
      if (!open) {
        this.chrome.fillStyle(0x06111c, .62).fillRoundedRect(imageX - imageW / 2, imageY - imageH / 2, imageW, imageH, 6);
        if (desktop) this.drawLock(imageX, imageY);
      }
      if (desktop) {
        const captionY = r.y + r.height - 91;
        this.txt(r.centerX, captionY, `КАРТИНА 0${level.id}`, 12, open ? '#cfa76d' : '#88949b', true);
        this.txt(r.centerX, captionY + 30, level.title, 20, open ? '#ffead0' : '#aeb8bc', true);
        this.cardStatus(r.centerX, r.bottom - 24, done ? 'СОБРАНО' : open ? 'ДОСТУПЕН' : isGallery ? 'НЕ СОБРАНО' : 'ЗАКРЫТ', done, open, true);
      } else {
        const tx = r.x + imageW + 22;
        this.txt(tx, r.y + r.height * .22, `КАРТИНА 0${level.id}`, 10, open ? '#cfa76d' : '#88949b', true, 'left');
        this.txt(tx, r.y + r.height * .46, level.title, h < 700 ? 16 : 18, open ? '#ffead0' : '#adb8bc', true, 'left');
        this.cardStatus(tx + (isGallery && !open ? 62 : 49), r.y + r.height * .78, done ? 'СОБРАНО' : open ? 'ДОСТУПЕН' : isGallery ? 'НЕ СОБРАНО' : 'ЗАКРЫТ', done, open, false);
      }
    }
    if (desktop) {
      this.ornamentRule(w / 2, rects[0].bottom + 67, 325);
      this.txt(w / 2, rects[0].bottom + 103, isGallery ? 'Открой картину, чтобы рассмотреть её целиком' : 'Новая картина откроется после сборки предыдущей', 16, '#d8c4a3');
    } else if (h >= 700) this.txt(w / 2, h - 20, isGallery ? 'Только собранные картины' : 'Новая картина откроется после сборки', 12, '#ceb999');
  }
  private cardStatus(x: number, y: number, label: string, done: boolean, open: boolean, desktop: boolean) {
    const width = label === 'НЕ СОБРАНО' ? (desktop ? 150 : 124) : desktop ? 132 : 103;
    this.chrome.fillStyle(done ? 0x644724 : open ? 0x294438 : 0x26333c, .94).fillRoundedRect(x - width / 2, y - 14, width, 28, 12);
    this.chrome.lineStyle(1, done ? 0xdfb876 : open ? 0x9eb78d : 0x687982, .76).strokeRoundedRect(x - width / 2, y - 14, width, 28, 12);
    this.txt(x, y, label, desktop ? 11 : 10, done ? '#ffe4a8' : open ? '#d8e4c5' : '#aebcc0', true);
  }
  private drawGalleryView(w: number, h: number) {
    const level = levelById(this.viewedLevel);
    this.drawSectionHeader(w, h, level.title, 'Собранная картина');
    const desktop = w >= 900, compact = h < 700;
    const width = Math.min(w - 34, (h - (desktop ? 310 : compact ? 185 : 210)) * 2 / 3, 540), height = width * 1.5;
    const top = desktop ? 205 : compact ? 99 : 135;
    const view = this.add.image(w / 2, top + height / 2, `art-${level.id}`).setDepth(5).setDisplaySize(width, height);
    this.uiImages.push(view);
    this.chrome.lineStyle(2, 0xd3aa70, .9).strokeRoundedRect(w / 2 - width / 2 - 5, top - 5, width + 10, height + 10, 9);
    this.chrome.lineStyle(1, 0xf5d7a1, .35).strokeRoundedRect(w / 2 - width / 2 - 9, top - 9, width + 18, height + 18, 12);
    this.txt(w / 2, Math.min(h - 26, top + height + 29), level.phrase, Math.min(16, w * .039), '#ffe4b8', true);
  }
  private drawGame(w: number, h: number) {
    this.menuArt?.setVisible(false);
    const b = this.board;
    this.boardG.fillStyle(0x020a13, .72).fillRoundedRect(b.x - 6, b.y - 6, b.width + 12, b.height + 12, 12);
    this.boardG.lineStyle(1.5, 0xcba16a, .86).strokeRoundedRect(b.x - 6, b.y - 6, b.width + 12, b.height + 12, 12);
    this.boardG.lineStyle(1, 0xf5d49a, .22).strokeRoundedRect(b.x - 2, b.y - 2, b.width + 4, b.height + 4, 9);
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      const cx = b.x + b.width / 2 + sx * (b.width / 2 - 11), cy = b.y + b.height / 2 + sy * (b.height / 2 - 11);
      this.boardG.fillStyle(0xf1c981, .72).fillCircle(cx, cy, 1.7);
    }
    this.guideImage?.setPosition(b.x + b.width / 2, b.y + b.height / 2).setDisplaySize(b.width, b.height);
    this.completeImage?.setPosition(b.x + b.width / 2, b.y + b.height / 2).setDisplaySize(b.width, b.height);
    if (this.preview && this.mode === 'game' && this.previewImage) {
      const p = this.preview;
      this.boardG.fillStyle(0x081724, .92).fillRoundedRect(p.x - 7, p.y - 7, p.width + 14, p.height + 14, 10);
      this.boardG.lineStyle(1.5, 0xc6a06c, .86).strokeRoundedRect(p.x - 7, p.y - 7, p.width + 14, p.height + 14, 10);
      this.previewImage.setVisible(true).setPosition(p.x + p.width / 2, p.y + p.height / 2).setDisplaySize(p.width, p.height);
      this.chrome.fillStyle(0x263442, .9).fillRoundedRect(p.x + p.width / 2 - 121, p.y - 47, 242, 30, 9);
      this.chrome.lineStyle(1, 0xd0a76b, .8).strokeRoundedRect(p.x + p.width / 2 - 120, p.y - 46, 240, 28, 8);
      this.txt(p.x + p.width / 2, p.y - 32, 'ОБРАЗЕЦ КАРТИНЫ', 13, '#f2d8a8', true);
    } else this.previewImage?.setVisible(false);
    const hw = this.headerWidth(), hx = this.headerCenter(), hy = h < 700 ? 36 : 43;
    this.chrome.fillStyle(0x142c39, .98).fillRoundedRect(hx - hw / 2, 6, hw, hy * 2 - 5, 15);
    this.chrome.lineStyle(1.3, 0xc99e62, .78).strokeRoundedRect(hx - hw / 2 + 1, 7, hw - 2, hy * 2 - 7, 14);
    this.chrome.lineStyle(1, 0xf1d3a1, .19).lineBetween(hx - hw / 2 + 67, 13, hx + hw / 2 - 67, 13);
    const back = this.backButton(), hint = this.hintButton();
    this.iconCircle(back.x, back.y); this.iconCircle(hint.x, hint.y);
    this.backArrow(back.x, back.y);
    if (this.mode === 'complete') this.galleryIcon(hint.x, hint.y); else this.bulb(hint.x, hint.y);
    this.txt(hx, h < 700 ? 21 : 24, `УРОВЕНЬ 0${this.level.id}`, h < 700 ? 10 : 11, '#c8a16e', true);
    this.txt(hx, h < 700 ? 47 : 51, this.mode === 'complete' ? 'Картина ожила' : this.level.title, h < 700 ? 16 : w >= 900 ? 20 : 18, '#ffecd0', true);
    if (this.mode === 'complete') this.drawStars(hx, h < 700 ? 65 : 73, 3, 5);
    else this.chrome.lineStyle(1, 0xd2a86c, .45).lineBetween(hx - 37, h < 700 ? 65 : 73, hx + 37, h < 700 ? 65 : 73);
    const count = this.pieces.filter(p => p.placed).length;
    if (this.mode === 'complete') {
      if (this.preview) {
        const p = this.preview, center = p.x + p.width / 2, panelW = p.width + 8, panelH = 284;
        const panelY = p.y + (p.height - panelH) / 2;
        this.boardG.fillStyle(0x172d3b, .97).fillRoundedRect(center - panelW / 2, panelY, panelW, panelH, 17);
        this.boardG.lineStyle(1.4, 0xc99b5e, .8).strokeRoundedRect(center - panelW / 2, panelY, panelW, panelH, 17);
        this.boardG.lineStyle(1, 0xf3d5a1, .2).strokeRoundedRect(center - panelW / 2 + 5, panelY + 5, panelW - 10, panelH - 10, 13);
        this.txt(center, panelY + 44, 'КАРТИНА СОБРАНА', 13, '#cfa86c', true);
        this.drawStars(center, panelY + 102, 3, 15);
        this.txt(center, panelY + 164, this.level.id === LEVELS.length ? 'Подборка собрана' : 'Картина ожила', 29, '#ffe7b7', true);
        this.ornamentRule(center, panelY + 202, 190);
        this.txt(center, panelY + 242, this.level.title, 18, '#ead9bb');
      }
      this.txt(b.x + b.width / 2, b.y + b.height + 29, this.level.phrase, h < 700 ? 12 : w >= 900 ? 18 : Math.min(16, w * .04), '#ffe8b8', true);
      const next = this.nextButton(); this.button(next.centerX, next.centerY, next.width, next.height, this.level.id === LEVELS.length ? 'Открыть галерею' : 'Следующий уровень');
    } else {
      const panelH = h < 700 ? 62 : 76, spare = h - b.y - b.height;
      const panelY = b.y + b.height + Math.max(10, (spare - panelH) / 2);
      const panelW = Math.min(b.width * .9, 470), panelX = b.x + b.width / 2 - panelW / 2;
      this.boardG.fillStyle(0x192f3b, .95).fillRoundedRect(panelX, panelY, panelW, panelH, 11);
      this.boardG.lineStyle(1.3, 0xd2a76c, .8).strokeRoundedRect(panelX, panelY, panelW, panelH, 11);
      this.boardG.lineStyle(1, 0xf3d2a0, .18).lineBetween(panelX + 14, panelY + 7, panelX + panelW - 14, panelY + 7);
      this.txt(panelX + panelW / 2, panelY + (h < 700 ? 18 : 23), `${count} / ${this.level.pieces} собрано`, h < 700 ? 14 : w >= 900 ? 18 : 16, '#ffe0a8', true);
      this.txt(panelX + panelW / 2, panelY + (h < 700 ? 44 : 53), 'Перетаскивай фрагменты на картину', w >= 900 ? 16 : Math.min(14, w * .035), '#ecdfc6');
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
    this.chrome.fillStyle(0x02080f, .62).fillCircle(x, y + 3, 23);
    this.chrome.fillStyle(0x19303b, .98).fillCircle(x, y, 22);
    this.chrome.lineStyle(2, 0xd0a265, .95).strokeCircle(x, y, 21);
    this.chrome.lineStyle(1, 0xf3d8a7, .32).strokeCircle(x, y, 17);
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
  private button(x: number, y: number, w: number, h: number, label: string) {
    this.chrome.fillStyle(0x02080c, .68).fillRoundedRect(x - w / 2 + 2, y - h / 2 + 5, w, h, h / 2);
    this.chrome.fillStyle(0x8c5d2e, 1).fillRoundedRect(x - w / 2, y - h / 2, w, h, h / 2);
    this.chrome.fillStyle(0xd5a363, 1).fillRoundedRect(x - w / 2 + 4, y - h / 2 + 4, w - 8, h - 8, h / 2);
    this.chrome.fillStyle(0xffe0a1, .29).fillRoundedRect(x - w / 2 + 12, y - h / 2 + 7, w - 24, Math.max(8, h * .24), 7);
    this.chrome.lineStyle(1, 0xffe6b3, .88).strokeRoundedRect(x - w / 2 + 6, y - h / 2 + 6, w - 12, h - 12, h / 2);
    this.chrome.fillStyle(0xffe5a4, .55).fillCircle(x - w / 2 + 20, y, 2.5);
    this.chrome.fillCircle(x + w / 2 - 20, y, 2.5);
    this.txt(x, y - 1, label, Math.min(25, h * (this.viewWidth() >= 900 ? .41 : .37)), '#392313', true, 'center', false);
  }
  private txt(x: number, y: number, value: string, size: number, color: string, bold = false, align: 'center' | 'left' = 'center', shadow = true) {
    this.add.text(x, y, value, { fontFamily: 'Georgia, serif', fontSize: `${size}px`, color, fontStyle: bold ? 'bold' : 'normal', align, shadow: shadow ? { color: '#05070c', blur: 6, fill: true, offsetY: 2 } : undefined }).setOrigin(align === 'left' ? 0 : .5, .5).setDepth(200).setResolution(RENDER_SCALE).setData('uiText', true);
  }
  private ensureWholeTexture() {
    if (this.textures.exists('whole-picture')) return;
    const canvas = document.createElement('canvas'); canvas.width = this.raster.width; canvas.height = this.raster.height;
    canvas.getContext('2d')!.drawImage(this.art, 0, 0, canvas.width, canvas.height);
    this.textures.addCanvas('whole-picture', canvas);
  }
}

const game = new Phaser.Game({
  type: Phaser.AUTO, parent: 'game', backgroundColor: '#071326', antialias: true,
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH, width: Math.round(window.innerWidth * RENDER_SCALE), height: Math.round(window.innerHeight * RENDER_SCALE) },
  input: { activePointers: 1, smoothFactor: 0 }, render: { pixelArt: false, roundPixels: false }, scene: [PuzzleScene],
});

window.addEventListener('resize', () => game.scale.setGameSize(Math.round(window.innerWidth * RENDER_SCALE), Math.round(window.innerHeight * RENDER_SCALE)));
if (import.meta.env.DEV) Object.assign(window, { __mysticGame: game });
