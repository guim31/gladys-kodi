// -----------------------------------------------------------------------------
// The integration end to end, against the SDK's fake Gladys and fake Kodi
// instances answering with recorded bodies: devices, states, scene events,
// commands, HTTP fallback, Kodi turned off, wrong password.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeKodi, HA_ITEMS, settle, until } from './helpers/fakeKodi.js';
import { configFor, createWorld, created, deviceId, featureId } from './helpers/world.js';

const text = (gladys, key, slot = 1) => gladys.fake.lastState(featureId(key, slot));
const value = (gladys, key, slot = 1) => gladys.fake.lastState(featureId(key, slot));
const events = (gladys) => gladys.fake.sceneEvents.map((e) => [e.key, e.data]);

async function withDevice(options) {
  const world = await createWorld(options);
  await until(() => world.hub.instances.get(1)?.kodi.known, 2000, 'first read');
  await world.gladys.fake.deviceCreated(created(world.gladys));
  await settle();
  return world;
}

test('one device per configured Kodi, named after Kodi, with its states once added', async (t) => {
  const world = await withDevice();
  t.after(() => world.app.stop());
  const { gladys } = world;
  const [device] = gladys.fake.discoveredDevices;
  assert.equal(device.external_id, deviceId(1));
  assert.equal(device.name, 'Kodi Test');
  assert.equal(device.should_poll, false);
  assert.deepEqual(device.params, [{ name: 'KODI_URL', value: 'http://192.0.2.20:8080' }]);
  assert.equal(text(gladys, 'state'), 'Arrêté');
  assert.equal(text(gladys, 'title'), 'Rien en lecture');
  assert.equal(text(gladys, 'media_type'), 'Aucun');
  assert.equal(value(gladys, 'volume'), 100);
  assert.equal(value(gladys, 'progress'), 0);
  assert.deepEqual(
    gladys.fake.connectionStatus?.connected ?? gladys.fake.connectionStatuses.at(-1).connected,
    true,
  );
});

test('a file played outside the library: states, then the scene events of a session', async (t) => {
  const world = await withDevice();
  t.after(() => world.app.stop());
  const { gladys, kodi } = world;

  kodi.playVideoFile();
  await until(() => text(gladys, 'state') === 'En lecture', 2000, 'playing');
  assert.equal(text(gladys, 'title'), 'Big Test Movie (2024)');
  assert.equal(text(gladys, 'media_type'), 'Vidéo');
  // Recorded 2.5 s after the start of a 10 min file.
  assert.equal(value(gladys, 'progress'), 0);
  assert.equal(value(gladys, 'time_left'), 10);

  kodi.pause();
  await until(() => text(gladys, 'state') === 'En pause', 2000, 'paused');
  kodi.resume();
  await until(() => text(gladys, 'state') === 'En lecture', 2000, 'resumed');
  kodi.stop(false);
  await until(() => text(gladys, 'state') === 'Arrêté', 2000, 'stopped');
  assert.equal(text(gladys, 'title'), 'Rien en lecture');
  assert.equal(value(gladys, 'progress'), 0);

  const common = {
    device: deviceId(1),
    kodi: 'Kodi Test',
    media_type: 'video',
    media_label: 'Vidéo',
    title: 'Big Test Movie (2024)',
  };
  assert.deepEqual(events(gladys), [
    ['playback_started', common],
    ['playback_paused', common],
    ['playback_resumed', common],
    ['playback_stopped', { ...common, ended: false }],
  ]);
});

test('the next item of a playlist is a start, not a stop and a start', async (t) => {
  const world = await withDevice();
  t.after(() => world.app.stop());
  const { gladys, kodi } = world;
  kodi.playItem(HA_ITEMS.episode);
  await until(() => events(gladys).length === 1, 2000, 'first start');
  // Kodi 20.1: OnStop (end: true), then OnPlay 0.1 s later.
  kodi.stop(true);
  await settle(5);
  kodi.playItem({ ...HA_ITEMS.episode, id: 3, episode: 8, title: 'Next one', label: 'Next one' });
  await until(() => events(gladys).length === 2, 2000, 'second start');
  await settle(80);
  assert.deepEqual(
    events(gladys).map(([key, data]) => [key, data.title]),
    [
      ['playback_started', 'Show title S03E07 – Episode title'],
      ['playback_started', 'Show title S03E08 – Next one'],
    ],
  );
  // The end of the playlist: a stop that reached its end.
  kodi.stop(true);
  await until(() => events(gladys).length === 3, 2000, 'stop');
  assert.equal(events(gladys)[2][0], 'playback_stopped');
  assert.equal(events(gladys)[2][1].ended, true);
  assert.equal(events(gladys)[2][1].media_type, 'episode');
});

