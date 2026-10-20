/// <reference types="vite/client" />
import Phaser from 'phaser';
import { createRegions, inspectRegions, qualityProblems, type PieceRegion, type Point } from './geometry';
import { canAdvance, canDrag, isComplete, shouldSnap, wasDragged } from './puzzleRules';
import { gameLayout, looseScale, startPosition, SLOT_ORDER, type Rect } from './layout';
import { LEVELS, levelById, type LevelConfig } from './levels';
import { assetUrl } from './assetUrl';
import { PuzzleAudio } from './audio';
import { completeLevel, isInGallery, isUnlocked, nextUnplayed, restoreProgress, saveProgress, selectLevel, type Progress } from './progress';
import { formatTime, recordResult, restoreResults, saveResults, starsForDisplay, starsForTime, type Results } from './results';
import { victoryScreenLayout } from './victoryLayout';
import { galleryGrid } from './galleryLayout';
import './style.css';

type Piece = { id: number; sprite: Phaser.GameObjects.Image; region: PieceRegion; placed: boolean; home: Point; slot: number; hit: Uint8Array; texW: number; texH: number; baseW: number; baseH: number };
const RENDER_SCALE = Math.min(window.devicePixelRatio || 1, window.innerWidth >= 900 ? 1.5 : window.innerWidth >= 700 ? 1.75 : 2);
const BUILD_ID = (import.meta.env.VITE_BUILD_ID || 'local').slice(0, 8);
const VICTORY_LOG_KEY = 'mystic-puzzles-victory-log-v1';
const safeStorage = {
  getItem(key: string): string | null { try { return localStorage.getItem(key); } catch { return null; } },
  setItem(key: string, value: string): void { try { localStorage.setItem(key, value); } catch { /* Storage may be disabled. */ } },
};
class PuzzleScene extends Phaser.Scene {
  private art!: HTMLImageElement;
  private artLoaded = false;
  private level: LevelConfig = LEVELS[0];
  private progress: Progress = restoreProgress(safeStorage);
  private results: Results = restoreResults(safeStorage);
  private elapsedMs = 0;
  private startedAt = 0;
  private hiddenAt: number | null = null;
  private hiddenDuration = 0;
  private completedMs = 0;
  private victoryUiLogged = false;
  private timerText: Phaser.GameObjects.Text | null = null;
  private displayedTime = '';
  private pieces: Piece[] = [];
  private mode: 'menu' | 'levels' | 'gallery' | 'view' | 'game' | 'complete' = 'menu';
  private viewedLevel = 1;
  private galleryScrollRow = 0;
  private galleryPointerStart: { x: number; y: number } | null = null;
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
  private revealImage: Phaser.GameObjects.Image | null = null;
  private revealStartedAt = 0;
  private raster = { width: 0, height: 0 };
  private audio = new PuzzleAudio(safeStorage);
  private soundPanelOpen = false;

