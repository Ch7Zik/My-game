/** The platform supplies /sdk.js when the ZIP is hosted by Yandex Games. */
export interface YandexSdk {
  features?: {
    LoadingAPI?: { ready(): void };
    GameplayAPI?: { start(): void; stop(): void };
  };
  on(event: 'game_api_pause' | 'game_api_resume', callback: () => void): void;
  off(event: 'game_api_pause' | 'game_api_resume', callback: () => void): void;
}

declare global {
  interface Window { YaGames?: { init(): Promise<YandexSdk> } }
}

export async function loadYandexSdk(): Promise<YandexSdk> {
  await new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    const timeout = window.setTimeout(() => {
      script.remove();
      reject(new Error('Yandex Games /sdk.js timed out'));
    }, 12000);
    script.src = '/sdk.js';
    script.async = true;
    script.onload = () => { window.clearTimeout(timeout); resolve(); };
    script.onerror = () => {
      window.clearTimeout(timeout);
      reject(new Error('Yandex Games /sdk.js could not be loaded'));
    };
    document.head.append(script);
  });
  if (!window.YaGames?.init) throw new Error('Yandex Games SDK did not expose YaGames.init');
  return window.YaGames.init();
}

/** Platform events pause the game; the SDK handles its own gameplay markers on those events. */
export class YandexGamesBridge {
  private enabled: boolean;
  private loader: () => Promise<YandexSdk>;
  private sdk: YandexSdk | null = null;
  private starting: Promise<void> | null = null;
  private ready = false;
  private readySent = false;
  private wantsGameplay = false;
  private markedGameplay = false;
  private platformPaused = false;
  private listeners = new Set<(paused: boolean) => void>();

  constructor(enabled: boolean, loader: () => Promise<YandexSdk> = loadYandexSdk) {
    this.enabled = enabled;
    this.loader = loader;
  }

  get paused() { return this.platformPaused; }
  get connected() { return this.sdk !== null; }

  initialize(): Promise<void> {
    if (!this.enabled) return Promise.resolve();
    if (this.starting) return this.starting;
    this.starting = this.loader().then(sdk => {
      this.sdk = sdk;
      sdk.on('game_api_pause', this.handlePause);
      sdk.on('game_api_resume', this.handleResume);
      this.flush();
    }).catch(error => {
      // The game remains playable, but this is a visible platform integration failure.
      console.warn('Yandex Games SDK unavailable; local progress remains active', error);
    });
    return this.starting;
  }

  onPauseChanged(listener: (paused: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  markReady() { this.ready = true; this.flush(); }
  setGameplay(playing: boolean) {
    if (this.wantsGameplay === playing) return;
    this.wantsGameplay = playing;
    this.flush();
  }

  private handlePause = () => {
    if (this.platformPaused) return;
    this.platformPaused = true;
    for (const listener of this.listeners) listener(true);
    // The SDK automatically marks GameplayAPI.stop() for this event.
  };

  private handleResume = () => {
    if (!this.platformPaused) return;
    this.platformPaused = false;
    for (const listener of this.listeners) listener(false);
    // The SDK automatically restores a gameplay marker that was active at pause.
    this.flush();
  };

  private flush() {
    if (!this.sdk || !this.ready) return;
    if (!this.readySent) {
      this.readySent = true;
      this.sdk.features?.LoadingAPI?.ready();
    }
    if (this.platformPaused) return;
    if (this.wantsGameplay === this.markedGameplay) return;
    this.markedGameplay = this.wantsGameplay;
    if (this.markedGameplay) this.sdk.features?.GameplayAPI?.start();
    else this.sdk.features?.GameplayAPI?.stop();
  }

  dispose() {
    this.sdk?.off('game_api_pause', this.handlePause);
    this.sdk?.off('game_api_resume', this.handleResume);
    this.listeners.clear();
  }
}
