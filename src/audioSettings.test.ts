import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AUDIO_SETTINGS_KEY, restoreAudioSettings, saveAudioSettings } from './audioSettings.ts';

test('audio settings default on, persist independently, and reject malformed values', () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  assert.deepEqual(restoreAudioSettings(storage), { music: true, effects: true });
  saveAudioSettings(storage, { music: false, effects: true });
  assert.deepEqual(restoreAudioSettings(storage), { music: false, effects: true });
  values.set(AUDIO_SETTINGS_KEY, '{oops');
  assert.deepEqual(restoreAudioSettings(storage), { music: true, effects: true });
  values.set(AUDIO_SETTINGS_KEY, '{"music":false,"effects":"off"}');
  assert.deepEqual(restoreAudioSettings(storage), { music: false, effects: true });
});
