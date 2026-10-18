export interface AudioSettings { music: boolean; effects: boolean }
export interface AudioStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }
export const AUDIO_SETTINGS_KEY = 'mystic-puzzles-audio-v1';
export function restoreAudioSettings(storage: Pick<AudioStorage, 'getItem'>): AudioSettings {
  try {
    const value = JSON.parse(storage.getItem(AUDIO_SETTINGS_KEY) ?? 'null');
    return { music: typeof value?.music === 'boolean' ? value.music : true, effects: typeof value?.effects === 'boolean' ? value.effects : true };
  } catch { return { music: true, effects: true }; }
}
export function saveAudioSettings(storage: Pick<AudioStorage, 'setItem'>, settings: AudioSettings): void {
  try { storage.setItem(AUDIO_SETTINGS_KEY, JSON.stringify(settings)); } catch { /* Private browsing may block storage. */ }
}
