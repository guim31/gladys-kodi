// -----------------------------------------------------------------------------
// Scene actions, as the core runs them (resolved fields, outputs).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeKodi, until } from './helpers/fakeKodi.js';
import { createWorld, deviceId } from './helpers/world.js';

async function world(options) {
  const w = await createWorld(options);
  await until(() => w.hub.instances.get(1)?.kodi.known, 2000, 'first read');
  const run = (key, fields) => w.gladys.fake.sceneAction(key, { device: deviceId(1), ...fields });
  return { ...w, run };
}

const outputs = (ack) => ack.data?.outputs ?? ack.data;

test('control_playback: applied when something plays, not when nothing does', async (t) => {
  const w = await world();
  t.after(() => w.app.stop());
  assert.deepEqual(outputs(await w.run('control_playback', { command: 'pause' })), {
    applied: false,
  });
  w.kodi.playVideoFile();
  await until(() => w.hub.instances.get(1).kodi.snapshot.state === 'playing', 2000, 'playing');
  assert.deepEqual(outputs(await w.run('control_playback', { command: 'pause' })), {
    applied: true,
  });
  assert.equal(w.kodi.player.properties.speed, 0);
  await w.run('control_playback', { command: 'play_pause' });
  assert.equal(w.kodi.player.properties.speed, 1);
  await w.run('control_playback', { command: 'previous' });
  assert.deepEqual(w.kodi.calls.findLast((c) => c.method === 'Player.GoTo').params, {
    playerid: 1,
    to: 'previous',
  });
  await w.run('control_playback', { command: 'stop' });
  assert.equal(w.kodi.player, null);
  assert.equal((await w.run('control_playback', { command: 'rewind' })).success, false);
});

test('set_volume and set_mute', async (t) => {
  const w = await world();
  t.after(() => w.app.stop());
  assert.deepEqual(outputs(await w.run('set_volume', { volume: 25 })), { volume: 25 });
  assert.equal(w.kodi.application.volume, 25);
  assert.deepEqual(outputs(await w.run('set_volume', { volume: '12,6' })), { volume: 13 });
  const tooLoud = await w.run('set_volume', { volume: 101 });
  assert.equal(tooLoud.success, false);
  assert.equal(tooLoud.error, 'Le volume va de 0 à 100.');
  assert.deepEqual(outputs(await w.run('set_mute', { mode: 'mute' })), { muted: true });
  assert.deepEqual(outputs(await w.run('set_mute', { mode: 'mute' })), { muted: true });
  assert.deepEqual(outputs(await w.run('set_mute', { mode: 'toggle' })), { muted: false });
  assert.deepEqual(outputs(await w.run('set_mute', { mode: 'unmute' })), { muted: false });
});

test('show_notification: Kodi shows the message, an empty one is refused', async (t) => {
  const w = await world();
  t.after(() => w.app.stop());
  assert.equal(
    (
      await w.run('show_notification', {
        message: 'Someone at the door',
        title: 'Doorbell',
        duration: 8,
      })
    ).success,
    true,
  );
  assert.deepEqual(w.kodi.notifications.at(-1), {
    title: 'Doorbell',
    message: 'Someone at the door',
    image: 'info',
    displaytime: 8000,
  });
  await w.run('show_notification', { message: 'Hi', duration: 600 });
  assert.deepEqual(w.kodi.notifications.at(-1), {
    title: 'Gladys',
    message: 'Hi',
    image: 'info',
    displaytime: 60000,
  });
  const empty = await w.run('show_notification', { message: '  ' });
  assert.equal(empty.success, false);
  assert.equal(empty.error, "La notification n'a pas de texte.");
});

test('play_media, scan_library', async (t) => {
  const w = await world();
  t.after(() => w.app.stop());
  assert.equal((await w.run('play_media', { target: 'smb://nas/films/Film.mkv' })).success, true);
  assert.deepEqual(w.kodi.calls.find((c) => c.method === 'Player.Open').params, {
    item: { file: 'smb://nas/films/Film.mkv' },
  });
  // The playback that follows is a real start of Kodi: the trigger fires.
  await until(() => w.gladys.fake.sceneEvents.length === 1, 2000, 'trigger');
  assert.equal((await w.run('play_media', { target: '' })).success, false);
  const scans = () => w.kodi.calls.filter((c) => c.method.endsWith('Library.Scan'));
  await w.run('scan_library', { library: 'audio' });
  assert.equal(scans().at(-1).method, 'AudioLibrary.Scan');
  await w.run('scan_library', {});
  assert.equal(scans().at(-1).method, 'VideoLibrary.Scan');
});

test('get_status: what plays, for the next steps of the scene', async (t) => {
  const w = await world();
  t.after(() => w.app.stop());
  assert.deepEqual(outputs(await w.run('get_status', {})), {
    state: 'stopped',
    title: '',
    media_type: '',
    progress: 0,
    minutes_left: 0,
    volume: 100,
    muted: false,
  });
  w.kodi.playSong();
  assert.deepEqual(outputs(await w.run('get_status', {})), {
    state: 'playing',
    title: 'Test Artist – Test Song',
    media_type: 'music',
    progress: 0,
    minutes_left: 5,
    volume: 100,
    muted: false,
  });
});

test('an unknown device, a Kodi turned off: the action fails with a clear message', async (t) => {
  const kodi = new FakeKodi({ websocket: false });
  const w = await world({ kodis: [kodi] });
  t.after(() => w.app.stop());
  const unknown = await w.gladys.fake.sceneAction('set_volume', {
    device: 'ext:test-integration:kodi:7',
    volume: 10,
  });
  assert.equal(unknown.error, "Ce Kodi n'est plus configuré dans l'intégration.");
  kodi.down = true;
  const off = await w.run('set_volume', { volume: 10 });
  assert.equal(off.error, 'Kodi ne répond pas.');
});
