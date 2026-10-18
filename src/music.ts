import { assetUrl } from './assetUrl.ts';

export const MUSIC_TRACKS = [
  { file: '01-whispers-of-the-eldertree.mp3', gain: 1 },
  { file: '02-crystal-veil.mp3', gain: 1 },
  { file: '03-scepter-of-shadows.mp3', gain: .73 },
  { file: '04-realm-of-emberlight.mp3', gain: .45 },
  { file: '05-enchanted-labyrinth.mp3', gain: .40 },
  { file: '06-starsong-prophecy.mp3', gain: .50 },
] as const;

export function nextTrackIndex(index: number): number { return (index + 1) % MUSIC_TRACKS.length; }

const MUSIC_VOLUME = .55;
const FADE_SECONDS = 2.5;

/** A single media element keeps its position across game scenes and decodes one track at a time. */
export class MusicPlaylist {
  private player: HTMLAudioElement | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private prefetch: AbortController | null = null;
  private unlocked = false;
  private hidden = document.hidden;
  private playPending = false;
  private playToken = 0;
  private duckStart = 0;
  private duckEnd = 0;
  private disposed = false;
  private enabled: boolean;
  trackIndex = 0;
  starts = 0;

  constructor(enabled: boolean) { this.enabled = enabled; }

  /** Call synchronously from a trusted pointer event for iOS Safari. */
  unlock() { this.unlocked = true; this.resume(); }
  setEnabled(enabled: boolean) { this.enabled = enabled; if (enabled) this.resume(); else this.pause(); }
  setHidden(hidden: boolean) { this.hidden = hidden; if (hidden) this.pause(); else this.resume(); }

  duckFor(seconds: number) {
    this.duckStart = performance.now();
    this.duckEnd = this.duckStart + seconds * 1000;
    this.updateVolume();
  }

  private ensurePlayer(): HTMLAudioElement {
    if (this.player) return this.player;
    const player = new Audio(assetUrl(`audio/${MUSIC_TRACKS[this.trackIndex].file}`));
    player.preload = 'auto';
    player.addEventListener('ended', this.advance);
    this.player = player;
    return player;
  }

  private resume() {
    if (this.disposed || !this.enabled || !this.unlocked || this.hidden) return;
    const player = this.ensurePlayer();
    this.updateVolume();
    this.startTick();
    if (!player.paused || this.playPending) return;
    this.playPending = true;
    const token = ++this.playToken;
    // Do not defer play(): iOS requires it to run in the original pointer event.
    void player.play().then(() => {
      if (token !== this.playToken) return;
      this.starts++;
      this.prefetchNext();
    }).catch(() => { /* Another user gesture can retry an autoplay rejection. */ })
      .finally(() => { if (token === this.playToken) this.playPending = false; });
  }

  private pause() {
    this.playToken++;
    this.playPending = false;
    this.player?.pause();
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private advance = () => {
    if (!this.player || this.disposed) return;
    this.playToken++;
    this.playPending = false;
    this.trackIndex = nextTrackIndex(this.trackIndex);
    this.prefetch?.abort();
    this.prefetch = null;
    this.player.src = assetUrl(`audio/${MUSIC_TRACKS[this.trackIndex].file}`);
    this.player.load();
    this.resume();
  };

  private prefetchNext() {
    this.prefetch?.abort();
    this.prefetch = new AbortController();
    const next = MUSIC_TRACKS[nextTrackIndex(this.trackIndex)].file;
    void fetch(assetUrl(`audio/${next}`), { cache: 'force-cache', signal: this.prefetch.signal })
      .then(response => { if (response.ok) return response.arrayBuffer(); })
      .catch(() => { /* Prefetch is optional; the media element can fetch the next track. */ });
  }

  private startTick() { if (!this.timer) this.timer = setInterval(() => this.updateVolume(), 50); }
  private updateVolume() {
    if (!this.player) return;
    const player = this.player;
    const beginning = Math.min(1, player.currentTime / FADE_SECONDS);
    const ending = Number.isFinite(player.duration) ? Math.min(1, Math.max(0, (player.duration - player.currentTime) / FADE_SECONDS)) : 1;
    const now = performance.now();
    const duck = now < this.duckStart + 150 ? 1 - .6 * Math.max(0, (now - this.duckStart) / 150)
      : now < this.duckEnd ? .4
        : now < this.duckEnd + 800 ? .4 + .6 * (now - this.duckEnd) / 800 : 1;
    player.volume = Math.max(0, Math.min(1, MUSIC_VOLUME * MUSIC_TRACKS[this.trackIndex].gain * beginning * ending * duck));
  }

  dispose() {
    this.disposed = true;
    this.pause();
    this.prefetch?.abort();
    this.player?.removeEventListener('ended', this.advance);
    this.player?.removeAttribute('src');
    this.player?.load();
    this.player = null;
  }
}
