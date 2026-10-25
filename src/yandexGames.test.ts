import assert from 'node:assert/strict';
import test from 'node:test';
import { YandexGamesBridge, type YandexSdk } from './yandexGames.ts';

function mockSdk() {
  const calls: string[] = [];
  const events = new Map<string, () => void>();
  const sdk: YandexSdk = {
    features: {
      LoadingAPI: { ready: () => { calls.push('ready'); } },
      GameplayAPI: {
        start: () => { calls.push('start'); },
        stop: () => { calls.push('stop'); },
      },
    },
    on: (name, callback) => { events.set(name, callback); },
    off: (name) => { events.delete(name); },
  };
  return { sdk, calls, events };
}

test('ordinary browser never loads or calls the Yandex SDK', async () => {
  const bridge = new YandexGamesBridge(false, async () => { throw Error('must not load'); });
  bridge.markReady();
  bridge.setGameplay(true);
  await bridge.initialize();
  assert.equal(bridge.connected, false);
  bridge.dispose();
});

test('readiness waits for both game and SDK; gameplay markers follow level transitions once', async () => {
  const mock = mockSdk();
  let resolve!: (sdk: YandexSdk) => void;
  const bridge = new YandexGamesBridge(true, () => new Promise(done => { resolve = done; }));
  const pending = bridge.initialize();
  assert.equal(bridge.initialize(), pending);
  bridge.markReady();
  bridge.markReady();
  bridge.setGameplay(true);
  assert.deepEqual(mock.calls, []);
  resolve(mock.sdk);
  await pending;
  assert.deepEqual(mock.calls, ['ready', 'start']);
  bridge.setGameplay(true);
  bridge.markReady();
  bridge.setGameplay(false);
  bridge.setGameplay(false);
  bridge.setGameplay(true);
  assert.deepEqual(mock.calls, ['ready', 'start', 'stop', 'start']);
  bridge.dispose();
  assert.equal(mock.events.size, 0);
});

test('platform pause/resume notifies the game without duplicating SDK-managed markers', async () => {
  const mock = mockSdk(), paused: boolean[] = [];
  const bridge = new YandexGamesBridge(true, async () => mock.sdk);
  const unsubscribe = bridge.onPauseChanged(value => paused.push(value));
  await bridge.initialize();
  bridge.markReady();
  bridge.setGameplay(true);
  mock.events.get('game_api_pause')!();
  mock.events.get('game_api_pause')!();
  assert.equal(bridge.paused, true);
  assert.deepEqual(mock.calls, ['ready', 'start']);
  mock.events.get('game_api_resume')!();
  mock.events.get('game_api_resume')!();
  assert.deepEqual(paused, [true, false]);
  assert.deepEqual(mock.calls, ['ready', 'start']);
  bridge.setGameplay(false);
  mock.events.get('game_api_pause')!();
  mock.events.get('game_api_resume')!();
  assert.deepEqual(mock.calls, ['ready', 'start', 'stop']);
  unsubscribe();
  bridge.dispose();
});

test('failed SDK initialization keeps the game bridge inert without a fake SDK', async () => {
  const warning = console.warn;
  const messages: unknown[][] = [];
  console.warn = (...args: unknown[]) => { messages.push(args); };
  try {
    const bridge = new YandexGamesBridge(true, async () => { throw Error('unavailable'); });
    bridge.markReady();
    bridge.setGameplay(true);
    await bridge.initialize();
    assert.equal(bridge.connected, false);
    assert.equal(messages.length, 1);
    bridge.dispose();
  } finally { console.warn = warning; }
});
