// -----------------------------------------------------------------------------
// The "Kodi" widget: content checked against the SDK's validator (what the
// core renders exactly as sent), its artwork, its buttons.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent, validateWidgetImage } from '@gladysassistant/integration-sdk';
import { buildContent } from '../src/widgets.js';
import { COVER, FakeKodi, HA_ITEMS, result, settle, until } from './helpers/fakeKodi.js';
import { createWorld, created, deviceId } from './helpers/world.js';

const get = async (gladys, settings, language = 'fr') => {
  const ack = await gladys.fake.widgetGet('player', { settings, language, units: 'metric' });
  assert.equal(ack.success, true, ack.error);
  return ack.data.content ?? ack.data;
};
const types = (content) => content.components.map((c) => c.type);
const labels = (content) =>
  content.components.filter((c) => c.type === 'button').map((c) => c.action.key);

async function world() {
  const w = await createWorld();
  await until(() => w.hub.instances.get(1)?.kodi.known, 2000, 'first read');
  return w;
}

test('nothing chosen, unknown Kodi: a short text', async (t) => {
  const w = await world();
  t.after(() => w.app.stop());
  const empty = await get(w.gladys, {});
  assert.match(empty.components[0].text, /Choisissez un Kodi/);
  const unknown = await get(w.gladys, { device: 'ext:test-integration:kodi:9' }, 'de');
  assert.match(unknown.components[0].text, /nicht mehr eingerichtet/);
});

test('stopped: title, state, volume buttons; every content fits the core budget', async (t) => {
  const w = await world();
  t.after(() => w.app.stop());
  const content = await get(w.gladys, { device: deviceId(1) });
  assert.deepEqual(types(content), ['text', 'text', 'status', 'button', 'button']);
  assert.equal(content.components[0].text, 'Rien en lecture');
  assert.deepEqual(labels(content), ['volume_down', 'volume_up']);
  assert.deepEqual(validateWidgetContent(content), []);
});

test('a library song: artwork from Kodi, next and volume buttons', async (t) => {
  const kodi = new FakeKodi();
  kodi.images.set('image://%2fmedia%2fmusic%2fTest%20Artist%2fTest%20Album%2ffolder.jpg/', COVER);
  const w = await createWorld({ kodis: [kodi] });
  t.after(() => w.app.stop());
  kodi.playSong();
  await until(() => w.hub.artworkKey(w.hub.instances.get(1)), 2000, 'artwork');
  const content = await get(w.gladys, { device: deviceId(1) }, 'en');
  assert.deepEqual(types(content), [
    'image',
    'text',
    'text',
    'status',
    'button',
    'button',
    'button',
    'button',
  ]);
  assert.equal(content.components[1].text, 'Test Artist – Test Song');
  assert.equal(content.components[2].text, 'Music · Kodi Test');
  assert.deepEqual(labels(content), ['play_pause', 'next', 'volume_down', 'volume_up']);
  assert.deepEqual(validateWidgetContent(content), []);
  const image = await w.gladys.fake.widgetGetImage(content.components[0].key);
  assert.equal(image.success, true);
  const base64 = image.data.image ?? image.data;
  assert.ok(Buffer.from(base64, 'base64').equals(COVER));
  assert.deepEqual(validateWidgetImage(base64), []);
  assert.equal((await w.gladys.fake.widgetGetImage('cover-unknown')).success, false);
});

test('a file outside the library, device added: the progress gauge, stop button', async (t) => {
  const w = await world();
  t.after(() => w.app.stop());
  await w.gladys.fake.deviceCreated(created(w.gladys));
  w.kodi.playVideoFile();
  await until(() => w.hub.instances.get(1).kodi.snapshot.state === 'playing', 2000, 'playing');
  const content = await get(w.gladys, { device: deviceId(1) });
  assert.deepEqual(types(content), [
    'gauge',
    'text',
    'text',
    'status',
    'button',
    'button',
    'button',
    'button',
  ]);
  assert.deepEqual(labels(content), ['play_pause', 'stop', 'volume_down', 'volume_up']);
  const status = content.components.find((c) => c.type === 'status').items;
  assert.deepEqual(
    status.map((item) => item.label),
    ['État', 'Position', 'Fin vers', 'Volume'],
  );
  assert.equal(status[1].value, '0:02 / 10:00');
  assert.equal(content.ttl_seconds, 15);
  assert.deepEqual(validateWidgetContent(content), []);
});

