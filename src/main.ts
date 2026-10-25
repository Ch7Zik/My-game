/// <reference types="vite/client" />
import Phaser from 'phaser';
import { galleryGrid } from './galleryLayout';
import { fitPainting, levelGrid } from './levelGrid';
import { createRegions, inspectRegions, qualityProblems, type PieceRegion, type Point } from './geometry';
import { canAdvance, canDrag, isComplete, shouldSnap, wasDragged } from './puzzleRules';
import { pieceDepth } from './pieceLayers';
import { scatterPieces, scatterPosition } from './scatter';
import { gameFooterLayout, gameLayout, looseScale, startPosition, SLOT_ORDER, type Rect } from './layout';
import { LEVELS, levelById, levelForPlay, type LevelConfig } from './levels';
import { assetUrl } from './assetUrl';
import { PuzzleAudio } from './audio';
import { YandexGamesBridge } from './yandexGames';
import { completeLevel, isInGallery, isUnlocked, nextUnplayed, restoreProgress, saveProgress, selectLevel, type Progress } from './progress';
import { formatTime, recordResult, restoreResults, saveResults, starsForDisplay, starsForTime, type Results } from './results';
import { fitVictoryStars, victoryAwardProgress, victoryScreenLayout } from './victoryLayout';
import { strokeFrameRect } from './chromeLayout';
import levelFontUrl from './assets/NotoSerif-Bold.ttf?url';
import './style.css';

type Piece = { id: number; sprite: Phaser.GameObjects.Image; region: PieceRegion; placed: boolean; home: Point; slot: number; start: Point | null; hit: Uint8Array; texW: number; texH: number; baseW: number; baseH: number };
const RENDER_SCALE = Math.min(window.devicePixelRatio || 1, window.innerWidth >= 900 ? 1.5 : window.innerWidth >= 700 ? 1.75 : 2);
const BUILD_ID = (import.meta.env.VITE_BUILD_ID || 'local').slice(0, 8);
const VICTORY_LOG_KEY = 'mystic-puzzles-victory-log-v1';
const MENU_REFERENCE = { width: 938, height: 1677 };
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
// Bundle the level label's font so Safari and desktop render the same lining
// numerals and Cyrillic capitals. Georgia has different glyph proportions on iOS.
const levelFontReady = typeof FontFace === 'undefined' ? Promise.resolve() :
  new FontFace('MysticLevelSerif', `url("${levelFontUrl}")`, { weight: '700' })
    .load().then(face => { document.fonts.add(face); });
const safeStorage = {
  getItem(key: string): string | null { try { return localStorage.getItem(key); } catch { return null; } },
  setItem(key: string, value: string): void { try { localStorage.setItem(key, value); } catch { /* Storage may be disabled. */ } },
};
const yandexGames = new YandexGamesBridge(import.meta.env.MODE === 'yandex');
class PuzzleScene extends Phaser.Scene {
  private art!: HTMLImageElement;
  private artLoaded = false;
  private galleryArtLoading = new Set<number>();
  private level: LevelConfig = LEVELS[0];
  private progress: Progress = restoreProgress(safeStorage);
  private results: Results = restoreResults(safeStorage);
  private elapsedMs = 0;
  private startedAt = 0;
  private inactiveAt: number | null = null;
  private inactiveDuration = 0;
  private completedMs = 0;
  private victoryUiLogged = false;
  private victoryStarY = 0;
  private victoryGlowRadius = 0;
  private victoryAwardStartedAt = 0;
  private timerText: Phaser.GameObjects.Text | null = null;
  private displayedTime = '';
  private pieces: Piece[] = [];
  private mode: 'menu' | 'levels' | 'gallery' | 'view' | 'game' | 'complete' = 'menu';
  private lastDrawMode: typeof this.mode | null = null;
  private viewedLevel = 1;
  private galleryScrollRow = 0;
  private levelScrollY = 0;
  private galleryPointerStart: { x: number; y: number; scroll: number; moved: boolean; card: number | null } | null = null;
  private levelPointerStart: { x: number; y: number; scroll: number; card: number | null; moved: boolean } | null = null;
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
  private levelLayer: Phaser.GameObjects.Container | null = null;
  private levelMask: Phaser.GameObjects.Graphics | null = null;
  private levelScrollTrack: Phaser.GameObjects.Graphics | null = null;
  private galleryLayer: Phaser.GameObjects.Container | null = null;
  private galleryMask: Phaser.GameObjects.Graphics | null = null;
  private galleryScrollTrack: Phaser.GameObjects.Graphics | null = null;
  private guideImage: Phaser.GameObjects.Image | null = null;
  private previewImage: Phaser.GameObjects.Image | null = null;
  private completeImage: Phaser.GameObjects.Image | null = null;
  private revealImage: Phaser.GameObjects.Image | null = null;
  private revealStartedAt = 0;
  private raster = { width: 0, height: 0 };
  private audio = new PuzzleAudio(safeStorage);
  private soundPanelOpen = false;
  private readonly devPieces = import.meta.env.DEV ? Number(new URLSearchParams(window.location.search).get('devPieces')) : 0;
  private shuffleSeed = 0;

