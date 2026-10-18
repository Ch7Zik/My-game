import { assetUrl } from './assetUrl';
import { restoreAudioSettings, saveAudioSettings, type AudioSettings, type AudioStorage } from './audioSettings';
import { MusicPlaylist } from './music';

type Effect = 'pick' | 'place' | 'complete' | 'button';
const FILES: Record<Effect, string> = {
  pick: 'piece-pick', place: 'mixkit-modern-click-box-check-1120',
  complete: 'mixkit-winning-chimes-2015', button: 'button',
};
const VOLUMES: Record<Effect, number> = { pick: .19, place: .7, complete: .25, button: .16 };

/** Persistent music player plus one gesture-unlocked Web Audio context for effects. */
export class PuzzleAudio {
  settings: AudioSettings;
  private music: MusicPlaylist;
  private context: AudioContext | null = null;
  private buffers = new Map<Effect, AudioBuffer>();
  private pending = new Map<Effect, Promise<AudioBuffer | null>>();
  private unlocked = false;
  private disposed = false;
  private lastPlace = 0;

  constructor(private storage: AudioStorage) {
    this.settings = restoreAudioSettings(storage);
    this.music = new MusicPlaylist(this.settings.music);
    document.addEventListener('visibilitychange', this.visibilityChanged);
  }

  private visibilityChanged = () => {
    this.music.setHidden(document.hidden);
    if (!this.context) return;
    if (document.hidden) void this.context.suspend().catch(() => {});
    else if (this.unlocked) void this.context.resume().catch(() => {});
  };

  /** Must be called from a real pointer event; browsers may reject other calls. */
  unlock() {
    if (this.disposed || document.hidden) return;
    this.music.unlock();
    try {
      if (!this.context) {
        const Constructor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Constructor) return;
        this.context = new Constructor();
      }
      if (!this.unlocked) {
        this.unlocked = true;
        for (const effect of ['button', 'pick', 'place', 'complete'] as const) void this.load(effect);
      }
      void this.context.resume().catch(() => {});
    } catch { /* The game stays playable without effects. */ }
  }

  setMusic(enabled: boolean) {
    this.settings.music = enabled; saveAudioSettings(this.storage, this.settings);
    this.music.setEnabled(enabled);
  }
  setEffects(enabled: boolean) {
    this.settings.effects = enabled; saveAudioSettings(this.storage, this.settings);
  }

  play(effect: Effect) {
    if (!this.settings.effects || !this.unlocked || !this.context || document.hidden) return;
    const context = this.context;
    void this.load(effect).then(buffer => {
      if (!buffer || !this.settings.effects || document.hidden || context.state !== 'running') return;
      if (effect === 'place') {
        const now = performance.now();
        if (now - this.lastPlace < 100) return;
        this.lastPlace = now;
      }
      const source = context.createBufferSource(), gain = context.createGain();
      source.buffer = buffer; gain.gain.value = VOLUMES[effect];
      source.connect(gain); gain.connect(context.destination); source.start();
      if (effect === 'complete') this.music.duckFor(buffer.duration);
      source.onended = () => { source.disconnect(); gain.disconnect(); };
    });
  }

  private load(sound: Effect): Promise<AudioBuffer | null> {
    if (this.buffers.has(sound)) return Promise.resolve(this.buffers.get(sound)!);
    if (this.pending.has(sound)) return this.pending.get(sound)!;
    if (!this.context) return Promise.resolve(null);
    const context = this.context;
    const ogg = new Audio().canPlayType('audio/ogg; codecs="vorbis"') !== '';
    const formats = ogg ? ['ogg', 'm4a'] : ['m4a', 'ogg'];
    const decode = async (index: number): Promise<AudioBuffer> => {
      const response = await fetch(assetUrl(`audio/${FILES[sound]}.${formats[index]}`));
      if (!response.ok) throw new Error(`Audio ${response.status}`);
      try { return await context.decodeAudioData(await response.arrayBuffer()); }
      catch (error) { if (index === 0) return decode(1); throw error; }
    };
    const promise = decode(0).then(buffer => { this.buffers.set(sound, buffer); return buffer; })
      .catch(error => { console.warn(`Audio unavailable: ${sound}`, error); return null; });
    this.pending.set(sound, promise);
    return promise;
  }

  dispose() {
    this.disposed = true; document.removeEventListener('visibilitychange', this.visibilityChanged);
    this.music.dispose(); void this.context?.close(); this.context = null;
  }
}