test('a long title is cut in the heading and given whole in the caption', async (t) => {
  const w = await world();
  t.after(() => w.app.stop());
  w.kodi.playItem({ ...HA_ITEMS.episode, showtitle: 'A very long show title indeed' });
  await until(() => w.hub.instances.get(1).kodi.snapshot.state === 'playing', 2000, 'playing');
  const content = await get(w.gladys, { device: deviceId(1) });
  assert.equal(content.components[0].text.length, 40);
  assert.match(content.components[1].text, /S03E07 – Episode title · Épisode · Kodi Test/);
  assert.deepEqual(validateWidgetContent(content), []);
});

test('buttons: play/pause, stop, volume steps; a refusal is a toast, not an error', async (t) => {
  const w = await world();
  t.after(() => w.app.stop());
  const settings = { device: deviceId(1) };
  const act = (key) => w.gladys.fake.widgetAction('player', key, {}, { settings });
  const refused = await act('play_pause');
  assert.equal(refused.success, true);
  assert.match(JSON.stringify(refused.data), /Nothing is playing on Kodi/);
  w.kodi.playVideoFile();
  await until(() => w.hub.instances.get(1).kodi.snapshot.state === 'playing', 2000, 'playing');
  await act('play_pause');
  await until(() => w.hub.instances.get(1).kodi.snapshot.state === 'paused', 2000, 'paused');
  await act('volume_down');
  assert.equal(w.kodi.application.volume, 95);
  await until(() => w.hub.instances.get(1).kodi.snapshot.volume === 95, 2000, 'volume');
  await act('volume_up');
  assert.equal(w.kodi.application.volume, 100);
  await act('stop');
  assert.equal(w.kodi.player, null);
  assert.equal((await act('nope')).success, false);
});

test('the dashboards are nudged when playback changes, within the core limit', async (t) => {
  let clock = 0;
  const w = await createWorld({ now: () => clock });
  t.after(() => w.app.stop());
  await until(() => w.hub.instances.get(1)?.kodi.known, 2000, 'first read');
  const before = w.gladys.fake.widgetRefreshes.length;
  clock += 20_000;
  w.kodi.playVideoFile();
  await until(() => w.gladys.fake.widgetRefreshes.length > before, 2000, 'nudge');
  assert.deepEqual(w.gladys.fake.widgetRefreshes.at(-1), 'player');
  await settle();
});

test('buildContent stays within the budget in every state and language', async (t) => {
  const w = await world();
  t.after(() => w.app.stop());
  const entry = w.hub.instances.get(1);
  const base = entry.kodi.snapshot;
  const states = [
    { ...base, state: 'off', volume: null },
    { ...base, state: 'stopped' },
    {
      ...base,
      state: 'paused',
      title: 'x'.repeat(300),
      mediaType: 'movie',
      time: 10,
      total: 7200,
      percentage: 0.1,
      identity: 'movie:1',
    },
    {
      ...base,
      state: 'playing',
      title: 'Live',
      mediaType: 'tv',
      time: 10,
      total: null,
      identity: 'channel:4',
    },
  ];
  for (const snapshot of states) {
    entry.kodi.snapshot = snapshot;
    for (const language of ['en', 'fr', 'de', 'es', 'it']) {
      const content = buildContent(w.hub, { settings: { device: deviceId(1) }, language });
      assert.deepEqual(validateWidgetContent(content), [], `${snapshot.state} ${language}`);
    }
  }
  entry.kodi.snapshot = base;
  assert.ok(result('active-players-none.json'));
});
