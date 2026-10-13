// -----------------------------------------------------------------------------
// What the container writes at the default level (info): the lifecycle only.
// A normal session (reads, states, notifications, scene events) writes
// nothing; an outage writes one line when it starts and one when it ends,
// not one per attempt. The SDK logger writes through console.log/console.error.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeKodi, HA_ITEMS, settle, until } from './helpers/fakeKodi.js';
import { createWorld, created, featureId } from './helpers/world.js';

const state = (gladys) => gladys.fake.lastState(featureId('state'));

/** Capture the lines written at info and above from now on, at LOG_LEVEL=info. */
function captureLogs(t) {
  const previous = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = 'info';
  const lines = [];
  const keep = (...args) => lines.push(args.map(String).join(' '));
  t.mock.method(console, 'log', keep);
  t.mock.method(console, 'error', keep);
  t.after(() => {
    process.env.LOG_LEVEL = previous;
  });
  return lines;
}

async function withDevice(options) {
  const world = await createWorld(options);
  await until(() => world.hub.instances.get(1)?.kodi.known, 2000, 'first read');
  await world.gladys.fake.deviceCreated(created(world.gladys));
  await settle();
  return world;
}

test('a normal session writes nothing at info', async (t) => {
  const world = await withDevice();
  t.after(() => world.app.stop());
  const { gladys, kodi } = world;
  const lines = captureLogs(t);

  kodi.playItem(HA_ITEMS.movie);
  await until(() => state(gladys) === 'En lecture', 2000, 'playing');
  await settle(100); // several progress reads
  kodi.notify('Application.OnVolumeChanged', { volume: 40, muted: false });
  kodi.pause();
  await until(() => state(gladys) === 'En pause', 2000, 'paused');
  kodi.resume();
  await until(() => state(gladys) === 'En lecture', 2000, 'resumed');
  kodi.stop(true);
  await until(() => state(gladys) === 'Arrêté', 2000, 'stopped');
  await settle(100);

  assert.ok(gladys.fake.sceneEvents.length >= 4, 'scene events were fired');
  assert.deepEqual(lines, []);
});

test('Kodi off for a while: one line when it goes, one when it comes back', async (t) => {
  const kodi = new FakeKodi({ websocket: false });
  const world = await withDevice({ kodis: [kodi] });
  t.after(() => world.app.stop());
  const lines = captureLogs(t);

  kodi.down = true;
  await until(() => state(world.gladys) === 'Éteint ou injoignable', 2000, 'off');
  for (const code of ['ECONNREFUSED', 'ETIMEDOUT', 'EHOSTUNREACH']) {
    kodi.downCode = code; // the reason varies from one attempt to the next
    await settle(100); // a few attempts, 40 ms apart
  }
  kodi.down = false;
  await until(() => state(world.gladys) === 'Arrêté', 2000, 'back');
  await settle(100);

  assert.equal(lines.length, 2, lines.join('\n'));
  assert.match(lines[0], /\[WARN\].*Kodi 1: no answer from http:\/\/192\.0\.2\.20:8080/);
  assert.match(lines[1], /\[INFO\].*Kodi 1 reachable at http:\/\/192\.0\.2\.20:8080$/);
  assert.doesNotMatch(lines.join('\n'), /test-password/);
});

test('Kodi off with its WebSocket: the losses and the returns, not the attempts', async (t) => {
  const world = await withDevice();
  t.after(() => world.app.stop());
  const { kodi } = world;
  const lines = captureLogs(t);

  kodi.down = true;
  kodi.dropSockets();
  await until(() => state(world.gladys) === 'Éteint ou injoignable', 2000, 'off');
  await settle(300); // many HTTP and WebSocket attempts
  kodi.down = false;
  await until(() => world.hub.instances.get(1).kodi.wsLive, 2000, 'WebSocket back');
  await settle(100);

  // The WebSocket and HTTP may come back in either order.
  assert.deepEqual(lines.map((line) => line.replace(/^\[[^\]]+\] /, '')).sort(), [
    '[INFO] [kodi-instance] Kodi 1 reachable at http://192.0.2.20:8080',
    '[INFO] [kodi-instance] Kodi 1: WebSocket closed, reading over HTTP',
    '[INFO] [kodi-instance] Kodi 1: WebSocket connected',
    '[WARN] [kodi-instance] Kodi 1: no answer from http://192.0.2.20:8080 (EHOSTUNREACH)',
  ]);
});

test('Gladys refusing the states: one line, then one when it accepts them again', async (t) => {
  const kodi = new FakeKodi({ websocket: false });
  const world = await withDevice({ kodis: [kodi] });
  t.after(() => world.app.stop());
  const { gladys } = world;
  const lines = captureLogs(t);

  const publish = gladys.publishChangedStates;
  let refused = 0;
  gladys.publishChangedStates = async () => {
    refused += 1;
    throw new Error('Gladys unavailable');
  };
  kodi.playItem(HA_ITEMS.movie);
  for (let i = 0; i < 3; i += 1) {
    await settle(60);
    kodi.advance(10); // new progress states on the next read
  }
  await settle(60);
  assert.ok(refused >= 3, `${refused} publications refused`);
  gladys.publishChangedStates = publish;
  kodi.pause();
  await until(() => state(gladys) === 'En pause', 2000, 'published again');
  await settle(100);

  assert.equal(lines.length, 2, lines.join('\n'));
  assert.match(lines[0], /\[WARN\].*Cannot publish the states of Kodi 1: Gladys unavailable/);
  assert.match(lines[1], /\[INFO\].*States published again/);
});