  constructor() { super('puzzle'); }
  preload() {
    this.load.image('menu-storybook', assetUrl('assets/menu-storybook.webp'));
    this.load.image('menu-storybook-wide', assetUrl('assets/menu-storybook-wide.webp'));
    this.load.image('plaque-gold', assetUrl('assets/plaque-gold.webp'));
    this.load.image('plaque-navy', assetUrl('assets/plaque-navy.webp'));
    this.load.image('header-ornate', assetUrl('assets/header-ornate.webp'));
    this.load.image('game-endpaper', assetUrl('assets/game-endpaper.webp'));
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
    this.input.on('wheel', (_pointer: Phaser.Input.Pointer, _over: unknown, _dx: number, dy: number) => {
      if (this.mode === 'gallery' && Math.abs(dy) > 1) this.scrollGallery(dy > 0 ? 1 : -1);
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.hiddenAt = performance.now();
      else {
        if (this.hiddenAt !== null) { this.hiddenDuration += performance.now() - this.hiddenAt; this.hiddenAt = null; }
      }
      if (this.mode === 'complete') this.logVictory(document.hidden ? 'hidden' : 'visible');
    });
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
    this.startedAt = performance.now(); this.hiddenDuration = 0; this.hiddenAt = document.hidden ? this.startedAt : null;
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
    this.revealImage?.setPosition(this.board.x + this.board.width / 2, this.board.y + this.board.height / 2).setDisplaySize(this.board.width, this.board.height);
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
    if (this.mode === 'gallery') {
      if (this.backButton().contains(x, y)) { this.mode = 'menu'; this.draw(); return; }
      this.galleryPointerStart = { x, y };
      return;
    }
    if (this.mode === 'levels') {
      if (this.backButton().contains(x, y)) { this.mode = 'menu'; this.draw(); return; }
      const id = this.cardAt(x, y);
      if (id && this.mode === 'levels' && isUnlocked(this.progress, id)) { this.startGame(id); }
      return;
    }
    if (this.mode === 'view') { if (this.backButton().contains(x, y) || this.galleryCloseButton().contains(x, y)) { this.mode = 'gallery'; this.draw(); } return; }
    if (this.mode === 'complete') {
      if (this.backButton().contains(x, y)) { this.removePieces(); this.mode = 'levels'; this.draw(); return; }
      if (this.hintButton().contains(x, y)) { this.removePieces(); this.mode = 'gallery'; this.draw(); return; }
      if (canAdvance(true, this.nextButton().contains(x, y))) {
        this.logVictory('next-pressed');
        const next = this.level.id + 1;
        if (next <= LEVELS.length) this.startGame(next);
        else { this.removePieces(); this.mode = 'gallery'; this.draw(); }
      }
      return;
    }
    if (this.backButton().contains(x, y)) { this.mode = 'levels'; this.removePieces(); this.draw(); return; }
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
    if (this.mode === 'gallery' && this.galleryPointerStart) {
      const start = this.galleryPointerStart;
      this.galleryPointerStart = null;
      const x = _pointer.x / RENDER_SCALE, y = _pointer.y / RENDER_SCALE;
      const dy = y - start.y;
      if (Math.abs(dy) > 24) {
        const step = galleryGrid(this.viewWidth(), this.viewHeight(), LEVELS.length).rowStep;
        this.scrollGallery(-Math.sign(dy) * Math.max(1, Math.round(Math.abs(dy) / step)));
      } else if (Math.abs(x - start.x) < 24) {
        const id = this.cardAt(x, y);
        if (id && isInGallery(this.progress, id)) { this.viewedLevel = id; this.mode = 'view'; this.draw(); }
      }
      return;
    }
    if (!this.dragging) return;
    const p = this.dragging; this.dragging = null;
    p.sprite.clearTint().setDepth(10 + p.id);
    const moved = wasDragged(this.dragOrigin, { x: p.sprite.x, y: p.sprite.y });
    const scale = looseScale(this.viewWidth(), this.viewHeight());
    p.sprite.setDisplaySize(p.baseW * scale, p.baseH * scale);
    const radius = Math.max(28, this.board.width * .14);
    if (moved && shouldSnap({ x: p.sprite.x, y: p.sprite.y }, p.home, radius)) {
      p.placed = true; if (this.level.id === 1) this.tutorialDone = true;
      const lastPiece = isComplete(this.pieces.map(piece => piece.placed));
      let settled = false;
      const settle = () => {
        if (settled || !p.sprite.active || !this.pieces.includes(p)) return;
        settled = true;
        p.sprite.setPosition(p.home.x, p.home.y).setTexture(`piece-clean-${p.id}`).setDisplaySize(p.baseW, p.baseH);
        this.audio.play('place');
        if (lastPiece) this.finish();
        this.draw();
      };
      this.tweens.add({ targets: p.sprite, x: p.home.x, y: p.home.y, displayWidth: p.baseW, displayHeight: p.baseH, duration: 250, ease: 'Sine.Out', onComplete: () => {
        settle();
      } });
      // Only the final visual snap needs a fallback: losing its tween completion would hide victory.
      if (lastPiece) window.setTimeout(() => {
        if (!settled && this.mode === 'game' && this.pieces.includes(p)) {
          this.tweens.killTweensOf(p.sprite);
          settle();
        }
      }, 350);
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
    if (this.startedAt) this.elapsedMs = this.currentElapsed();
    this.completedMs = this.elapsedMs;
    this.logVictory('last-piece-settled');
    this.mode = 'complete';
    this.victoryUiLogged = false;
    window.setTimeout(() => { if (this.mode === 'complete') this.audio.play('complete'); }, 300);
    const picture = this.victoryScreenLayout().picture;
    this.completeImage = this.add.image(picture.x + picture.width / 2, picture.y + picture.height / 2, 'whole-picture').setDepth(60).setDisplaySize(picture.width, picture.height);
    // The assembled board lingers and fades above the new composition. Results
    // already exist below it; no tween or delayed callback controls their state.
    this.revealImage = this.add.image(this.board.x + this.board.width / 2, this.board.y + this.board.height / 2, 'whole-picture')
      .setDepth(61).setDisplaySize(this.board.width, this.board.height);
    this.revealStartedAt = performance.now();
    this.pieces.forEach(piece => piece.sprite.setVisible(false));
    this.guideImage?.setVisible(false);
    this.progress = completeLevel(this.progress, this.level.id);
    saveProgress(safeStorage, this.progress);
    this.results = recordResult(this.results, this.level.id, this.completedMs);
    saveResults(safeStorage, this.results);
    this.logVictory('result-saved');
    this.draw();
  }
  private logVictory(event: string, detail: Record<string, number | boolean> = {}) {
    const entry = { event, build: BUILD_ID, at: new Date().toISOString(), level: this.level.id,
      mode: this.mode, placed: this.pieces.filter(piece => piece.placed).length, pieces: this.pieces.length,
      elapsedMs: Math.round(this.completedMs || this.elapsedMs), width: this.viewWidth(), height: this.viewHeight(),
      hidden: document.hidden, ...detail };
    console.info('[mystic-puzzles-victory]', entry);
    try {
      const previous = JSON.parse(safeStorage.getItem(VICTORY_LOG_KEY) || '[]');
      const log = Array.isArray(previous) ? previous.slice(-19) : [];
      log.push(entry);
      safeStorage.setItem(VICTORY_LOG_KEY, JSON.stringify(log));
    } catch { /* Diagnostics must never interrupt a victory. */ }
  }
  private startGame(id: number) {
    if (!isUnlocked(this.progress, id)) return;
    this.removePieces();
    this.level = levelById(id);
    this.progress = selectLevel(this.progress, id);
    saveProgress(safeStorage, this.progress);
    this.mode = 'game'; this.artLoaded = false; this.tutorialDone = false;
    this.elapsedMs = 0; this.startedAt = 0; this.completedMs = 0; this.victoryUiLogged = false; this.displayedTime = '';
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
    this.revealImage?.destroy(); this.revealImage = null;
    for (let id = 0; id < 8; id++) { if (this.textures.exists(`piece-clean-${id}`)) this.textures.remove(`piece-clean-${id}`); if (this.textures.exists(`piece-loose-${id}`)) this.textures.remove(`piece-loose-${id}`); }
    if (this.textures.exists('whole-picture')) this.textures.remove('whole-picture');
  }
  private soundButton() { const w = this.viewWidth(); return new Phaser.Geom.Circle(w >= 900 ? w - 43 : w - 32, w >= 900 ? 43 : 32, 24); }
  private soundPanel() { const w = this.viewWidth(), y = this.soundButton().y + 32; return new Phaser.Geom.Rectangle(w - 258, y, 244, 119); }
  private musicButton() { const r = this.soundPanel(); return new Phaser.Geom.Rectangle(r.x + 8, r.y + 9, r.width - 16, 50); }
  private effectsButton() { const r = this.soundPanel(); return new Phaser.Geom.Rectangle(r.x + 8, r.y + 60, r.width - 16, 50); }
  private menuButton() { const w = this.viewWidth(), h = this.viewHeight(), width = Math.min(w >= 900 ? 356 : 286, w * .79); return new Phaser.Geom.Rectangle(w / 2 - width / 2, h - (h < 700 ? 119 : 138), width, w >= 900 ? 68 : 58); }
  private galleryButton() { const w = this.viewWidth(), h = this.viewHeight(), width = Math.min(w >= 900 ? 170 : 155, w * .41); return new Phaser.Geom.Rectangle(w / 2 + 7, h < 700 ? h - 50 : h - 72, width, 44); }
  private galleryCloseButton() { const w = this.viewWidth(); return new Phaser.Geom.Rectangle(w - (w >= 900 ? 132 : 102), w >= 900 ? 40 : 24, w >= 900 ? 112 : 92, 42); }
  private levelsButton() { const w = this.viewWidth(), h = this.viewHeight(), width = Math.min(w >= 900 ? 170 : 155, w * .41); return new Phaser.Geom.Rectangle(w / 2 - width - 7, h < 700 ? h - 50 : h - 72, width, 44); }
  private nextButton() {
    const w = this.viewWidth();
    if (this.mode === 'complete') {
      const button = this.victoryScreenLayout().button;
      return new Phaser.Geom.Rectangle(button.x, button.y, button.width, button.height);
    }
    return new Phaser.Geom.Rectangle((w - 310) / 2, this.viewHeight() - 72, 310, 52);
  }
  private safeInset(side: 'top' | 'bottom') {
    const value = getComputedStyle(document.documentElement).getPropertyValue(`--safe-${side}`);
    return Math.max(0, parseFloat(value) || 0);
  }
  private victoryScreenLayout() {
    return victoryScreenLayout(this.viewWidth(), this.viewHeight(),
      this.safeInset('top'), this.safeInset('bottom'));
  }
  private backButton() {
    const w = this.viewWidth(), h = this.viewHeight();
    if (this.mode === 'levels' || this.mode === 'gallery' || this.mode === 'view') return new Phaser.Geom.Circle(w >= 900 ? Math.max(54, (w - 1560) / 2 + 30) : 35, h < 700 ? 39 : w >= 900 ? 62 : 46, 25);
    if (this.mode === 'complete') return new Phaser.Geom.Circle(w < 900 ? 30 : 43, (w < 900 ? 30 : 43) + this.safeInset('top'), 24);
    return new Phaser.Geom.Circle(this.headerCenter() - this.headerWidth() / 2 + 27, w < 900 ? 30 : 40, 24);
  }
  private hintButton() { const w = this.viewWidth();
    if (this.mode === 'complete') return new Phaser.Geom.Circle(w - (w < 900 ? 30 : 43), (w < 900 ? 30 : 43) + this.safeInset('top'), 24);
    return new Phaser.Geom.Circle(this.headerCenter() + this.headerWidth() / 2 - 27, w < 900 ? 30 : 40, 24); }
  private headerCenter() { return this.preview ? this.board.x + this.board.width / 2 : this.viewWidth() / 2; }
  private headerWidth() { return this.preview ? this.board.width : Math.min(this.viewWidth() - 8, 440); }

  private currentElapsed(): number {
    const now = performance.now();
    return Math.max(0, now - this.startedAt - this.hiddenDuration - (this.hiddenAt === null ? 0 : now - this.hiddenAt));
  }
  update() {
    if (this.mode === 'game' && this.pieces.length && this.startedAt && !document.hidden) {
      this.elapsedMs = this.currentElapsed();
      const label = formatTime(this.elapsedMs);
      if (label !== this.displayedTime) { this.timerText?.setText(label); this.displayedTime = label; }
    }
    if (this.revealImage) {
      const elapsed = performance.now() - this.revealStartedAt;
      this.revealImage.setAlpha(Math.max(0, Math.min(1, (680 - elapsed) / 420)));
      if (elapsed >= 680) { this.revealImage.destroy(); this.revealImage = null; }
    }
    this.fx.clear();
    if (this.mode === 'complete' && this.revealImage) {
      const phase = Math.min(1, (performance.now() - this.revealStartedAt) / 680);
      const glow = Math.sin(Math.PI * phase);
      this.revealImage.setTint(0xfff4df);
      this.fx.lineStyle(8, 0xffc76e, glow * .12).strokeRoundedRect(
        this.board.x - 3, this.board.y - 3, this.board.width + 6, this.board.height + 6, 8);
      this.fx.lineStyle(2, 0xffe1a1, glow * .65).strokeRoundedRect(
        this.board.x - 1, this.board.y - 1, this.board.width + 2, this.board.height + 2, 6);
    }
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
    this.timerText = null;
    this.uiImages.forEach(image => image.destroy()); this.uiImages = [];
    this.menuArt?.setVisible(this.mode === 'menu');
    this.bg.fillGradientStyle(0x050e1c, 0x050e1c, 0x132d43, 0x132d43, 1).fillRect(0, 0, w, h);
    this.drawAtmosphere(w, h);
    if (this.mode === 'menu') this.drawMenu(w, h);
    else if (this.mode === 'levels' || this.mode === 'gallery') this.drawCards(w);
    else if (this.mode === 'view') this.drawGalleryView(w, h);
    else if (this.mode === 'complete') this.drawVictory(w, h);
    else this.drawGame(w, h);
  }
  private drawAtmosphere(w: number, h: number) {
    this.bg.fillStyle(0xffde9c, .35);
    for (let i = 0; i < 62; i++) { const x = (i * 91 + 29) % w, y = (i * 157 + 11) % h; this.bg.fillCircle(x, y, i % 9 === 0 ? 1.7 : .75); }
    this.bg.lineStyle(1, 0xc28d51, .12);
    for (let i = 0; i < 5; i++) this.bg.strokeCircle(w * (i % 2 ? .93 : .07), h * (.15 + i * .2), 32 + i * 11);
  }
  private drawMenu(w: number, h: number) {
    const key = w >= 900 ? 'menu-storybook-wide' : 'menu-storybook';
    if (!this.menuArt || !this.menuArt.active || this.menuArt.texture.key !== key) {
      this.menuArt?.destroy(); this.menuArt = this.add.image(w / 2, h / 2, key).setDepth(1);
    }
    const source = this.textures.get(key).getSourceImage() as HTMLImageElement;
    const scale = Math.max(w / source.width, h / source.height);
    this.menuArt.setVisible(true).setPosition(w / 2, h / 2).setDisplaySize(source.width * scale, source.height * scale);
    // A light vignette supports the lettering while the painted cottage remains visible.
    this.boardG.fillGradientStyle(0x020813, 0x020813, 0x020813, 0x020813, .44, .44, 0, 0).fillRect(0, 0, w, h * .31);
    this.boardG.fillGradientStyle(0x020813, 0x020813, 0x020813, 0x020813, 0, 0, .47, .47).fillRect(0, h * .76, w, h * .24);
    const compact = h < 700, desktop = w >= 900;
    const titleY = compact ? 92 : desktop ? 119 : 124;
    this.txt(w / 2, titleY, 'Мистические', Math.min(desktop ? 65 : compact ? 36 : 43, w * .115), '#fff0c8', true);
    this.txt(w / 2, titleY + (compact ? 47 : desktop ? 70 : 58), 'Пазлы', Math.min(desktop ? 86 : compact ? 53 : 65, w * .17), '#ffe4a2', true);
    this.ornamentRule(w / 2, titleY + (compact ? 84 : desktop ? 126 : 108), desktop ? 192 : 130);
    this.drawSoundControls();
    this.menuPlaque(this.menuButton(), 'Играть', 'plaque-gold', this.menuPressed ? 3 : 0);
    this.secondaryButton(this.levelsButton(), 'Уровни');
    this.secondaryButton(this.galleryButton(), 'Галерея');
  }
  private secondaryButton(rect: Phaser.Geom.Rectangle, label: string) {
    this.menuPlaque(rect, label, 'plaque-navy');
  }
  private menuPlaque(rect: Phaser.Geom.Rectangle, label: string, key: 'plaque-gold' | 'plaque-navy', offsetY = 0) {
    const primary = key === 'plaque-gold';
    const image = this.add.image(rect.centerX, rect.centerY + offsetY, key).setDepth(110)
      .setDisplaySize(rect.width + (primary ? 22 : 11), rect.height + (primary ? 18 : 9));
    this.uiImages.push(image);
    this.txt(rect.centerX, rect.centerY + offsetY - 1, label, primary ? Math.min(26, rect.height * .43) : 16,
      primary ? '#382113' : '#ffe3aa', true, 'center', !primary);
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
    if (this.mode === 'gallery') return galleryGrid(w, h, LEVELS.length, this.galleryScrollRow).cards
      .map(r => new Phaser.Geom.Rectangle(r.x, r.y, r.width, r.height));
    if (w >= 900) {
      const gap = 16, group = Math.min(w - 120, 1560), width = (group - gap * 4) / 5;
      const height = Math.min(560, Math.max(350, h - 250)), top = Math.max(156, (h - height) / 2);
      return LEVELS.map((_, i) => new Phaser.Geom.Rectangle((w - group) / 2 + i * (width + gap), top, width, height));
    }
    const top = 76, gap = h < 700 ? 7 : 9;
    const width = (w - 32 - gap) / 2;
    const height = Math.min(220, (h - top - 15 - gap * 2) / 3);
    return LEVELS.map((_, i) => new Phaser.Geom.Rectangle(12 + (i % 2) * (width + gap), top + Math.floor(i / 2) * (height + gap), width, height));
  }
  private cardAt(x: number, y: number): number | null {
    if (this.mode === 'gallery') {
      const grid = galleryGrid(this.viewWidth(), this.viewHeight(), LEVELS.length, this.galleryScrollRow);
      if (y < grid.top || y > grid.bottom) return null;
    }
    const index = this.cardRects().findIndex(rect => rect.contains(x, y));
    return index < 0 ? null : LEVELS[index].id;
  }
  private scrollGallery(delta: number) {
    const grid = galleryGrid(this.viewWidth(), this.viewHeight(), LEVELS.length, this.galleryScrollRow + delta);
    if (grid.scrollRow === this.galleryScrollRow) return;
    this.galleryScrollRow = grid.scrollRow;
    this.draw();
  }
  private drawSectionHeader(w: number, title: string) {
    const desktop = w >= 900;
    const back = this.backButton(); this.iconCircle(back.x, back.y); this.backArrow(back.x, back.y);
    if (desktop) {
      this.txt(w / 2, 61, 'МИСТИЧЕСКИЕ ПАЗЛЫ', 12, '#cba56b', true);
      this.txt(w / 2, 110, title, 35, '#ffe9bd', true);
      this.ornamentRule(w / 2, 148, 340);
    } else {
      this.txt(w / 2 + 10, 39, title, Math.min(22, w * .056), '#ffe9bd', true);
      this.chrome.lineStyle(1, 0xcf9f62, .58).lineBetween(12, 68, w - 12, 68);
    }
  }
  private ornamentRule(x: number, y: number, width: number) {
    this.chrome.lineStyle(1, 0xb88a51, .5).lineBetween(x - width / 2, y, x - 10, y);
    this.chrome.lineBetween(x + 10, y, x + width / 2, y);
    this.chrome.fillStyle(0xe6b971, .85).fillTriangle(x, y - 5, x + 5, y, x, y + 5);
    this.chrome.fillTriangle(x, y - 5, x - 5, y, x, y + 5);
  }
  private drawCards(w: number) {
    const desktop = w >= 900;
    if (this.mode === 'gallery') { this.drawGalleryGrid(w); return; }
    this.drawSectionHeader(w, 'Выбор уровня');
    const rects = this.cardRects();
    for (let index = 0; index < LEVELS.length; index++) {
      const level = LEVELS[index], r = rects[index];
      const open = isUnlocked(this.progress, level.id);
      const done = this.progress.completed.includes(level.id);
      this.boardG.fillStyle(0x030b13, .82).fillRoundedRect(r.x + 2, r.y + 4, r.width, r.height, 10);
      this.boardG.fillStyle(0x102331, .95).fillRoundedRect(r.x, r.y, r.width, r.height, 9);
      this.boardG.lineStyle(1.3, done ? 0xe4b776 : open ? 0xcba06a : 0x586875, open ? .85 : .55).strokeRoundedRect(r.x, r.y, r.width, r.height, 9);
      const imageX = r.x + 5;
      const imageY = r.y + 5;
      const imageW = r.width - 10;
      const imageH = r.height - (desktop ? 78 : 35);
      this.cardThumbnail(level.id, imageX, imageY, imageW, imageH);
      this.chrome.lineStyle(1, 0xf2c883, open ? .68 : .25).strokeRoundedRect(imageX, imageY, imageW, imageH, 6);
      if (!open) {
        this.chrome.fillStyle(0x06111c, .68).fillRoundedRect(imageX, imageY, imageW, imageH, 6);
        this.drawLock(imageX + imageW / 2, imageY + imageH / 2);
      }
      {
        this.chrome.fillStyle(0x06121d, .72).fillRoundedRect(imageX + 5, imageY + 5, desktop ? 41 : 32, desktop ? 27 : 22, 6);
        this.txt(imageX + (desktop ? 25 : 21), imageY + (desktop ? 18 : 16), `0${level.id}`, desktop ? 14 : 11, '#ffdf9e', true);
        if (!desktop && !done) {
          const status = open ? 'ДОСТУПЕН' : 'ЗАКРЫТ';
          this.chrome.fillStyle(0x06121d, .75).fillRoundedRect(r.right - 69, imageY + 5, 63, 22, 5);
          this.txt(r.right - 37, imageY + 16, status, 8, open ? '#ffe1a9' : '#a6b2b6', true);
        }
        this.txt(r.centerX, r.bottom - (desktop ? 57 : 22), level.title, desktop ? 18 : 12, open ? '#ffe8bc' : '#aab3ba', true);
        if (desktop) {
          this.drawStars(r.centerX, r.bottom - 28, starsForDisplay(this.progress.completed, this.results, level.id), 8, true);
          if (!done) this.txt(r.centerX, r.bottom - 9, open ? 'ДОСТУПЕН' : 'ЗАКРЫТ', 10, open ? '#cda66d' : '#89959b', true);
        } else {
          this.drawStars(r.centerX, r.bottom - 8, starsForDisplay(this.progress.completed, this.results, level.id), 5.5, true);
        }
      }
    }
  }
  private drawGalleryGrid(w: number) {
    const h = this.viewHeight(), desktop = w >= 900;
    const grid = galleryGrid(w, h, LEVELS.length, this.galleryScrollRow);
    this.galleryScrollRow = grid.scrollRow;
    this.drawSectionHeader(w, 'Галерея картин');
    grid.cards.forEach((r, index) => {
      if (r.y < grid.top - .5 || r.y + r.height > grid.bottom + .5) return;
      const level = LEVELS[index], collected = isInGallery(this.progress, level.id);
      this.boardG.fillStyle(0x030a13, .72).fillRoundedRect(r.x + 2, r.y + 4, r.width, r.height, 9);
      this.boardG.fillStyle(0x102331, .98).fillRoundedRect(r.x, r.y, r.width, r.height, 8);
      this.boardG.lineStyle(1.25, collected ? 0xd6ac72 : 0x687282, collected ? .88 : .67)
        .strokeRoundedRect(r.x, r.y, r.width, r.height, 8);
      const imageX = r.x + 5, imageY = r.y + 5, imageW = r.width - 10;
      const imageH = r.height - (desktop ? 60 : 43);
      if (collected) this.cardThumbnail(level.id, imageX, imageY, imageW, imageH);
      else {
        this.boardG.fillStyle(0x071626, 1).fillRoundedRect(imageX, imageY, imageW, imageH, 5);
        this.boardG.lineStyle(1, 0xb58d59, .28).strokeRoundedRect(imageX + 8, imageY + 8, imageW - 16, imageH - 16, 4);
        this.drawLock(imageX + imageW / 2, imageY + imageH / 2);
      }
      this.chrome.lineStyle(1, collected ? 0xf2c883 : 0x8b785f, collected ? .8 : .42)
        .strokeRoundedRect(imageX, imageY, imageW, imageH, 5);
      this.chrome.fillStyle(0x071523, .8).fillRoundedRect(imageX + 5, imageY + 5, desktop ? 37 : 31, desktop ? 25 : 22, 5);
      this.txt(imageX + (desktop ? 23 : 20), imageY + (desktop ? 17 : 16),
        String(level.id).padStart(2, '0'), desktop ? 13 : 11, '#f7d8a0', true);
      this.fittedTitle(r.x + r.width / 2, r.y + r.height - (desktop ? 44 : 29),
        level.title, r.width - 14, desktop ? 18 : 13, desktop ? 14 : 10);
      this.drawStars(r.x + r.width / 2, r.y + r.height - (desktop ? 20 : 11),
        collected ? starsForDisplay(this.progress.completed, this.results, level.id) : 0, desktop ? 8 : 6, true);
    });
    if (grid.maxScrollRow > 0) {
      const trackH = grid.bottom - grid.top;
      const thumbH = Math.max(32, trackH * grid.visibleRows / (grid.maxScrollRow + grid.visibleRows));
      const x = desktop ? Math.min(w - 9, (w + Math.min(w - 120, 1560)) / 2 + 10) : w - 5;
      const y = grid.top + (trackH - thumbH) * grid.scrollRow / grid.maxScrollRow;
      this.chrome.fillStyle(0xe3b978, .2).fillRoundedRect(x - 2, grid.top, 3, trackH, 2);
      this.chrome.fillStyle(0xf4ce8c, .82).fillRoundedRect(x - 2, y, 3, thumbH, 2);
    }
  }
  private cardThumbnail(id: number, x: number, y: number, width: number, height: number) {
    const key = `art-${id}`;
    const source = this.textures.get(key).getSourceImage() as HTMLImageElement;
    const cropWidth = Math.min(source.width, source.height * width / height);
    const cropHeight = Math.min(source.height, source.width * height / width);
    const image = this.add.image(x + width / 2, y + height / 2, key).setDepth(5);
    image.setCrop((source.width - cropWidth) / 2, (source.height - cropHeight) / 2, cropWidth, cropHeight);
    image.setScale(width / cropWidth, height / cropHeight);
    this.uiImages.push(image);
  }
  private drawGalleryView(w: number, h: number) {
    const level = levelById(this.viewedLevel);
    const desktop = w >= 900;
    const back = this.backButton(), close = this.galleryCloseButton();
    this.iconCircle(back.x, back.y); this.backArrow(back.x, back.y);
    this.chrome.fillStyle(0x102331, .96).fillRoundedRect(close.x, close.y, close.width, close.height, 12);
    this.chrome.lineStyle(1.2, 0xd2a46a, .9).strokeRoundedRect(close.x, close.y, close.width, close.height, 12);
    this.txt(close.centerX, close.centerY, 'Закрыть', desktop ? 15 : 13, '#ffe6b6', true);
    this.fittedTitle(w / 2, desktop ? 113 : 82, level.title,
      desktop ? Math.min(650, w * .6) : w - 32, desktop ? 29 : 19, desktop ? 20 : 14);
    const top = desktop ? 160 : 102;
    const width = Math.min(w - (desktop ? 80 : 22), (h - top - (desktop ? 85 : 70)) * 2 / 3, desktop ? 590 : 590);
    const height = width * 1.5;
    const view = this.add.image(w / 2, top + height / 2, `art-${level.id}`).setDepth(5).setDisplaySize(width, height);
    this.uiImages.push(view);
    this.chrome.lineStyle(1.4, 0xd3aa70, .9).strokeRoundedRect(w / 2 - width / 2 - 3, top - 3, width + 6, height + 6, 7);
    const footerY = top + height + (desktop ? 21 : 17);
    this.drawStars(w / 2, footerY, starsForDisplay(this.progress.completed, this.results, level.id), desktop ? 8 : 7, true);
    const best = this.results[level.id]?.bestMs;
    this.txt(w / 2, footerY + (desktop ? 27 : 22), best === undefined ? 'Лучшее время —' : `Лучшее ${formatTime(best)}`,
      desktop ? 16 : 13, '#e8c99b', false);
  }
  private drawGame(w: number, h: number) {
    this.menuArt?.setVisible(false);
    const b = this.board, mobile = w < 900;
    // Keep the board rectangle and all piece coordinates intact; the scenery is behind it.
    const background = this.add.image(w / 2, h / 2, 'game-endpaper').setDepth(.5).setDisplaySize(w, h);
    this.uiImages.push(background);
    // The frame sits outside the authored picture and never covers or changes its masks.
    this.boardG.fillStyle(0x020a13, .72).fillRoundedRect(b.x - 2, b.y - 2, b.width + 4, b.height + 4, 6);
    this.boardG.lineStyle(1.2, 0xd6ad72, .85).strokeRoundedRect(b.x - 2, b.y - 2, b.width + 4, b.height + 4, 6);
    this.boardG.lineStyle(1, 0xffe0aa, .18).strokeRoundedRect(b.x - 1, b.y - 1, b.width + 2, b.height + 2, 4);
    this.guideImage?.setPosition(b.x + b.width / 2, b.y + b.height / 2).setDisplaySize(b.width, b.height);
    if (this.preview && this.previewImage) {
      const p = this.preview;
      this.boardG.fillStyle(0x081724, .7).fillRoundedRect(p.x - 4, p.y - 4, p.width + 8, p.height + 8, 7);
      this.boardG.lineStyle(1.2, 0xcda56f, .76).strokeRoundedRect(p.x - 4, p.y - 4, p.width + 8, p.height + 8, 7);
      this.previewImage.setVisible(true).setPosition(p.x + p.width / 2, p.y + p.height / 2).setDisplaySize(p.width, p.height);
    } else this.previewImage?.setVisible(false);

    const hx = this.headerCenter(), hw = this.headerWidth();
    const headerH = mobile ? 58 : 72;
    // A quiet, fixed header grid: controls at the edges, level/time in the
    // upper row, and the title in its own clear row above the picture.
    this.chrome.fillStyle(0x061725, .94).fillRoundedRect(hx - hw / 2 - 2, 1, hw + 4, headerH, 10);
    this.chrome.lineStyle(1, 0xc49457, .66).lineBetween(hx - hw / 2 + 51, headerH - 3, hx + hw / 2 - 51, headerH - 3);
    const back = this.backButton(), hint = this.hintButton();
    this.iconCircle(back.x, back.y, mobile ? 19 : 21);
    this.iconCircle(hint.x, hint.y, mobile ? 19 : 21);
    this.backArrow(back.x, back.y);
    this.bulb(hint.x, hint.y);
    this.txt(hx - (mobile ? 66 : 120), mobile ? 15 : 19,
      `УРОВЕНЬ 0${this.level.id}`, mobile ? 10 : 12, '#e7bf7e', true);
    this.displayedTime = formatTime(this.elapsedMs);
    this.timerText = this.txt(hx + (mobile ? 72 : 120), mobile ? 15 : 19,
      this.displayedTime, mobile ? 11 : 13, '#ffe1a8', true);
    this.fittedTitle(hx, mobile ? 39 : 48, this.level.title, hw - (mobile ? 108 : 125),
      mobile ? 17 : 22, mobile ? 13 : 16);
  }
  private drawVictory(w: number, h: number) {
    this.menuArt?.setVisible(false);
    this.previewImage?.setVisible(false);
    const layout = this.victoryScreenLayout();
    const b = layout.picture;
    const background = this.add.image(w / 2, h / 2, 'game-endpaper').setDepth(.5).setDisplaySize(w, h);
    this.uiImages.push(background);
    const back = this.backButton(), gallery = this.hintButton();
    this.iconCircle(back.x, back.y, layout.portrait ? 17 : 20);
    this.iconCircle(gallery.x, gallery.y, layout.portrait ? 17 : 20);
    this.backArrow(back.x, back.y);
    this.galleryIcon(gallery.x, gallery.y);
    this.boardG.fillStyle(0x020916, .72).fillRoundedRect(b.x - 7, b.y - 7, b.width + 14, b.height + 14, 8);
    this.completeImage?.setPosition(b.x + b.width / 2, b.y + b.height / 2).setDisplaySize(b.width, b.height);
    this.chrome.lineStyle(2, 0xe2b976, .96).strokeRoundedRect(b.x - 4, b.y - 4, b.width + 8, b.height + 8, 6);
    this.chrome.lineStyle(1, 0xffe7bb, .53).strokeRoundedRect(b.x - 7, b.y - 7, b.width + 14, b.height + 14, 9);
    for (const x of [b.x - 5, b.x + b.width + 5]) for (const y of [b.y - 5, b.y + b.height + 5]) {
      this.chrome.fillStyle(0xffdc91, .6).fillCircle(x, y, 2.4);
    }
    const cx = layout.contentX;
    const title = this.fittedTitle(cx, layout.titleY, 'Картина собрана!', layout.contentWidth,
      layout.portrait ? 23 : 34, layout.portrait ? 18 : 27);
    title.setColor('#ffe8b8');
    this.fittedTitle(cx, layout.nameY, this.level.title, layout.contentWidth,
      layout.portrait ? 15 : 23, layout.portrait ? 12 : 17).setColor('#f4d7a4');
    this.ornamentRule(cx, (layout.nameY + layout.starsY) / 2, Math.min(layout.contentWidth - 34, 225));
    for (let i = -1; i <= 1; i++) {
      this.chrome.fillStyle(0xf5bd59, .12).fillCircle(cx + i * layout.starRadius * 2.6, layout.starsY, layout.starRadius * 1.65);
    }
    this.drawStars(cx, layout.starsY, starsForTime(this.level.pieces, this.completedMs), layout.starRadius);
    this.txt(cx, layout.timeY, `Время ${formatTime(this.completedMs)}`,
      layout.portrait ? 15 : 22, '#ffe3ad', true);
    const next = this.nextButton();
    this.button(next.centerX, next.centerY, next.width, next.height,
      this.level.id === LEVELS.length ? 'В галерею' : 'Далее');
    if (!layout.portrait) {
      this.ornamentRule(cx, layout.button.y + layout.button.height + 37, Math.min(layout.contentWidth - 30, 220));
    }
    if (!this.victoryUiLogged) {
      this.victoryUiLogged = true;
      this.logVictory('ui-drawn', { stars: starsForTime(this.level.pieces, this.completedMs),
        buttonX: next.x, buttonY: next.y, buttonWidth: next.width, buttonHeight: next.height,
        pictureBottom: b.y + b.height, resultsTop: layout.titleY });
    }
  }
  private fittedTitle(x: number, y: number, value: string, available: number, preferred: number, minimum: number) {
    const title = this.txt(x, y, value, preferred, '#ffebc8', true);
    let size = preferred;
    while (title.width > available && size > minimum) title.setFontSize(--size);
    if (title.width > available) {
      let shortened = value;
      while (title.width > available && shortened.length > 2) {
        shortened = `${shortened.slice(0, -2)}…`;
        title.setText(shortened);
      }
    }
    return title;
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
  private drawStars(x: number, y: number, filled: number, radius: number, collection = false) {
    for (let star = 0; star < 3; star++) {
      const cx = x + (star - 1) * radius * 2.6;
      const points = Array.from({ length: 10 }, (_, i) => new Phaser.Geom.Point(cx + Math.cos(-Math.PI / 2 + i * Math.PI / 5) * (i % 2 ? radius * .45 : radius), y + Math.sin(-Math.PI / 2 + i * Math.PI / 5) * (i % 2 ? radius * .45 : radius)));
      if (star < filled) this.chrome.fillStyle(0xffd578, 1).fillPoints(points, true);
      else if (collection) this.chrome.fillStyle(0x775e39, .27).fillPoints(points, true);
      this.chrome.lineStyle(1.5, star < filled ? 0xffd578 : collection ? 0xb99a68 : 0x796f60,
        star < filled ? .95 : collection ? .88 : .7).strokePoints(points, true);
    }
  }
  private iconCircle(x: number, y: number, radius = 22) {
    this.chrome.fillStyle(0x02080f, .62).fillCircle(x, y + 2, radius + 1);
    this.chrome.fillStyle(0x19303b, .98).fillCircle(x, y, radius);
    this.chrome.lineStyle(2, 0xd0a265, .95).strokeCircle(x, y, radius - 1);
    this.chrome.lineStyle(1, 0xf3d8a7, .32).strokeCircle(x, y, radius - 5);
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
    this.menuPlaque(new Phaser.Geom.Rectangle(x - w / 2, y - h / 2, w, h), label, 'plaque-gold');
  }
  private txt(x: number, y: number, value: string, size: number, color: string, bold = false, align: 'center' | 'left' = 'center', shadow = true): Phaser.GameObjects.Text {
    return this.add.text(x, y, value, { fontFamily: 'Georgia, serif', fontSize: `${size}px`, color, fontStyle: bold ? 'bold' : 'normal', align, shadow: shadow ? { color: '#05070c', blur: 6, fill: true, offsetY: 2 } : undefined }).setOrigin(align === 'left' ? 0 : .5, .5).setDepth(200).setResolution(RENDER_SCALE).setData('uiText', true);
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

function resizeGame() {
  game.scale.setGameSize(Math.round(window.innerWidth * RENDER_SCALE), Math.round(window.innerHeight * RENDER_SCALE));
  game.scale.refresh();
}
window.addEventListener('resize', resizeGame);
if (import.meta.env.DEV) Object.assign(window, { __mysticGame: game });
