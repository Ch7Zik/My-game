import Phaser from 'phaser';
import { createRegions, seeded, type PieceRegion, type Point } from './geometry';
import { canAdvance, canDrag, isComplete, shouldSnap } from './puzzleRules';
import './style.css';

type Piece = { id: number; sprite: Phaser.GameObjects.Image; region: PieceRegion; placed: boolean; home: Point; hint: Point; start: Point; hit: Uint8Array };
const ART = '/assets/moonlit-cottage.png';

class PuzzleScene extends Phaser.Scene {
  private art!: HTMLImageElement;
  private pieces: Piece[] = [];
  private mode: 'menu' | 'game' | 'complete' | 'soon' = 'menu';
  private dragging: Piece | null = null;
  private pointerOffset: Point = { x: 0, y: 0 };
  private board = { x: 0, y: 0, width: 0, height: 0 };
  private completeAmount = 0;
  private hintPiece: Piece | null = null;
  private hintUntil = 0;
  private artLoaded = false;
  private bg!: Phaser.GameObjects.Graphics;
  private fx!: Phaser.GameObjects.Graphics;
  private ui!: Phaser.GameObjects.Graphics;
  private menuArt: Phaser.GameObjects.Image | null = null;
  private guideImage: Phaser.GameObjects.Image | null = null;
  private completeImage: Phaser.GameObjects.Image | null = null;

  constructor() { super('puzzle'); }

  preload() { this.load.image('moonlit', ART); }