  constructor() { super('puzzle'); }
  preload() {
    this.load.image('menu-alchemist', assetUrl('assets/menu-alchemist.webp'));
    this.load.image('menu-title', assetUrl('assets/menu-title.webp'));
    this.load.image('menu-button-gold', assetUrl('assets/menu-button-gold.webp'));
    this.load.image('menu-button-levels', assetUrl('assets/menu-button-levels.webp'));
    this.load.image('menu-button-gallery', assetUrl('assets/menu-button-gallery.webp'));
    this.load.image('plaque-gold', assetUrl('assets/plaque-gold.webp'));
    this.load.image('plaque-navy', assetUrl('assets/plaque-navy.webp'));
    this.load.image('header-ornate', assetUrl('assets/header-ornate.webp'));
    this.load.image('game-endpaper', assetUrl('assets/game-endpaper.webp'));
    for (const level of LEVELS) this.load.image(`art-${level.id}`, level.thumbnail);
  }
  create() {
    void levelFontReady.then(() => { if (this.mode === 'game') this.draw(); });
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
      if (this.mode === 'gallery' && Math.abs(dy) > .5) {
        const grid = this.galleryGridLayout();
        this.scrollGallery(this.galleryScrollRow * grid.rowStep + dy);
      }
      if (this.mode === 'levels' && Math.abs(dy) > .5) this.scrollLevels(this.levelScrollY + dy);
    });
    document.addEventListener('visibilitychange', () => {
      this.syncInactive();
      if (this.mode === 'complete') this.logVictory(document.hidden ? 'hidden' : 'visible');
    });
    const unsubscribe = yandexGames.onPauseChanged(paused => {
      this.audio.setPlatformPaused(paused);
      this.syncInactive();
      if (paused) {
        if (this.dragging) {
          const piece = this.dragging;
          const scale = looseScale(this.viewWidth(), this.viewHeight());
          piece.sprite.clearTint().setDepth(pieceDepth(piece.id, false))
            .setDisplaySize(piece.baseW * scale, piece.baseH * scale);
          this.dragging = null;
        }
        this.galleryPointerStart = null;
        this.levelPointerStart = null;
      }
    });
    this.events.once('shutdown', unsubscribe);
    this.audio.setPlatformPaused(yandexGames.paused);
    this.syncInactive();
    this.layout();
    if (this.devPieces === 16 || this.devPieces === 20) this.startGame(6);
    else this.draw();
    requestAnimationFrame(() => yandexGames.markReady());
  }

  private syncInactive() {
    const inactive = document.hidden || yandexGames.paused;
    if (inactive && this.inactiveAt === null) this.inactiveAt = performance.now();
    else if (!inactive && this.inactiveAt !== null) {
      this.inactiveDuration += performance.now() - this.inactiveAt;
      this.inactiveAt = null;
    }
  }

  private viewWidth() { return this.scale.width / RENDER_SCALE; }
  private viewHeight() { return this.scale.height / RENDER_SCALE; }
  private layout() {
    const game = this.mode === 'game';
    const layout = gameLayout(this.viewWidth(), this.viewHeight(),
      game ? this.safeInset('top') : 0, game ? this.safeInset('bottom') : 0);
    this.board = layout.board; this.preview = layout.preview;
  }

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
    const { labels, regions } = createRegions(cw, ch, this.level.columns, this.level.rows, this.level.seed, this.level.pieces);
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
      const sprite = this.add.image(0, 0, `piece-loose-${region.id}`).setDepth(pieceDepth(region.id, false));
      const piece: Piece = { id: region.id, sprite, region, placed: false, home: { x: 0, y: 0 }, slot: this.level.slots[region.id] ?? SLOT_ORDER[region.id], start: null, hit, texW: tw, texH: th, baseW: 0, baseH: 0 };
      this.pieces.push(piece);
    }
    if (this.level.pieces >= 10) {
      const scale = looseScale(this.viewWidth(), this.viewHeight());
      const sizes = this.pieces.map(piece => {
        const b = piece.region.bounds;
        return { id: piece.id,
          home: { x: this.board.x + (b.x + b.width / 2) / cw * this.board.width,
            y: this.board.y + (b.y + b.height / 2) / ch * this.board.height },
          width: piece.texW / cw * this.board.width * scale,
          height: piece.texH / ch * this.board.height * scale };
      });
      const starts = scatterPieces(sizes, this.board, this.shuffleSeed);
      this.pieces.forEach((piece, index) => { piece.start = starts[index]; });
    }
    this.startedAt = performance.now(); this.inactiveDuration = 0;
    this.inactiveAt = document.hidden || yandexGames.paused ? this.startedAt : null;
    this.reflowPieces(); this.mode = 'game'; this.draw();
  }

  private reflowPieces() {
    if (!this.pieces.length) return;
    this.dragging?.sprite.clearTint();
    this.dragging = null;
    const cw = this.raster.width, ch = this.raster.height, scale = looseScale(this.viewWidth(), this.viewHeight());
    for (const piece of this.pieces) {
      const b = piece.region.bounds;
      piece.baseW = piece.texW * this.board.width / cw;
      piece.baseH = piece.texH * this.board.height / ch;
      piece.home = { x: this.board.x + (b.x + b.width / 2) / cw * this.board.width, y: this.board.y + (b.y + b.height / 2) / ch * this.board.height };
      const effective = piece.placed ? 1 : scale;
      piece.sprite.setDisplaySize(piece.baseW * effective, piece.baseH * effective);
      piece.sprite.setDepth(pieceDepth(piece.id, piece.placed));
      const start = piece.start ? scatterPosition(this.board, piece.start, piece.sprite.displayWidth, piece.sprite.displayHeight)
        : startPosition(this.board, this.viewWidth(), piece.slot, piece.sprite.displayWidth, piece.sprite.displayHeight);
      piece.sprite.setPosition(piece.placed ? piece.home.x : start.x, piece.placed ? piece.home.y : start.y);
    }
    this.guideImage?.setPosition(this.board.x + this.board.width / 2, this.board.y + this.board.height / 2).setDisplaySize(this.board.width, this.board.height);
    this.completeImage?.setPosition(this.board.x + this.board.width / 2, this.board.y + this.board.height / 2).setDisplaySize(this.board.width, this.board.height);
    this.revealImage?.setPosition(this.board.x + this.board.width / 2, this.board.y + this.board.height / 2).setDisplaySize(this.board.width, this.board.height);
  }

  private pointerDown(pointer: Phaser.Input.Pointer) {
    if (yandexGames.paused) return;
    const x = pointer.x / RENDER_SCALE, y = pointer.y / RENDER_SCALE;
    this.audio.unlock();
    if (this.mode === 'menu') {
      if (this.settingsButton().contains(x, y)) {
        this.soundPanelOpen = !this.soundPanelOpen; this.draw(); return;
      }
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
          this.startGame(next > LEVELS.length ? 1 : next);
        });
      } else if (this.levelsButton().contains(x, y)) { this.mode = 'levels'; this.draw(); }
      else if (this.galleryButton().contains(x, y)) { this.mode = 'gallery'; this.draw(); }
      return;
    }
    if (this.mode === 'gallery') {
      if (this.backButton().contains(x, y)) { this.mode = 'menu'; this.draw(); return; }
      const grid = this.galleryGridLayout();
      if (y >= grid.top && y <= grid.bottom)
        this.galleryPointerStart = { x, y, scroll: this.galleryScrollRow * grid.rowStep,
          moved: false, card: this.cardAt(x, y) };
      return;
    }
    if (this.mode === 'levels') {
      if (this.backButton().contains(x, y)) { this.mode = 'menu'; this.draw(); return; }
      const grid = this.levelGridLayout();
      if (y >= grid.top && y <= grid.bottom)
        this.levelPointerStart = { x, y, scroll: this.levelScrollY, card: this.cardAt(x, y), moved: false };
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
    hit.sprite.setDepth(pieceDepth(hit.id, false, true)).setTint(0xffe2ac);
    this.pointerOffset = { x: hit.sprite.x - x, y: hit.sprite.y - y };
    this.dragOrigin = { x: hit.sprite.x, y: hit.sprite.y };
    const scale = looseScale(this.viewWidth(), this.viewHeight()) * 1.04;
    hit.sprite.setDisplaySize(hit.baseW * scale, hit.baseH * scale);
  }
  private pointerMove(pointer: Phaser.Input.Pointer) {
    if (yandexGames.paused) return;
    if (this.mode === 'gallery' && this.galleryPointerStart) {
      const start = this.galleryPointerStart;
      const y = pointer.y / RENDER_SCALE;
      if (Math.abs(y - start.y) > 8) start.moved = true;
      if (start.moved) this.scrollGallery(start.scroll + start.y - y);
      return;
    }
    if (this.mode === 'levels' && this.levelPointerStart) {
      const start = this.levelPointerStart;
      const y = pointer.y / RENDER_SCALE;
      if (Math.abs(y - start.y) > 8) start.moved = true;
      if (start.moved) this.scrollLevels(start.scroll + start.y - y);
      return;
    }
    if (!this.dragging) return;
    const p = this.dragging;
    p.sprite.x = Phaser.Math.Clamp(pointer.x / RENDER_SCALE + this.pointerOffset.x, 3 + p.sprite.displayWidth / 2, this.viewWidth() - 3 - p.sprite.displayWidth / 2);
    p.sprite.y = Phaser.Math.Clamp(pointer.y / RENDER_SCALE + this.pointerOffset.y, this.board.y + p.sprite.displayHeight / 2, this.board.y + this.board.height - p.sprite.displayHeight / 2);
  }
  private pointerUp(_pointer: Phaser.Input.Pointer) {
    if (yandexGames.paused) return;
    if (this.mode === 'levels' && this.levelPointerStart) {
      const start = this.levelPointerStart;
      this.levelPointerStart = null;
      const x = _pointer.x / RENDER_SCALE, y = _pointer.y / RENDER_SCALE;
      if (!start.moved && Math.abs(y - start.y) < 10 && Math.abs(x - start.x) < 12) {
        const id = this.cardAt(x, y);
        if (id === start.card && id && isUnlocked(this.progress, id)) this.startGame(id);
      }
      return;
    }
    if (this.mode === 'gallery' && this.galleryPointerStart) {
      const start = this.galleryPointerStart;
      this.galleryPointerStart = null;
      const x = _pointer.x / RENDER_SCALE, y = _pointer.y / RENDER_SCALE;
      if (!start.moved && Math.abs(y - start.y) < 10 && Math.abs(x - start.x) < 12) {
        const id = this.cardAt(x, y);
        if (id === start.card && id && isInGallery(this.progress, id)) {
          this.viewedLevel = id; this.mode = 'view'; this.draw();
        }
      }
      return;
    }
    if (!this.dragging) return;
    const p = this.dragging; this.dragging = null;
    p.sprite.clearTint();
    const moved = wasDragged(this.dragOrigin, { x: p.sprite.x, y: p.sprite.y });
    const scale = looseScale(this.viewWidth(), this.viewHeight());
    p.sprite.setDisplaySize(p.baseW * scale, p.baseH * scale);
    const radius = Math.max(28, this.board.width * .14);
    if (moved && shouldSnap({ x: p.sprite.x, y: p.sprite.y }, p.home, radius)) {
      p.placed = true; if (this.level.id === 1) this.tutorialDone = true;
      p.sprite.setDepth(pieceDepth(p.id, true));
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
    } else { p.sprite.setDepth(pieceDepth(p.id, false)); this.draw(); }
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
    this.victoryAwardStartedAt = performance.now();
    window.setTimeout(() => { if (this.mode === 'complete') this.audio.play('complete'); }, 300);
    const picture = this.victoryScreenLayout().picture;
    this.completeImage = this.add.image(picture.x + picture.width / 2, picture.y + picture.height / 2, 'whole-picture').setDepth(60).setDisplaySize(picture.width, picture.height);
    // The assembled board lingers and fades above the new composition. Results
    // already exist below it; no tween or delayed callback controls their state.
    if (!reducedMotion.matches) this.revealImage = this.add.image(
      this.board.x + this.board.width / 2, this.board.y + this.board.height / 2, 'whole-picture')
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
    if (!isUnlocked(this.progress, id) && !(import.meta.env.DEV && id === 6 && (this.devPieces === 16 || this.devPieces === 20))) return;
    this.removePieces();
    this.level = levelForPlay(id, this.devPieces, import.meta.env.DEV);
    this.shuffleSeed = Math.floor(Math.random() * 0x100000000);
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
    const pieceIds = this.pieces.map(piece => piece.id);
    this.dragging = null; this.hintPiece = null; this.pieces.forEach(p => p.sprite.destroy()); this.pieces = [];
    this.guideImage?.destroy(); this.guideImage = null; this.previewImage?.destroy(); this.previewImage = null;
    this.completeImage?.destroy(); this.completeImage = null;
    this.revealImage?.destroy(); this.revealImage = null;
    for (const id of pieceIds) { if (this.textures.exists(`piece-clean-${id}`)) this.textures.remove(`piece-clean-${id}`); if (this.textures.exists(`piece-loose-${id}`)) this.textures.remove(`piece-loose-${id}`); }
    if (this.textures.exists('whole-picture')) this.textures.remove('whole-picture');
  }
  private settingsButton() { return new Phaser.Geom.Circle(this.viewWidth() - 29, this.safeInset('top') + 29, 23); }
  private soundPanel() { const w = this.viewWidth(), y = Math.max(this.settingsButton().y + 30, 539 * this.menuScale() + 8), width = Math.min(244, w - 24); return new Phaser.Geom.Rectangle(w - width - 12, y, width, 119); }
  private musicButton() { const r = this.soundPanel(); return new Phaser.Geom.Rectangle(r.x + 8, r.y + 9, r.width - 16, 50); }
  private effectsButton() { const r = this.soundPanel(); return new Phaser.Geom.Rectangle(r.x + 8, r.y + 60, r.width - 16, 50); }
  private menuScale() { return this.viewHeight() / MENU_REFERENCE.height; }
  private menuFooterShift() { const k = this.menuScale(); return Math.max(0, this.safeInset('bottom') + 12 - (this.viewHeight() - 1608 * k)); }
  private menuRect(x: number, y: number, width: number, height: number, footer = false) {
    const k = this.menuScale(), w = this.viewWidth();
    const scaledWidth = Math.min(width * k, w - 12);
    const scaledHeight = height * (scaledWidth / width);
    return new Phaser.Geom.Rectangle(w / 2 + (x + width / 2 - MENU_REFERENCE.width / 2) * k - scaledWidth / 2,
      (y + height / 2) * k - scaledHeight / 2 - (footer ? this.menuFooterShift() : 0), scaledWidth, scaledHeight);
  }
  private menuButton() { return this.menuRect(114, 1365, 710, 139, true); }
  private galleryButton() { const r = this.menuRect(470, 1500, 334, 108, true); return new Phaser.Geom.Rectangle(r.x, r.y - Math.max(0, 44 - r.height) / 2, r.width, Math.max(44, r.height)); }
  private galleryCloseButton() { const w = this.viewWidth(); return new Phaser.Geom.Rectangle(
    w - (w >= 900 ? 132 : 102), this.safeInset('top') + (w >= 900 ? 40 : 24), w >= 900 ? 112 : 92, 44); }
  private levelsButton() { const r = this.menuRect(137, 1500, 335, 108, true); return new Phaser.Geom.Rectangle(r.x, r.y - Math.max(0, 44 - r.height) / 2, r.width, Math.max(44, r.height)); }
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
    if (this.mode === 'levels') return new Phaser.Geom.Circle(32, this.safeInset('top') + 34, 25);
    if (this.mode === 'gallery' || this.mode === 'view') return new Phaser.Geom.Circle(
      w >= 900 ? Math.max(54, (w - 1560) / 2 + 30) : 35,
      (h < 700 ? 39 : w >= 900 ? 62 : 46) + this.safeInset('top'), 25);
    if (this.mode === 'complete') return new Phaser.Geom.Circle(w < 900 ? 30 : 43, (w < 900 ? 30 : 43) + this.safeInset('top'), 24);
    return new Phaser.Geom.Circle(this.headerCenter() - this.headerWidth() / 2 + 27,
      (w < 900 ? 30 : 40) + (this.mode === 'game' ? this.safeInset('top') : 0), 24);
  }
  private hintButton() { const w = this.viewWidth();
    if (this.mode === 'complete') return new Phaser.Geom.Circle(w - (w < 900 ? 30 : 43), (w < 900 ? 30 : 43) + this.safeInset('top'), 24);
    if (this.mode === 'game') {
      const footer = gameFooterLayout(w, this.viewHeight(), this.board, this.safeInset('bottom'));
      if (footer.hintBelow) return new Phaser.Geom.Circle(footer.hint.x, footer.hint.y, 24);
    }
    return new Phaser.Geom.Circle(this.headerCenter() + this.headerWidth() / 2 - 27,
      (w < 900 ? 30 : 40) + (this.mode === 'game' ? this.safeInset('top') : 0), 24); }
  private headerCenter() { return this.preview ? this.board.x + this.board.width / 2 : this.viewWidth() / 2; }
  private headerWidth() { return this.preview ? this.board.width : Math.min(this.viewWidth() - 8, this.mode === 'game' ? 600 : 440); }

  private currentElapsed(): number {
    const now = performance.now();
    return Math.max(0, now - this.startedAt - this.inactiveDuration - (this.inactiveAt === null ? 0 : now - this.inactiveAt));
  }
  update() {
    if (this.mode === 'game' && this.pieces.length && this.startedAt && !document.hidden && !yandexGames.paused) {
      this.elapsedMs = this.currentElapsed();
      const label = formatTime(this.elapsedMs);
      if (label !== this.displayedTime) { this.timerText?.setText(label); this.displayedTime = label; }
    }
    if (this.revealImage) {
      const elapsed = performance.now() - this.revealStartedAt;
      if (reducedMotion.matches || elapsed >= 680) { this.revealImage.destroy(); this.revealImage = null; }
      else this.revealImage.setAlpha(Math.max(0, Math.min(1, (680 - elapsed) / 420)));
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
    if (this.mode === 'complete') this.drawVictoryAward();
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
    this.levelLayer?.destroy(); this.levelLayer = null;
    this.levelMask?.destroy(); this.levelMask = null;
    this.levelScrollTrack?.destroy(); this.levelScrollTrack = null;
    this.galleryLayer?.destroy(); this.galleryLayer = null;
    this.galleryMask?.destroy(); this.galleryMask = null;
    this.galleryScrollTrack?.destroy(); this.galleryScrollTrack = null;
    this.layout(); this.bg.clear(); this.boardG.clear(); this.chrome.clear();
    this.children.list.filter(c => c.getData('uiText')).forEach(c => c.destroy());
    this.timerText = null;
    this.uiImages.forEach(image => image.destroy()); this.uiImages = [];
    this.menuArt?.setVisible(this.mode === 'menu');
    this.bg.fillGradientStyle(0x050e1c, 0x050e1c, 0x132d43, 0x132d43, 1).fillRect(0, 0, w, h);
    this.drawAtmosphere(w, h);
    if (this.mode === 'menu') this.drawMenu(w, h);
    else if (this.mode === 'levels') this.drawLevelSelect(w, h);
    else if (this.mode === 'gallery') this.drawGalleryGrid(w);
    else if (this.mode === 'view') this.drawGalleryView(w, h);
    else if (this.mode === 'complete') this.drawVictory(w, h);
    else this.drawGame(w, h);
    if (this.mode !== 'game' || this.artLoaded) {
      const changed = this.lastDrawMode !== null && this.lastDrawMode !== this.mode;
      this.lastDrawMode = this.mode;
      if (changed && this.mode !== 'complete' && !reducedMotion.matches)
        this.cameras.main.fadeIn(220, 0, 0, 0);
    }
    yandexGames.setGameplay(this.mode === 'game' && this.artLoaded && this.pieces.length > 0);
  }
  private drawAtmosphere(w: number, h: number) {
    this.bg.fillStyle(0xffde9c, .35);
    for (let i = 0; i < 62; i++) { const x = (i * 91 + 29) % w, y = (i * 157 + 11) % h; this.bg.fillCircle(x, y, i % 9 === 0 ? 1.7 : .75); }
    this.bg.lineStyle(1, 0xc28d51, .12);
    for (let i = 0; i < 5; i++) this.bg.strokeCircle(w * (i % 2 ? .93 : .07), h * (.15 + i * .2), 32 + i * 11);
  }
  private drawMenu(w: number, h: number) {
    const key = 'menu-alchemist';
    if (!this.menuArt || !this.menuArt.active || this.menuArt.texture.key !== key) {
      this.menuArt?.destroy(); this.menuArt = this.add.image(w / 2, h / 2, key).setDepth(1);
    }
    const source = this.textures.get(key).getSourceImage() as HTMLImageElement;
    const scale = Math.max(w / source.width, h / source.height);
    this.menuArt.setVisible(true).setPosition(w / 2, h / 2).setDisplaySize(source.width * scale, source.height * scale);
    const title = this.menuRect(96, 66, 746, 473);
    const titleSafeShift = Math.max(0, this.safeInset('top') + 8 - 96 * this.menuScale());
    this.uiImages.push(this.add.image(title.centerX, title.centerY + titleSafeShift, 'menu-title').setDepth(105)
      .setDisplaySize(title.width, title.height));
    this.drawSettingsControls();
    const main = this.menuButton(), pressedY = this.menuPressed ? 3 : 0;
    this.uiImages.push(this.add.image(main.centerX, main.centerY + pressedY, 'menu-button-gold')
      .setDepth(110).setDisplaySize(main.width, main.height));
    this.txt(main.centerX, main.centerY + pressedY - 1, 'Играть',
      Math.min(43, main.height * .6), '#3b210e', true, 'center', false);
    for (const [rect, button] of [[this.levelsButton(), 'menu-button-levels'], [this.galleryButton(), 'menu-button-gallery']] as const) {
      this.uiImages.push(this.add.image(rect.centerX, rect.centerY, button).setDepth(110)
        .setDisplaySize(rect.width, this.menuScale() * 108));
    }
  }
  private drawSettingsControls() {
    const gear = this.settingsButton();
    this.chrome.fillStyle(0x06111e, .62).fillCircle(gear.x, gear.y, 20);
    this.chrome.lineStyle(1, 0xf1cb84, .72).strokeCircle(gear.x, gear.y, 19);
    const points: Phaser.Geom.Point[] = [];
    for (let i = 0; i < 32; i++) {
      const angle = -Math.PI / 2 + i * Math.PI / 16;
      const radius = i % 4 === 0 || i % 4 === 1 ? 14 : 10;
      points.push(new Phaser.Geom.Point(gear.x + Math.cos(angle) * radius, gear.y + Math.sin(angle) * radius));
    }
    this.chrome.fillStyle(0xe7bd79, 1).fillPoints(points, true);
    this.chrome.lineStyle(1, 0xffe9bc, .9).strokePoints(points, true);
    this.chrome.fillStyle(0x102735, 1).fillCircle(gear.x, gear.y, 5);
    this.chrome.lineStyle(1, 0xffe8b1, .8).strokeCircle(gear.x, gear.y, 5);
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
    if (this.mode === 'gallery') return this.galleryGridLayout().cards
      .map(r => new Phaser.Geom.Rectangle(r.x, r.y, r.width, r.height));
    return this.levelGridLayout().cards
      .map(r => new Phaser.Geom.Rectangle(r.x, r.y, r.width, r.height));
  }
  private levelGridLayout(scroll = this.levelScrollY) {
    return levelGrid(this.viewWidth(), this.viewHeight(), LEVELS.length, scroll,
      this.safeInset('top'), this.safeInset('bottom'));
  }
  private galleryGridLayout(row = this.galleryScrollRow) {
    return galleryGrid(this.viewWidth(), this.viewHeight(), LEVELS.length, row,
      this.safeInset('top'), this.safeInset('bottom'));
  }
  private cardAt(x: number, y: number): number | null {
    if (this.mode === 'gallery') {
      const grid = this.galleryGridLayout();
      if (y < grid.top || y > grid.bottom) return null;
    } else if (this.mode === 'levels') {
      const grid = this.levelGridLayout();
      if (y < grid.top || y > grid.bottom) return null;
    }
    const index = this.cardRects().findIndex(rect => rect.contains(x, y));
    return index < 0 ? null : LEVELS[index].id;
  }
  private scrollGallery(scrollY: number) {
    const base = this.galleryGridLayout(0);
    const grid = this.galleryGridLayout(scrollY / base.rowStep);
    if (grid.scrollRow === this.galleryScrollRow) return;
    this.galleryScrollRow = grid.scrollRow;
    this.galleryLayer?.setY(-grid.scrollRow * grid.rowStep);
    this.drawGalleryScrollbar();
  }
  private scrollLevels(scroll: number) {
    const next = this.levelGridLayout(scroll).scroll;
    if (next === this.levelScrollY) return;
    this.levelScrollY = next;
    this.levelLayer?.setY(-next);
    this.drawLevelScrollbar();
  }
  private drawLevelSelect(w: number, h: number) {
    const grid = this.levelGridLayout();
    this.levelScrollY = grid.scroll;
    const safeTop = this.safeInset('top');
    this.bg.fillStyle(0x071421, .92).fillRect(0, 0, w, h);
    this.bg.fillGradientStyle(0x0b1d2c, 0x0b1d2c, 0x09131e, 0x09131e, 1)
      .fillRect(0, grid.top, w, grid.bottom - grid.top);
    const back = this.backButton();
    this.iconCircle(back.x, back.y); this.backArrow(back.x, back.y);
    this.txt(w / 2, safeTop + 32, 'Выбор уровня', Math.min(25, w * .062), '#f4e7ca', true);
    const completed = this.progress.completed.length;
    this.txt(w / 2, safeTop + 68, `Пройдено ${completed} из ${LEVELS.length}`, 14, '#c9c1b1');
    const progressWidth = Math.min(250, w - 92), progressX = (w - progressWidth) / 2;
    this.chrome.fillStyle(0x40505a, .6).fillRoundedRect(progressX, safeTop + 91, progressWidth, 3, 2);
    if (completed) this.chrome.fillStyle(0xd0a66f, .9)
      .fillRoundedRect(progressX, safeTop + 91, progressWidth * completed / LEVELS.length, 3, 2);

    const content = this.levelGridLayout(0);
    const layer = this.add.container(0, -this.levelScrollY).setDepth(20);
    this.levelLayer = layer;
    const mask = this.add.graphics();
    mask.fillStyle(0xffffff).fillRect(0, grid.top, w, grid.bottom - grid.top);
    layer.setMask(mask.createGeometryMask());
    mask.setVisible(false);
    this.levelMask = mask;
    const roman = ['I', 'II', 'III', 'IV', 'V'];
    for (const chapter of content.chapters) {
      const y = chapter.y + 17;
      const heading = this.add.text(content.left + 2, y, `ГЛАВА ${roman[chapter.index]}`, {
        fontFamily: 'Georgia, serif', fontSize: '15px', fontStyle: 'bold', color: '#e3c18b',
      }).setOrigin(0, .5).setResolution(RENDER_SCALE);
      const range = this.add.text(content.left + content.contentWidth - 2, y,
        `УРОВНИ ${chapter.first}–${chapter.last}`, {
          fontFamily: 'Arial, sans-serif', fontSize: '10px', color: '#9cabb0',
        }).setOrigin(1, .5).setResolution(RENDER_SCALE);
      layer.add([heading, range]);
      const rule = this.add.graphics();
      rule.lineStyle(1, 0xb39872, .35).lineBetween(content.left, y + 16,
        content.left + content.contentWidth, y + 16);
      layer.add(rule);
    }
    for (let index = 0; index < LEVELS.length; index++) {
      const level = LEVELS[index], r = content.cards[index];
      const unlocked = isUnlocked(this.progress, level.id);
      const done = this.progress.completed.includes(level.id);
      const current = unlocked && !done;
      const wide = index % 5 === 4;
      const g = this.add.graphics();
      g.fillStyle(0x02080f, .35).fillRoundedRect(r.x + 1, r.y + 3, r.width, r.height, 9);
      g.fillStyle(unlocked ? 0x122532 : 0x0d1b28, 1).fillRoundedRect(r.x, r.y, r.width, r.height, 8);
      g.lineStyle(current ? 1.7 : 1, current ? 0xe5c290 : done ? 0x9d876b : 0x455662,
        current ? .95 : .68).strokeRoundedRect(r.x + .5, r.y + .5, r.width - 1, r.height - 1, 8);
      layer.add(g);
      const frame: Rect = wide
        ? { x: r.x + 8, y: r.y + 8, width: r.width * .4, height: r.height - 16 }
        : { x: r.x + 8, y: r.y + 8, width: r.width - 16,
          height: r.height - (w >= 550 ? 90 : 70) };
      if (unlocked) {
        g.fillStyle(0x07131d, 1).fillRoundedRect(frame.x, frame.y, frame.width, frame.height, 4);
        const source = this.textures.get(`art-${level.id}`).getSourceImage() as HTMLImageElement;
        const fitted = fitPainting(frame, source.width, source.height);
        layer.add(this.add.image(fitted.x + fitted.width / 2, fitted.y + fitted.height / 2,
          `art-${level.id}`).setDisplaySize(fitted.width, fitted.height));
      } else {
        g.fillStyle(0x102330, 1).fillRoundedRect(frame.x, frame.y, frame.width, frame.height, 4);
        g.lineStyle(1, 0x80909a, .2).strokeRoundedRect(frame.x + 7, frame.y + 7,
          frame.width - 14, frame.height - 14, 3);
        const cx = frame.x + frame.width / 2, cy = frame.y + frame.height / 2;
        g.lineStyle(2, 0xb1a58e, .8).strokeRoundedRect(cx - 10, cy - 15, 20, 19, 10);
        g.fillStyle(0xb1a58e, .85).fillRoundedRect(cx - 14, cy - 3, 28, 23, 3);
        g.fillStyle(0x102330, 1).fillCircle(cx, cy + 6, 2.5);
      }
      g.lineStyle(1, current ? 0xe1bd88 : 0x80919a, .45)
        .strokeRoundedRect(frame.x + .5, frame.y + .5, frame.width - 1, frame.height - 1, 4);
      const tx = wide ? frame.x + frame.width + 17 : r.x + 8;
      const titleWidth = wide ? r.x + r.width - tx - 9 : r.width - 16;
      const numberY = wide ? r.y + 27 : r.y + r.height - (w >= 550 ? 73 : 55);
      const titleY = wide ? r.y + 57 : r.y + r.height - (w >= 550 ? 54 : 36);
      const label = (value: string, x: number, y: number, size: number, color: string, bold = false) => {
        const text = this.add.text(x, y, value, { fontFamily: bold ? 'Georgia, serif' : 'Arial, sans-serif',
          fontSize: `${size}px`, fontStyle: bold ? 'bold' : 'normal', color,
          wordWrap: { width: titleWidth, useAdvancedWrap: true }, lineSpacing: 1 })
          .setOrigin(0, 0).setResolution(RENDER_SCALE);
        layer.add(text);
        return text;
      };
      label(`УРОВЕНЬ ${String(level.id).padStart(2, '0')}`, tx, numberY, 10,
        current ? '#e8c38c' : '#a8b5b9', true);
      const title = label(level.title, tx, titleY, wide ? (w >= 550 ? 17 : 15) : (w >= 550 ? 15 : 12),
        unlocked ? '#f2e6ce' : '#afb9bc', true);
      if (title.height > (wide ? 58 : w >= 550 ? 37 : 31))
        title.setFontSize(wide ? 12 : w >= 550 ? 13 : 10);
      if (done) {
        const stars = starsForDisplay(this.progress.completed, this.results, level.id);
        const y = wide ? r.y + r.height - 26 : r.y + r.height - 15;
        for (let star = 0; star < 3; star++) {
          const x = (wide ? tx : r.x + r.width / 2 - 18) + star * 18;
          const points: Phaser.Geom.Point[] = [];
          for (let vertex = 0; vertex < 10; vertex++) {
            const angle = -Math.PI / 2 + vertex * Math.PI / 5;
            const radius = vertex % 2 ? 3.4 : 7;
            points.push(new Phaser.Geom.Point(x + Math.cos(angle) * radius,
              y + Math.sin(angle) * radius));
          }
          g.fillStyle(star < stars ? 0xd9af73 : 0x43525a, .95).fillPoints(points, true);
        }
      } else if (current) {
        label('ИГРАТЬ', tx, wide ? r.y + r.height - 31 : r.y + r.height - 16, 10, '#e3be88', true);
      }
    }
    this.levelScrollTrack = this.add.graphics().setDepth(125);
    this.drawLevelScrollbar();
  }
  private drawLevelScrollbar() {
    if (!this.levelScrollTrack) return;
    const grid = this.levelGridLayout();
    const bar = this.levelScrollTrack;
    bar.clear();
    if (grid.maxScroll <= 0) return;
    const trackH = grid.bottom - grid.top;
    const thumbH = Math.max(28, trackH * trackH / grid.contentHeight);
    const x = this.viewWidth() - 4;
    bar.fillStyle(0xc8ab82, .2).fillRoundedRect(x, grid.top, 2, trackH, 1);
    bar.fillStyle(0xe1bf8d, .78).fillRoundedRect(x - 1,
      grid.top + (trackH - thumbH) * grid.scroll / grid.maxScroll, 3, thumbH, 1.5);
  }
  private drawGalleryGrid(w: number) {
    const h = this.viewHeight(), desktop = w >= 900;
    const grid = this.galleryGridLayout();
    this.galleryScrollRow = grid.scrollRow;
    this.bg.fillStyle(0x071421, .92).fillRect(0, 0, w, h);
    this.bg.fillGradientStyle(0x0b1d2c, 0x0b1d2c, 0x09131e, 0x09131e, 1)
      .fillRect(0, grid.top, w, grid.bottom - grid.top);
    const back = this.backButton();
    this.iconCircle(back.x, back.y); this.backArrow(back.x, back.y);
    const safeTop = this.safeInset('top');
    this.txt(w / 2, safeTop + (desktop ? 56 : 31), 'Галерея', desktop ? 34 : Math.min(24, w * .06), '#f4e7ca', true);
    this.txt(w / 2, safeTop + (desktop ? 105 : 67),
      `Открыто ${this.progress.completed.length} из ${LEVELS.length}`, desktop ? 17 : 14, '#c9c1b1');
    this.chrome.lineStyle(1, 0xb39872, .36).lineBetween(18, grid.top - 11, w - 18, grid.top - 11);

    const content = this.galleryGridLayout(0);
    const layer = this.add.container(0, -grid.scrollRow * grid.rowStep).setDepth(20);
    this.galleryLayer = layer;
    const mask = this.add.graphics();
    mask.fillStyle(0xffffff).fillRect(0, grid.top, w, grid.bottom - grid.top);
    layer.setMask(mask.createGeometryMask()); mask.setVisible(false);
    this.galleryMask = mask;
    content.cards.forEach((r, index) => {
      const level = LEVELS[index], collected = isInGallery(this.progress, level.id);
      const g = this.add.graphics(); layer.add(g);
      g.fillStyle(0x02080f, .32).fillRoundedRect(r.x + 1, r.y + 3, r.width, r.height, 8);
      g.fillStyle(collected ? 0x122532 : 0x0d1b28, 1).fillRoundedRect(r.x, r.y, r.width, r.height, 8);
      g.lineStyle(1, collected ? 0x9d876b : 0x455662, .67)
        .strokeRoundedRect(r.x + .5, r.y + .5, r.width - 1, r.height - 1, 8);
      const frame: Rect = { x: r.x + 7, y: r.y + 7, width: r.width - 14,
        height: r.height - (desktop ? 62 : 49) };
      g.fillStyle(0x07131d, 1).fillRoundedRect(frame.x, frame.y, frame.width, frame.height, 4);
      if (collected) {
        const key = `art-${level.id}`;
        const source = this.textures.get(key).getSourceImage() as HTMLImageElement;
        const fitted = fitPainting(frame, source.width, source.height);
        layer.add(this.add.image(fitted.x + fitted.width / 2, fitted.y + fitted.height / 2,
          key).setDisplaySize(fitted.width, fitted.height));
      } else {
        const cx = frame.x + frame.width / 2, cy = frame.y + frame.height / 2;
        g.lineStyle(2, 0xb1a58e, .7).strokeRoundedRect(cx - 10, cy - 14, 20, 19, 10);
        g.fillStyle(0xb1a58e, .72).fillRoundedRect(cx - 14, cy - 2, 28, 22, 3);
        g.fillStyle(0x102330, 1).fillCircle(cx, cy + 6, 2.5);
      }
      g.lineStyle(1, collected ? 0xcab18d : 0x65747b, .5)
        .strokeRoundedRect(frame.x + .5, frame.y + .5, frame.width - 1, frame.height - 1, 4);
      const badge = this.add.text(frame.x + 7, frame.y + 7, String(level.id).padStart(2, '0'), {
        fontFamily: 'Georgia, serif', fontSize: desktop ? '13px' : '11px', fontStyle: 'bold',
        color: '#f0d19e', backgroundColor: '#071523', padding: { x: 5, y: 3 },
      }).setResolution(RENDER_SCALE);
      layer.add(badge);
      const title = this.add.text(r.x + r.width / 2, r.y + r.height - (desktop ? 46 : 36),
        collected ? level.title : 'Закрыто', { fontFamily: 'Georgia, serif',
          fontSize: desktop ? '17px' : '12px', fontStyle: 'bold', color: collected ? '#eee1c7' : '#adb8bd',
          align: 'center', wordWrap: { width: r.width - 16, useAdvancedWrap: true } })
        .setOrigin(.5, 0).setResolution(RENDER_SCALE);
      if (title.height > (desktop ? 40 : 29)) title.setFontSize(desktop ? 14 : 10);
      layer.add(title);
      if (collected) {
        const stars = starsForDisplay(this.progress.completed, this.results, level.id);
        const y = r.y + r.height - (desktop ? 16 : 11);
        for (let i = 0; i < 3; i++) {
          const x = r.x + r.width / 2 + (i - 1) * (desktop ? 21 : 16);
          const points = Array.from({ length: 10 }, (_, vertex) => {
            const angle = -Math.PI / 2 + vertex * Math.PI / 5;
            const radius = vertex % 2 ? (desktop ? 3.5 : 2.8) : (desktop ? 7 : 5.8);
            return new Phaser.Geom.Point(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius);
          });
          g.fillStyle(i < stars ? 0xd9af73 : 0x43525a, .95).fillPoints(points, true);
        }
      }
    });
    this.galleryScrollTrack = this.add.graphics().setDepth(125);
    this.drawGalleryScrollbar();
  }
  private drawGalleryScrollbar() {
    if (!this.galleryScrollTrack) return;
    const grid = this.galleryGridLayout(), bar = this.galleryScrollTrack;
    bar.clear();
    if (!grid.maxScrollRow) return;
    const trackH = grid.bottom - grid.top;
    const thumbH = Math.max(28, trackH * grid.visibleRows / (grid.maxScrollRow + grid.visibleRows));
    const x = this.viewWidth() - 5;
    bar.fillStyle(0xc8ab82, .2).fillRoundedRect(x, grid.top, 2, trackH, 1);
    bar.fillStyle(0xe1bf8d, .78).fillRoundedRect(x - 1,
      grid.top + (trackH - thumbH) * grid.scrollRow / grid.maxScrollRow, 3, thumbH, 1.5);
  }
  private drawGalleryView(w: number, h: number) {
    const level = levelById(this.viewedLevel);
    const desktop = w >= 900;
    const back = this.backButton(), close = this.galleryCloseButton();
    this.iconCircle(back.x, back.y); this.backArrow(back.x, back.y);
    this.chrome.fillStyle(0x102331, .9).fillRoundedRect(close.x, close.y, close.width, close.height, 8);
    this.chrome.lineStyle(1, 0xd2a46a, .55).strokeRoundedRect(close.x, close.y, close.width, close.height, 8);
    this.txt(close.centerX, close.centerY, 'Закрыть', desktop ? 15 : 13, '#e9dcc4', true);
    const safeTop = this.safeInset('top'), safeBottom = this.safeInset('bottom');
    this.txt(w / 2, safeTop + (desktop ? 75 : 66), `УРОВЕНЬ ${level.id}`, 11, '#d4b88e', true);
    this.fittedTitle(w / 2, safeTop + (desktop ? 111 : 89), level.title,
      desktop ? Math.min(650, w * .6) : w - 32, desktop ? 27 : 18, desktop ? 20 : 13);
    const top = safeTop + (desktop ? 145 : 110);
    const frame: Rect = { x: 12, y: top, width: w - 24,
      height: Math.max(180, h - top - safeBottom - (desktop ? 90 : 72)) };
    const fullKey = `full-art-${level.id}`;
    if (!this.textures.exists(fullKey) && !this.galleryArtLoading.has(level.id)) {
      this.galleryArtLoading.add(level.id);
      const full = new Image();
      full.onload = () => {
        this.galleryArtLoading.delete(level.id);
        if (!this.textures.exists(fullKey)) this.textures.addImage(fullKey, full);
        if (this.mode === 'view' && this.viewedLevel === level.id) this.draw();
      };
      full.onerror = () => { this.galleryArtLoading.delete(level.id); console.error(`Failed to load gallery art ${level.id}`); };
      full.src = level.art;
    }
    const key = this.textures.exists(fullKey) ? fullKey : `art-${level.id}`;
    const source = this.textures.get(key).getSourceImage() as HTMLImageElement;
    const fitted = fitPainting(frame, source.width, source.height);
    const view = this.add.image(fitted.x + fitted.width / 2, fitted.y + fitted.height / 2, key)
      .setDepth(5).setDisplaySize(fitted.width, fitted.height);
    this.uiImages.push(view);
    this.chrome.lineStyle(1, 0xd3aa70, .6).strokeRoundedRect(fitted.x - 2, fitted.y - 2,
      fitted.width + 4, fitted.height + 4, 5);
    const footerY = fitted.y + fitted.height + (desktop ? 22 : 15);
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
    const outer = strokeFrameRect(b, w, 2, 1.5);
    const inner = strokeFrameRect(b, w, 1, 3);
    this.boardG.lineStyle(1, 0xd6ad72, .62).strokeRoundedRect(outer.x, outer.y, outer.width, outer.height, 6);
    this.boardG.lineStyle(1, 0xffe0aa, .12).strokeRoundedRect(inner.x, inner.y, inner.width, inner.height, 4);
    this.guideImage?.setPosition(b.x + b.width / 2, b.y + b.height / 2).setDisplaySize(b.width, b.height);
    if (this.preview && this.previewImage) {
      const p = this.preview;
      this.boardG.fillStyle(0x081724, .7).fillRoundedRect(p.x - 4, p.y - 4, p.width + 8, p.height + 8, 7);
      this.boardG.lineStyle(1.2, 0xcda56f, .76).strokeRoundedRect(p.x - 4, p.y - 4, p.width + 8, p.height + 8, 7);
      this.previewImage.setVisible(true).setPosition(p.x + p.width / 2, p.y + p.height / 2).setDisplaySize(p.width, p.height);
    } else this.previewImage?.setVisible(false);

    const hx = this.headerCenter(), hw = this.headerWidth(), safeTop = this.safeInset('top');
    const headerH = mobile ? 58 : 72;
    // A quiet, fixed header grid: controls at the edges, level/time in the
    // upper row, and the title in its own clear row above the picture.
    this.chrome.fillStyle(0x061725, .88).fillRoundedRect(hx - hw / 2 - 2, safeTop + 1, hw + 4, headerH, 10);
    this.chrome.lineStyle(1, 0xc49457, .4).lineBetween(hx - hw / 2 + 51,
      safeTop + headerH - 3, hx + hw / 2 - 51, safeTop + headerH - 3);
    const back = this.backButton(), hint = this.hintButton();
    this.iconCircle(back.x, back.y, mobile ? 19 : 21);
    this.backArrow(back.x, back.y);
    this.drawLevelTag(hx - (mobile ? 66 : 120), safeTop + (mobile ? 17 : 22), mobile);
    this.displayedTime = formatTime(this.elapsedMs);
    this.timerText = this.txt(hx + (mobile ? 72 : 120), safeTop + (mobile ? 17 : 22),
      this.displayedTime, mobile ? 12 : 13, '#ffe1a8', true);
    this.fittedTitle(hx, safeTop + (mobile ? 39 : 48), this.level.title, hw - (mobile ? 108 : 125),
      mobile ? 17 : 22, mobile ? 13 : 16);
    const footer = gameFooterLayout(w, h, b, this.safeInset('bottom'));
    const progress = footer.progress, placed = this.pieces.filter(piece => piece.placed).length;
    this.chrome.fillStyle(0x071725, .86).fillRoundedRect(progress.x, progress.y, progress.width, progress.height, 8);
    this.chrome.lineStyle(1, 0x72848a, .42).strokeRoundedRect(progress.x + .5, progress.y + .5,
      progress.width - 1, progress.height - 1, 8);
    this.txt(progress.x + progress.width / 2, footer.y - 5, `Собрано ${placed} / ${this.level.pieces}`,
      mobile ? 14 : 15, '#eee0c2', true);
    const barX = progress.x + 13, barY = footer.y + 11, barWidth = progress.width - 26;
    this.chrome.fillStyle(0x53616a, .48).fillRoundedRect(barX, barY, barWidth, 3, 1.5);
    if (placed) this.chrome.fillStyle(0xd6ad72, .94)
      .fillRoundedRect(barX, barY, barWidth * placed / this.level.pieces, 3, 1.5);
    this.iconCircle(hint.x, hint.y, mobile ? 19 : 21);
    this.bulb(hint.x, hint.y);
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
    // The painting keeps its full established dimensions; decoration stays in the margin.
    this.boardG.fillStyle(0x020916, .5).fillRoundedRect(b.x - 4, b.y - 4, b.width + 8, b.height + 8, 6);
    this.completeImage?.setPosition(b.x + b.width / 2, b.y + b.height / 2).setDisplaySize(b.width, b.height);
    const inner = strokeFrameRect(b, w, 4, 2.5);
    const outer = strokeFrameRect(b, w, 7, 2.5);
    this.chrome.lineStyle(1, 0xd19a4b, .72).strokeRoundedRect(outer.x, outer.y, outer.width, outer.height, 6);
    this.chrome.lineStyle(.8, 0xffe8b5, .42).strokeRoundedRect(inner.x, inner.y, inner.width, inner.height, 4);
    const cx = layout.contentX;
    const title = this.fittedTitle(cx, layout.titleY,
      this.level.id === LEVELS.length ? 'Все 25 картин собраны!' : 'Пазл собран!', layout.contentWidth,
      layout.portrait ? 21 : 31, layout.portrait ? 14 : 23);
    title.setColor('#ffe8b8');
    const name = this.fittedTitle(cx, layout.nameY, this.level.title, layout.contentWidth,
      layout.portrait ? 15 : 23, layout.portrait ? 12 : 17).setColor('#f4d7a4');
    const stars = layout.portrait
      ? fitVictoryStars(name.getBounds().bottom, outer.y, layout.starsY, layout.starRadius)
      : { headingShift: 0, glowRadius: layout.starRadius * 1.12, y: layout.starsY };
    title.y -= stars.headingShift;
    name.y -= stars.headingShift;
    this.victoryStarY = stars.y;
    this.victoryGlowRadius = stars.glowRadius;
    // Muted outlines reserve all three positions. Earned gold and its glow are
    // rendered by update(), without creating objects or delaying the results.
    this.drawStars(cx, stars.y, 0, layout.starRadius, true);
    this.drawVictoryTime(cx, layout.timeY, layout.portrait, formatTime(this.completedMs));
    const next = this.nextButton();
    this.chrome.fillStyle(0xe9d5ad, .97).fillRoundedRect(next.x, next.y, next.width, next.height, 9);
    this.chrome.lineStyle(1, 0xffefd1, .82).strokeRoundedRect(next.x + .5, next.y + .5,
      next.width - 1, next.height - 1, 9);
    this.txt(next.centerX, next.centerY, this.level.id === LEVELS.length ? 'В галерею' : 'Далее',
      layout.portrait ? 20 : 23, '#30271f', true, 'center', false);
    if (!this.victoryUiLogged) {
      this.victoryUiLogged = true;
      this.logVictory('ui-drawn', { stars: starsForTime(this.level.pieces, this.completedMs),
        buttonX: next.x, buttonY: next.y, buttonWidth: next.width, buttonHeight: next.height,
        pictureBottom: b.y + b.height, resultsTop: layout.titleY,
        starY: this.victoryStarY, glowRadius: this.victoryGlowRadius });
    }
  }
  private drawVictoryTime(x: number, y: number, portrait: boolean, value: string) {
    const width = portrait ? 164 : 236;
    const height = portrait ? 25 : 37;
    this.chrome.fillStyle(0x06131f, .86).fillRoundedRect(x - width / 2, y - height / 2, width, height, height / 2);
    this.chrome.lineStyle(1, 0xd5a15a, .86).strokeRoundedRect(
      x - width / 2, y - height / 2, width, height, height / 2);
    const clockX = x - width / 2 + (portrait ? 21 : 28);
    const radius = portrait ? 6 : 8;
    this.chrome.lineStyle(1.3, 0xffdd9b, .96).strokeCircle(clockX, y, radius);
    this.chrome.lineStyle(1.2, 0xffdd9b, .96).lineBetween(clockX, y, clockX, y - radius * .52);
    this.chrome.lineBetween(clockX, y, clockX + radius * .43, y + radius * .25);
    for (const side of [-1, 1]) {
      const diamondX = x + side * (width / 2 + 3);
      this.chrome.fillStyle(0xeac083, .92).fillPoints([
        new Phaser.Geom.Point(diamondX, y - 3), new Phaser.Geom.Point(diamondX + 3, y),
        new Phaser.Geom.Point(diamondX, y + 3), new Phaser.Geom.Point(diamondX - 3, y)], true);
    }
    this.txt(x + (portrait ? 12 : 16), y, `Время ${value}`,
      portrait ? 14 : 20, '#ffe3ad', true);
  }
  private drawVictoryAward() {
    const layout = this.victoryScreenLayout();
    const earned = starsForTime(this.level.pieces, this.completedMs);
    const elapsed = this.victoryAwardStartedAt ? performance.now() - this.victoryAwardStartedAt : Infinity;
    for (let star = 0; star < earned; star++) {
      const progress = victoryAwardProgress(elapsed, star, reducedMotion.matches);
      if (progress <= 0) continue;
      const x = layout.contentX + (star - 1) * layout.starRadius * 2.6;
      const y = this.victoryStarY;
      const radius = layout.starRadius * (.82 + .18 * progress);
      const wave = progress < 1 ? Math.sin(Math.PI * progress) : 0;
      this.fx.fillStyle(0xffd578, .05 * progress + .13 * wave)
        .fillCircle(x, y, this.victoryGlowRadius);
      const points = Array.from({ length: 10 }, (_, i) => new Phaser.Geom.Point(
        x + Math.cos(-Math.PI / 2 + i * Math.PI / 5) * (i % 2 ? radius * .45 : radius),
        y + Math.sin(-Math.PI / 2 + i * Math.PI / 5) * (i % 2 ? radius * .45 : radius)));
      this.fx.fillStyle(0xffd578, progress).fillPoints(points, true);
      // A few warm facets give the earned stars depth without extra sprites or
      // particles; the existing sequential reveal still controls visibility.
      for (let tip = 0; tip < 5; tip++) {
        const outer = points[tip * 2], left = points[(tip * 2 + 9) % 10], right = points[tip * 2 + 1];
        this.fx.fillStyle(0xffecae, progress * .7).fillTriangle(x, y, outer.x, outer.y, left.x, left.y);
        this.fx.fillStyle(0xe5a73f, progress * .55).fillTriangle(x, y, right.x, right.y, outer.x, outer.y);
      }
      this.fx.lineStyle(1.3, 0xffe4a4, progress).strokePoints(points, true);
    }
  }
  private drawLevelTag(x: number, y: number, mobile: boolean) {
    return this.txt(x, y, `УРОВЕНЬ ${this.level.id}`,
      mobile ? 12 : 13, '#e7bf7e', true, 'center', true, 'MysticLevelSerif, Georgia, serif');
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
  private txt(x: number, y: number, value: string, size: number, color: string, bold = false, align: 'center' | 'left' = 'center', shadow = true, fontFamily = 'Georgia, serif'): Phaser.GameObjects.Text {
    return this.add.text(x, y, value, { fontFamily, fontSize: `${size}px`, color, fontStyle: bold ? 'bold' : 'normal', align, shadow: shadow ? { color: '#05070c', blur: 6, fill: true, offsetY: 2 } : undefined }).setOrigin(align === 'left' ? 0 : .5, .5).setDepth(200).setResolution(RENDER_SCALE).setData('uiText', true);
  }
  private ensureWholeTexture() {
    if (this.textures.exists('whole-picture')) return;
    const canvas = document.createElement('canvas'); canvas.width = this.raster.width; canvas.height = this.raster.height;
    canvas.getContext('2d')!.drawImage(this.art, 0, 0, canvas.width, canvas.height);
    this.textures.addCanvas('whole-picture', canvas);
  }
}

async function bootGame() {
  // Initialize before progress is read so the SDK can install its reliable
  // localStorage wrapper for ZIP-hosted games. A failed SDK still allows play.
  await yandexGames.initialize();
  const game = new Phaser.Game({
    type: Phaser.AUTO, parent: 'game', backgroundColor: '#071326', antialias: true,
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH,
      width: Math.round(Math.min(window.innerWidth, window.innerHeight * 9 / 16) * RENDER_SCALE),
      height: Math.round(window.innerHeight * RENDER_SCALE) },
    input: { activePointers: 1, smoothFactor: 0 }, render: { pixelArt: false, roundPixels: false }, scene: [PuzzleScene],
  });

  function resizeGame() {
    game.scale.setGameSize(Math.round(Math.min(window.innerWidth, window.innerHeight * 9 / 16) * RENDER_SCALE),
      Math.round(window.innerHeight * RENDER_SCALE));
    game.scale.refresh();
  }
  window.addEventListener('resize', resizeGame);
  if (import.meta.env.DEV) Object.assign(window, { __mysticGame: game });
}
void bootGame();