test('nothing fires for what was already playing when the integration started', async (t) => {
  const kodi = new FakeKodi();
  kodi.playItem(HA_ITEMS.movie);
  const world = await withDevice({ kodis: [kodi] });
  t.after(() => world.app.stop());
  assert.equal(text(world.gladys, 'title'), 'Movie title (2026)');
  assert.equal(text(world.gladys, 'media_type'), 'Film');
  await settle(60);
  assert.deepEqual(events(world.gladys), []);
});

test('without the WebSocket (port 9090 closed), everything is read over HTTP', async (t) => {
  const kodi = new FakeKodi({ websocket: false });
  const world = await withDevice({ kodis: [kodi] });
  t.after(() => world.app.stop());
  const { gladys } = world;
  kodi.player = null;
  kodi.playSong();
  await until(() => text(gladys, 'state') === 'En lecture', 2000, 'playing');
  assert.equal(text(gladys, 'title'), 'Test Artist – Test Song');
  assert.equal(text(gladys, 'media_type'), 'Musique');
  kodi.pause();
  await until(() => text(gladys, 'state') === 'En pause', 2000, 'paused');
  kodi.player = null;
  await until(() => text(gladys, 'state') === 'Arrêté', 2000, 'stopped');
  assert.deepEqual(
    events(gladys).map(([key]) => key),
    ['playback_started', 'playback_paused', 'playback_stopped'],
  );
  assert.equal(world.hub.instances.get(1).kodi.wsLive, false);
});

test('Kodi turned off: state "off", status message, and no new start when it comes back', async (t) => {
  const world = await withDevice();
  t.after(() => world.app.stop());
  const { gladys, kodi } = world;
  kodi.playItem(HA_ITEMS.movie);
  await until(() => events(gladys).length === 1, 2000, 'start');

  kodi.down = true;
  kodi.dropSockets();
  await until(() => text(gladys, 'state') === 'Éteint ou injoignable', 2000, 'off');
  assert.equal(text(gladys, 'title'), 'Rien en lecture');
  await until(() => gladys.fake.connectionStatuses.at(-1)?.connected === false, 2000, 'status');
  assert.match(gladys.fake.connectionStatuses.at(-1).message.fr, /Kodi 1 : pas de réponse/);

  kodi.down = false;
  await until(() => text(gladys, 'state') === 'En lecture', 2000, 'back');
  await settle(60);
  assert.deepEqual(
    events(gladys).map(([key]) => key),
    ['playback_started'],
    'the same movie, still playing: no new start, no stop',
  );
  assert.equal(gladys.fake.connectionStatuses.at(-1).connected, true);
});

test('a wrong password is said in the connection status (HTTP only)', async (t) => {
  const kodi = new FakeKodi({ websocket: false });
  const world = await createWorld({
    kodis: [kodi],
    config: { host_1: kodi.address, password_1: 'wrong' },
  });
  t.after(() => world.app.stop());
  await until(() => world.gladys.fake.connectionStatuses.length > 0, 2000, 'status');
  const status = world.gladys.fake.connectionStatuses.at(-1);
  assert.equal(status.connected, false);
  assert.match(status.message.en, /Kodi 1: user name or password refused/);
});

test('a wrong password with the WebSocket open: it works, without artwork, and says so', async (t) => {
  const kodi = new FakeKodi();
  const world = await createWorld({
    kodis: [kodi],
    config: { host_1: kodi.address, password_1: 'wrong' },
  });
  t.after(() => world.app.stop());
  await until(() => world.gladys.fake.connectionStatuses.length > 0, 2000, 'status');
  const status = world.gladys.fake.connectionStatuses.at(-1);
  assert.equal(status.connected, true);
  assert.match(status.message.en, /no artwork/);
});