  create() {
    this.art = new Image(); this.art.src = ART;
    this.art.onload = () => { this.artLoaded = true; if (this.mode === 'game') this.preparePieces(); this.draw(); };
    this.bg = this.add.graphics().setDepth(0); this.fx = this.add.graphics().setDepth(150); this.ui = this.add.graphics().setDepth(2);
    this.scale.on('resize', () => this.draw());
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => this.pointerDown(p));
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => this.pointerMove(p));
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => this.pointerUp(p));
    this.input.on('pointerupoutside', (p: Phaser.Input.Pointer) => this.pointerUp(p));
    this.draw();
  }

  private layout() {
    const w = this.scale.width, h = this.scale.height;
    if (this.mode === 'game' || this.mode === 'complete') {
      const bw = Math.min(w - 34, h * 0.455, 500);
      const bh = bw / 0.76;
      const top = h < 700 ? 84 : 104;
      const room = h - top - (this.mode === 'complete' ? 148 : 110);
      this.board = { x: (w - bw) / 2, y: top + Math.max(0, (room - bh) / 2), width: bw, height: bh };
      if (this.board.height > room) { this.board.height = room; this.board.width = room * 0.76; this.board.x = (w - this.board.width) / 2; }
    }
  }

  private preparePieces() {
    if (!this.artLoaded || this.pieces.length) return;
    this.layout();
    const { width, height } = this.board;
    const dpr = 2;
    const cw = Math.max(2, Math.round(width * dpr)), ch = Math.max(2, Math.round(height * dpr));
    this.ensureWholeTexture(cw, ch);
    this.guideImage = this.add.image(this.board.x + width / 2, this.board.y + height / 2, 'whole-picture').setDepth(1).setDisplaySize(width, height).setAlpha(0.44);
    const source = document.createElement('canvas'); source.width = cw; source.height = ch;
    const sctx = source.getContext('2d')!;
    const sourceAspect = this.art.naturalWidth / this.art.naturalHeight, boardAspect = cw / ch;
    let sx = 0, sy = 0, sw = this.art.naturalWidth, sh = this.art.naturalHeight;
    if (sourceAspect > boardAspect) { sw = this.art.naturalHeight * boardAspect; sx = (this.art.naturalWidth - sw) / 2; }
    else { sh = this.art.naturalWidth / boardAspect; sy = (this.art.naturalHeight - sh) / 2; }
    sctx.drawImage(this.art, sx, sy, sw, sh, 0, 0, cw, ch);
    const { labels, regions } = createRegions(cw, ch, 2, 4, 713);
    const imageData = sctx.getImageData(0, 0, cw, ch);
    const sourcePixels = imageData.data;
    const scatteredSlots = [4, 7, 1, 6, 0, 3, 5, 2];
    const rand = seeded(3901);
    regions.forEach((region, id) => {
      const canvas = document.createElement('canvas'); canvas.width = cw; canvas.height = ch;
      const ctx = canvas.getContext('2d')!;
      const pixels = ctx.createImageData(cw, ch);
      for (let p = 0; p < labels.length; p++) if (labels[p] === id) {
        const q = p * 4; pixels.data[q] = sourcePixels[q]; pixels.data[q + 1] = sourcePixels[q + 1]; pixels.data[q + 2] = sourcePixels[q + 2]; pixels.data[q + 3] = 255;
      }
      ctx.putImageData(pixels, 0, 0);
      const textureKey = `piece-${id}`;
      this.textures.addCanvas(textureKey, canvas);
      const slot = scatteredSlots[id], col = slot % 2, row = Math.floor(slot / 2);
      const slotX = width * (col + 0.5) / 2, slotY = height * (row + 0.5) / 4;
      const jitterX = (rand() - 0.5) * width * 0.05, jitterY = (rand() - 0.5) * height * 0.035;
      // Keep original coordinates in each texture: pieces share one home anchor,
      // so dropping them there reconstructs the source exactly.
      const home = { x: this.board.x + width / 2, y: this.board.y + height / 2 };
      const regionOffsetX = region.center.x / dpr - width / 2;
      const regionOffsetY = region.center.y / dpr - height / 2;
      const hint = { x: home.x + regionOffsetX, y: home.y + regionOffsetY };
      const start = {
        x: Phaser.Math.Clamp(this.board.x + slotX + jitterX - regionOffsetX, this.board.x + width / 2 - region.bounds.x / dpr, this.board.x + width / 2 + width - (region.bounds.x + region.bounds.width) / dpr),
        y: Phaser.Math.Clamp(this.board.y + slotY + jitterY - regionOffsetY, this.board.y + height / 2 - region.bounds.y / dpr, this.board.y + height / 2 + height - (region.bounds.y + region.bounds.height) / dpr),
      };
      const hit = new Uint8Array(cw * ch);
      for (let p = 0; p < labels.length; p++) hit[p] = labels[p] === id ? 1 : 0;
      const sprite = this.add.image(start.x, start.y, textureKey).setDepth(id + 3).setDisplaySize(width, height).setInteractive({ useHandCursor: true });
      sprite.setOrigin(0.5, 0.5);
      sprite.input!.hitArea = { width: cw, height: ch };
      sprite.input!.hitAreaCallback = (_area: { width: number; height: number }, lx: number, ly: number) => {
        const px = Math.floor((lx + width / 2) / width * cw), py = Math.floor((ly + height / 2) / height * ch);
        return px >= 0 && py >= 0 && px < cw && py < ch && hit[py * cw + px] === 1;
      };
      this.pieces.push({ id, sprite, region, placed: false, home, hint, start, hit });
    });
    this.mode = 'game';
    this.persistProgress();
    this.draw();
  }

  private pointerDown(pointer: Phaser.Input.Pointer) {
    if (this.mode === 'menu') { if (pointer.y > this.scale.height * 0.62 && pointer.y < this.scale.height * 0.86) this.startGame(); return; }
    if (this.mode === 'soon') { this.mode = 'menu'; this.draw(); return; }
    if (this.mode === 'complete') { if (canAdvance(true, this.nextButton().contains(pointer.x, pointer.y))) { this.mode = 'soon'; this.draw(); } return; }
    const header = this.headerRect();
    if (pointer.y < 72 && pointer.x >= header.x && pointer.x < header.x + 78) { this.mode = 'menu'; this.removePieces(); this.draw(); return; }
    if (pointer.y < 82 && pointer.x > header.x + header.width - 80 && pointer.x < header.x + header.width) { this.showHint(); return; }
    const x = pointer.x, y = pointer.y;
    const hit = [...this.pieces].reverse().find(piece => canDrag(piece.placed) && this.pieceContains(piece, x, y));
    if (!hit) return;
    this.dragging = hit; hit.sprite.setDepth(100); hit.sprite.setScale(1.025); hit.sprite.setAlpha(1);
    hit.sprite.setTint(0xffefbd);
    this.pointerOffset = { x: hit.sprite.x - x, y: hit.sprite.y - y };
    this.draw();
  }

  private pointerMove(pointer: Phaser.Input.Pointer) {
    if (!this.dragging) return;
    const piece = this.dragging;
    const halfW = this.board.width * 0.44, halfH = this.board.height * 0.44;
    piece.sprite.x = Phaser.Math.Clamp(pointer.x + this.pointerOffset.x, this.board.x + this.board.width / 2 - halfW, this.board.x + this.board.width / 2 + halfW);
    piece.sprite.y = Phaser.Math.Clamp(pointer.y + this.pointerOffset.y, this.board.y + this.board.height / 2 - halfH, this.board.y + this.board.height / 2 + halfH);
    this.draw();
  }

  private pointerUp(_pointer: Phaser.Input.Pointer) {
    if (!this.dragging) return;
    const piece = this.dragging; this.dragging = null;
    piece.sprite.clearTint(); piece.sprite.setScale(1); piece.sprite.setDepth(piece.id + 3);
    if (shouldSnap({ x: piece.sprite.x, y: piece.sprite.y }, piece.home, Math.max(25, this.board.width * 0.105))) {
      piece.placed = true;
      this.persistProgress();
      this.tweens.add({ targets: piece.sprite, x: piece.home.x, y: piece.home.y, duration: 270, ease: 'Back.Out', onComplete: () => {
        this.playChime(); this.completeAmount = this.pieces.filter(p => p.placed).length;
        if (isComplete(this.pieces.map(p => p.placed))) this.finish();
        this.draw();
      } });
    } else { this.draw(); }
  }

  private pieceContains(piece: Piece, x: number, y: number) {
    const cw = Math.round(this.board.width * 2), ch = Math.round(this.board.height * 2);
    const px = Math.floor((x - piece.sprite.x + this.board.width / 2) / this.board.width * cw);
    const py = Math.floor((y - piece.sprite.y + this.board.height / 2) / this.board.height * ch);
    return px >= 0 && py >= 0 && px < cw && py < ch && piece.hit[py * cw + px] === 1;
  }

  private showHint() {
    const piece = this.pieces.find(p => !p.placed); if (!piece) return;
    this.hintPiece = piece; this.hintUntil = this.time.now + 1550;
    this.tweens.add({ targets: piece.sprite, alpha: 0.65, yoyo: true, repeat: 3, duration: 185, onComplete: () => piece.sprite.setAlpha(1) });
    this.draw();
  }

  private finish() {
    this.mode = 'complete';
    this.layout();
    // Replace all cutout textures with one exact copy of the source art.
    this.pieces.forEach(p => p.sprite.destroy()); this.pieces = [];
    this.guideImage?.destroy(); this.guideImage = null;
    this.completeImage = this.add.image(this.board.x + this.board.width / 2, this.board.y + this.board.height / 2, 'whole-picture').setDepth(3).setDisplaySize(this.board.width, this.board.height).setAlpha(0);
    this.tweens.add({ targets: this.completeImage, alpha: 1, duration: 750, ease: 'Sine.Out' });
    localStorage.setItem('mystic-puzzles-complete', 'true');
    this.cameras.main.flash(300, 255, 220, 143, false);
    this.draw();
  }

  private playChime() {
    try {
      const Audio = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Audio) return;
      const ctx = new Audio(); const osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.type = 'sine'; osc.frequency.setValueAtTime(660, ctx.currentTime); osc.frequency.exponentialRampToValueAtTime(990, ctx.currentTime + 0.16);
      gain.gain.setValueAtTime(0.0001, ctx.currentTime); gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.02); gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.5);
      osc.connect(gain); gain.connect(ctx.destination); osc.start(); osc.stop(ctx.currentTime + 0.5); osc.onended = () => void ctx.close();
    } catch { /* Audio is optional and may be disabled by the browser. */ }
  }

  private startGame() { this.menuArt?.destroy(); this.menuArt = null; this.mode = 'game'; this.layout(); this.preparePieces(); this.draw(); }
  private removePieces() { this.pieces.forEach(p => p.sprite.destroy()); this.pieces = []; this.guideImage?.destroy(); this.guideImage = null; this.completeImage = null; this.children.list.filter(c => c instanceof Phaser.GameObjects.Image && c.texture.key === 'whole-picture').forEach(c => c.destroy()); }
  private persistProgress() { localStorage.setItem('mystic-puzzles-progress', JSON.stringify({ level: 1, placed: this.pieces.filter(p => p.placed).map(p => p.id) })); }
  private nextButton() { return new Phaser.Geom.Rectangle(this.scale.width * 0.16, this.scale.height - 76, this.scale.width * 0.68, 54); }
  private headerRect() { const width = Math.min(this.scale.width - 24, this.board.width + 10 || 520); return { x: (this.scale.width - width) / 2, width }; }

  update() {
    if (this.mode === 'game' && this.hintPiece && this.time.now < this.hintUntil) {
      this.fx.clear(); this.fx.lineStyle(3, 0xffd578, 0.85); this.fx.strokeCircle(this.hintPiece.hint.x, this.hintPiece.hint.y, 25 + Math.sin(this.time.now / 120) * 4);
    } else this.fx.clear();
  }

  private draw() {
    if (!this.bg) return;
    const w = this.scale.width, h = this.scale.height;
    this.layout(); this.bg.clear(); this.ui.clear();
    this.children.list.filter(c => c.getData('uiText')).forEach(c => c.destroy());
    this.bg.fillGradientStyle(0x071326, 0x071326, 0x102b43, 0x102b43, 1); this.bg.fillRect(0, 0, w, h);
    this.drawStars(w, h);
    if (this.mode === 'menu') this.drawMenu(w, h);
    else if (this.mode === 'soon') this.drawSoon(w, h);
    else this.drawGame(w, h);
  }

  private drawStars(w: number, h: number) {
    this.bg.fillStyle(0xf8ce81, 0.36);
    for (let i = 0; i < 45; i++) { const x = (i * 83 + 29) % w, y = (i * 137 + 11) % h; this.bg.fillCircle(x, y, i % 5 === 0 ? 1.5 : 0.8); }
  }

  private drawMenu(w: number, h: number) {
    if (this.artLoaded) {
      if (!this.menuArt || !this.menuArt.active) this.menuArt = this.add.image(w / 2, h * 0.43, 'moonlit').setDepth(1);
      const artHeight = Math.min(h * 0.83, 780);
      const artWidth = artHeight * this.art.naturalWidth / this.art.naturalHeight;
      this.menuArt.setVisible(true).setPosition(w / 2, h * 0.43).setDisplaySize(artWidth, artHeight).setAlpha(0.82);
    }
    this.ui.fillStyle(0x06101d, 0.38); this.ui.fillRect(0, 0, w, h);
    this.txt(w / 2, h * 0.13, 'МИСТИЧЕСКИЕ', Math.min(34, w * 0.088), '#f5dfb3', true);
    this.txt(w / 2, h * 0.19, 'ПАЗЛЫ', Math.min(52, w * 0.14), '#ffd27b', true);
    this.txt(w / 2, h * 0.55, 'Собери волшебную картину', 17, '#f5e8d0');
    this.button(w / 2, h * 0.72, Math.min(270, w * 0.74), 58, 'Играть', true);
    this.txt(w / 2, h * 0.82, 'Спокойная история у озера', 13, '#d8d2c8');
  }

  private drawGame(w: number, h: number) {
    this.layout();
    this.menuArt?.setVisible(false);
    if (this.mode === 'game' && this.guideImage) this.guideImage.setPosition(this.board.x + this.board.width / 2, this.board.y + this.board.height / 2).setDisplaySize(this.board.width, this.board.height);
    const header = this.headerRect();
    this.ui.fillStyle(0x142c42, 0.92); this.ui.fillRoundedRect(header.x, 8, header.width, 64, 18);
    this.txt(header.x + 42, 39, '‹', 36, '#ffe0a0', true);
    this.txt(w / 2, 24, 'УРОВЕНЬ 1', 15, '#f8e5bf', true);
    const stars = this.completeAmount >= 8 ? '★ ★ ★' : this.completeAmount >= 4 ? '★ ★ ☆' : this.completeAmount > 0 ? '★ ☆ ☆' : '☆ ☆ ☆';
    this.txt(w / 2, 49, stars, 18, '#ffc95e');
    this.txt(header.x + header.width - 42, 38, '✦', 27, '#ffe08a', true);
    if (this.artLoaded && this.board.width > 0) {
      this.ui.fillStyle(0x030a13, 0.62); this.ui.fillRoundedRect(this.board.x - 5, this.board.y - 5, this.board.width + 10, this.board.height + 10, 20);
      this.ui.lineStyle(1.5, 0xc99753, 0.82); this.ui.strokeRoundedRect(this.board.x - 5, this.board.y - 5, this.board.width + 10, this.board.height + 10, 20);
      if (this.mode === 'game') {
        this.ui.fillStyle(0x091522, 0.34); this.ui.fillRoundedRect(this.board.x, this.board.y, this.board.width, this.board.height, 14);
      }
    }
    if (this.mode === 'complete') {
      this.completeImage?.setPosition(this.board.x + this.board.width / 2, this.board.y + this.board.height / 2).setDisplaySize(this.board.width, this.board.height);
      this.txt(w / 2, this.board.y + this.board.height + 24, 'Картина ожила ✨', 17, '#ffe6b1', true);
      this.txt(w / 2, this.board.y + this.board.height + 48, 'Пусть этот вечер останется с тобой', 12, '#d7d1c6');
      this.button(w / 2, h - 48, Math.min(310, w * 0.72), 52, 'Следующий уровень', true);
    } else {
      const count = this.pieces.filter(p => p.placed).length;
      this.txt(w / 2, this.board.y + this.board.height + 28, `${count} / 8 собрано`, 14, '#ead6ad');
      this.txt(w / 2, h - 30, 'Перетаскивай фрагменты на их место', 13, '#e2d6c3');
    }
  }

  private drawSoon(w: number, h: number) {
    this.txt(w / 2, h * 0.35, 'Новые картины', 28, '#f6dcaa', true);
    this.txt(w / 2, h * 0.42, 'скоро появятся здесь', 18, '#e6d8c1');
    this.button(w / 2, h * 0.7, w * 0.7, 54, 'В главное меню', false);
  }

  private button(x: number, y: number, w: number, h: number, label: string, green: boolean) {
    const color = green ? 0x32683e : 0x53351f;
    this.ui.fillStyle(0x100d0a, 0.55); this.ui.fillRoundedRect(x - w / 2, y - h / 2 + 3, w, h, h / 2);
    this.ui.fillStyle(0xd6a652, 1); this.ui.fillRoundedRect(x - w / 2, y - h / 2, w, h, h / 2);
    this.ui.fillStyle(color, 1); this.ui.fillRoundedRect(x - w / 2 + 3, y - h / 2 + 3, w - 6, h - 6, h / 2);
    this.ui.lineStyle(1, 0xffe3a3, 0.74); this.ui.strokeRoundedRect(x - w / 2 + 6, y - h / 2 + 6, w - 12, h - 12, h / 2);
    this.txt(x, y, label, Math.min(19, h * 0.35), '#fff4da', true);
  }

  private txt(x: number, y: number, text: string, size: number, color: string, bold = false) {
    this.add.text(x, y, text, { fontFamily: 'Georgia, serif', fontSize: `${size}px`, color, fontStyle: bold ? 'bold' : 'normal', align: 'center', shadow: { color: '#000000', blur: 5, fill: true, offsetY: 2 } }).setOrigin(0.5).setDepth(200).setData('uiText', true);
  }

  private ensureWholeTexture(cw: number, ch: number) {
    if (this.textures.exists('whole-picture')) return;
    const canvas = document.createElement('canvas'); canvas.width = cw; canvas.height = ch;
    const ctx = canvas.getContext('2d')!;
    const aspect = this.art.naturalWidth / this.art.naturalHeight, target = cw / ch;
    let sx = 0, sy = 0, sw = this.art.naturalWidth, sh = this.art.naturalHeight;
    if (aspect > target) { sw = this.art.naturalHeight * target; sx = (this.art.naturalWidth - sw) / 2; }
    else { sh = this.art.naturalWidth / target; sy = (this.art.naturalHeight - sh) / 2; }
    ctx.drawImage(this.art, sx, sy, sw, sh, 0, 0, cw, ch);
    this.textures.addCanvas('whole-picture', canvas);
  }
}

new Phaser.Game({
  type: Phaser.AUTO, parent: 'game', backgroundColor: '#071326', antialias: true,
  scale: { mode: Phaser.Scale.RESIZE, autoCenter: Phaser.Scale.CENTER_BOTH, width: window.innerWidth, height: window.innerHeight },
  input: { activePointers: 1, smoothFactor: 0 }, render: { pixelArt: false, roundPixels: false },
  scene: [PuzzleScene],
});
