import assert from 'node:assert/strict';
import test from 'node:test';
import { loadYandexSdk, YandexGamesBridge, type YandexSdk } from './yandexGames.ts';

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

test('hanging YaGames.init times out instead of blocking game startup', async () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    setTimeout: (callback: () => void, delay: number) => {
      if (delay === 20000) queueMicrotask(callback);
      return 1;
    },
    clearTimeout: () => {},
    YaGames: { init: () => new Promise<YandexSdk>(() => {}) },
  } });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    createElement: () => ({}),
    head: { append: (script: { onload: () => void }) => queueMicrotask(() => script.onload()) },
  } });
  try {
    await assert.rejects(loadYandexSdk(), /YaGames\.init timed out/);
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
    else Reflect.deleteProperty(globalThis, 'window');
    if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
    else Reflect.deleteProperty(globalThis, 'document');
  }
});

test('SDK feature errors are reported without throwing into gameplay', async () => {
  const mock = mockSdk();
  mock.sdk.features!.LoadingAPI!.ready = () => { throw new Error('ready failed'); };
  mock.sdk.features!.GameplayAPI!.start = () => { throw new Error('start failed'); };
  const warning = console.warn, messages: unknown[][] = [];
  console.warn = (...args: unknown[]) => { messages.push(args); };
  try {
    const bridge = new YandexGamesBridge(true, async () => mock.sdk);
    await bridge.initialize();
    bridge.markReady();
    bridge.setGameplay(true);
    bridge.setGameplay(false);
    assert.deepEqual(mock.calls, ['stop']);
    assert.equal(messages.length, 2);
    bridge.dispose();
  } finally { console.warn = warning; }
});

test('missing platform features are reported rather than silently ignored', async () => {
  const mock = mockSdk();
  delete mock.sdk.features;
  const warning = console.warn, messages: unknown[][] = [];
  console.warn = (...args: unknown[]) => { messages.push(args); };
  try {
    const bridge = new YandexGamesBridge(true, async () => mock.sdk);
    await bridge.initialize();
    bridge.markReady();
    bridge.setGameplay(true);
    assert.deepEqual(messages.map(message => message[0]), [
      'Yandex Games LoadingAPI.ready unavailable',
      'Yandex Games GameplayAPI unavailable',
    ]);
    bridge.dispose();
  } finally { console.warn = warning; }
});
