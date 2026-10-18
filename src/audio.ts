import { assetUrl } from './assetUrl';
import { restoreAudioSettings, saveAudioSettings, type AudioSettings, type AudioStorage } from './audioSettings';

type Effect = 'pick' | 'place' | 'complete' | 'button';
type Sound = Effect | 'music';
const FILES: Record<Sound, string> = {
  pick: 'piece-pick', place: 'piece-place', complete: 'picture-complete',
  button: 'button', music: 'moonlit-forest',
};
const VOLUMES: Record<Effect, number> = { pick: .19, place: .43, complete: .34, button: .16 };

/** One user-unlocked Web Audio context and one loop source for the entire game. */
export class PuzzleAudio {
  settings: AudioSettings;
  private context: AudioContext | null = null;
  private buffers = new Map<Sound, AudioBuffer>();
  private pending = new Map<Sound, Promise<AudioBuffer | null>>();
  private musicSource: AudioBufferSourceNode | null = null;
  private unlocked = false;
  private disposed = false;
  musicStarts = 0;

  constructor(private storage: AudioStorage) {
    this.settings = restoreAudioSettings(storage);
    document.addEventListener('visibilitychange', this.visibilityChanged);
  }

  private visibilityChanged = () => {
    if (!this.context) return;
    if (document.hidden) void this.context.suspend().catch(() => {});
    else if (this.unlocked) void this.context.resume().then(() => this.startMusic()).catch(() => {});
  };

  /** Must be called from a real pointer event; browsers may reject other calls. */
  unlock() {
    if (this.disposed || document.hidden) return;
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
      void this.context.resume().then(() => this.startMusic()).catch(() => {});
    } catch { /* The game stays playable without audio. */ }
  }

  setMusic(enabled: boolean) {
    this.settings.music = enabled; saveAudioSettings(this.storage, this.settings);
    if (!enabled) this.stopMusic(); else { this.unlock(); this.startMusic(); }
  }
  setEffects(enabled: boolean) {
    this.settings.effects = enabled; saveAudioSettings(this.storage, this.settings);
  }

  play(effect: Effect) {
    if (!this.settings.effects || !this.unlocked || !this.context || document.hidden) return;
    const context = this.context;
    void this.load(effect).then(buffer => {
      if (!buffer || !this.settings.effects || document.hidden || context.state !== 'running') return;
      const source = context.createBufferSource(), gain = context.createGain();
      source.buffer = buffer; gain.gain.value = VOLUMES[effect];
      source.connect(gain); gain.connect(context.destination); source.start();
      source.onended = () => { source.disconnect(); gain.disconnect(); };
    });
  }

  private load(sound: Sound): Promise<AudioBuffer | null> {
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
    const promise = decode(0)
      .then(buffer => {
        if (sound === 'music') this.smoothLoop(buffer);
        this.buffers.set(sound, buffer); return buffer;
      })
      .catch(error => { console.warn(`Audio unavailable: ${sound}`, error); return null; });
    this.pending.set(sound, promise);
    return promise;
  }

  private smoothLoop(buffer: AudioBuffer) {
    // AAC encoder padding may leave a small sample jump at the loop seam.
    const length = Math.min(2048, buffer.length - 1);
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      const data = buffer.getChannelData(channel), delta = data[0] - data[data.length - 1];
      for (let i = 0; i < length; i++) data[data.length - length + i] += delta * (i + 1) / length;
    }
  }

  private startMusic() {
    if (!this.settings.music || !this.unlocked || !this.context || this.context.state !== 'running' || this.musicSource || document.hidden) return;
    const context = this.context;
    void this.load('music').then(buffer => {
      if (!buffer || !this.settings.music || this.musicSource || document.hidden || context.state !== 'running') return;
      const source = context.createBufferSource(), gain = context.createGain();
      source.buffer = buffer; source.loop = true; gain.gain.value = .15;
      source.connect(gain); gain.connect(context.destination); source.start();
      this.musicSource = source; this.musicStarts++;
      source.onended = () => { source.disconnect(); gain.disconnect(); if (this.musicSource === source) this.musicSource = null; };
    });
  }
  private stopMusic() { this.musicSource?.stop(); this.musicSource = null; }
  dispose() {
    this.disposed = true; document.removeEventListener('visibilitychange', this.visibilityChanged);
    this.stopMusic(); void this.context?.close(); this.context = null;
  }
}
