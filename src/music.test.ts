import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MUSIC_TRACKS, nextTrackIndex } from './music.ts';

test('playlist includes six unique tracks and wraps after the sixth', () => {
  assert.equal(MUSIC_TRACKS.length, 6);
  assert.equal(new Set(MUSIC_TRACKS.map(track => track.file)).size, 6);
  let index = 0;
  const order: string[] = [];
  for (let turn = 0; turn < 7; turn++) {
    order.push(MUSIC_TRACKS[index].file);
    index = nextTrackIndex(index);
  }
  assert.deepEqual(order.slice(0, 6), MUSIC_TRACKS.map(track => track.file));
  assert.equal(order[6], MUSIC_TRACKS[0].file);
});