test('device commands: volume slider, mute, remote-control keys', async (t) => {
  const world = await withDevice();
  t.after(() => world.app.stop());
  const { gladys, kodi } = world;
  const device = created(gladys);
  const feature = (key) => device.features.find((f) => f.external_id === featureId(key));

  assert.deepEqual(await gladys.fake.setValue(device, feature('volume'), 35), { success: true });
  assert.equal(kodi.application.volume, 35);
  await until(() => value(gladys, 'volume') === 35, 2000, 'volume state');

  await gladys.fake.setValue(device, feature('mute'), 1);
  assert.equal(kodi.application.muted, true);

  // Nothing plays: a coded error in the language of the configuration.
  const refused = await gladys.fake.setValue(device, feature('pause'), 1);
  assert.equal(refused.success, false);
  assert.equal(refused.error, "Rien n'est en lecture sur Kodi.");

  kodi.playVideoFile();
  await until(() => text(gladys, 'state') === 'En lecture', 2000, 'playing');
  await gladys.fake.setValue(device, feature('pause'), 1);
  await until(() => text(gladys, 'state') === 'En pause', 2000, 'paused');
  await gladys.fake.setValue(device, feature('play'), 1);
  await until(() => text(gladys, 'state') === 'En lecture', 2000, 'playing again');
  await gladys.fake.setValue(device, feature('next'), 1);
  assert.deepEqual(kodi.calls.findLast((c) => c.method === 'Player.GoTo').params, {
    playerid: 1,
    to: 'next',
  });
  await gladys.fake.setValue(device, feature('stop'), 1);
  await until(() => text(gladys, 'state') === 'Arrêté', 2000, 'stopped');

  const tooLoud = await gladys.fake.setValue(device, feature('volume'), 150);
  assert.equal(tooLoud.success, false);
  const readOnly = await gladys.fake.setValue(device, feature('title'), 1);
  assert.equal(readOnly.success, false);
});

test('the progress follows the position while playing (Kodi pushes none)', async (t) => {
  const world = await withDevice();
  t.after(() => world.app.stop());
  const { gladys, kodi } = world;
  kodi.playVideoFile();
  await until(() => text(gladys, 'state') === 'En lecture', 2000, 'playing');
  kodi.advance(298); // 300 s of 600
  await until(() => value(gladys, 'progress') === 50, 2000, 'progress');
  assert.equal(value(gladys, 'time_left'), 5);
});

test('three Kodi at once, one device each', async (t) => {
  const kodis = [
    new FakeKodi({ host: '192.0.2.20', name: 'Salon' }),
    new FakeKodi({ host: '192.0.2.21', name: 'Chambre', password: null }),
    new FakeKodi({ host: '192.0.2.22', port: 8081, websocket: false, name: 'Bureau' }),
  ];
  const world = await createWorld({ kodis, config: configFor(kodis) });
  t.after(() => world.app.stop());
  await until(
    () => world.gladys.fake.discoveredDevices.map((d) => d.name).join() === 'Salon,Chambre,Bureau',
    2000,
    'names',
  );
  assert.deepEqual(
    world.gladys.fake.discoveredDevices.map((d) => d.params[0].value),
    ['http://192.0.2.20:8080', 'http://192.0.2.21:8080', 'http://192.0.2.22:8081'],
  );
});

test('the configuration changes: an address removed, the language switched', async (t) => {
  const world = await withDevice();
  t.after(() => world.app.stop());
  const { gladys, kodi } = world;
  await gladys.fake.configUpdated({
    host_1: kodi.address,
    password_1: kodi.password,
    language: 'de',
  });
  await until(() => text(gladys, 'state') === 'Gestoppt', 2000, 'german');
  await gladys.fake.configUpdated({ language: 'de' });
  await settle();
  assert.deepEqual(gladys.fake.discoveredDevices, []);
  assert.match(gladys.fake.connectionStatuses.at(-1).message.de, /Noch kein Kodi eingerichtet/);
});

test('an invalid address is reported, the others still work', async (t) => {
  const kodi = new FakeKodi();
  const world = await createWorld({
    kodis: [kodi],
    config: {
      host_1: kodi.address,
      password_1: kodi.password,
      host_2: 'http://user:pw@192.0.2.30',
    },
  });
  t.after(() => world.app.stop());
  await until(() => world.gladys.fake.connectionStatuses.length > 0, 2000, 'status');
  assert.match(
    world.gladys.fake.connectionStatuses.at(-1).message.en,
    /Kodi 2: the address is not valid/,
  );
  assert.equal(world.gladys.fake.discoveredDevices.length, 1);
});
