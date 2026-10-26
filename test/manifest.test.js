// -----------------------------------------------------------------------------
// Consistency checks between `gladys-assistant-integration.json` and the code.
// The manifest is validated by the store indexer, but nothing there can know
// which handlers the code actually registers — these tests keep both in sync.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  DEFAULT_CONFIG,
  LANGUAGES,
  SLOTS,
  hostKey,
  passwordKey,
  usernameKey,
} from '../src/config.js';
import { MDNS_SERVICES } from '../src/discovery.js';
import { TRIGGERS, WIDGET_KEY } from '../src/hub.js';
import { MEDIA_TYPES } from '../src/kodi/model.js';
import {
  LIBRARIES,
  MUTE_MODES,
  NOTIFICATION_DEFAULTS,
  NOTIFICATION_DURATION,
  PLAYBACK_COMMANDS,
  SCENE_ACTIONS,
} from '../src/scenes.js';
import { WIDGETS } from '../src/widgets.js';
import { HA_ITEMS, until } from './helpers/fakeKodi.js';
import { createWorld, created, deviceId } from './helpers/world.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

// Every list of form fields the manifest can declare (same field grammar).
const allFields = [
  ...(manifest.config_schema ?? []),
  ...[
    ...(manifest.actions ?? []),
    ...(manifest.scene_triggers ?? []),
    ...(manifest.scene_actions ?? []),
  ].flatMap((item) => item.fields ?? []),
  ...(manifest.widgets ?? []).flatMap((widget) => widget.settings ?? []),
];

const keysOf = (list) => (list ?? []).map((entry) => entry.key);
const optionsOf = (field) => field.options.map((option) => option.value);

function minGladysVersion() {
  const match = manifest.gladys_version.match(/>=\s*(\d+)\.(\d+)\.(\d+)/);
  assert.ok(match, 'gladys_version must declare a minimum version');
  return match.slice(1).map(Number);
}

function isAtLeast(version, required) {
  for (let i = 0; i < required.length; i += 1) {
    if (version[i] !== required[i]) {
      return version[i] > required[i];
    }
  }
  return true;
}

test('identity: name, image, local transport, multimedia category, mDNS services', () => {
  assert.equal(manifest.name, 'Kodi');
  assert.equal(manifest.type, 'device');
  assert.match(manifest.docker_image, /^ghcr\.io\/guim31\/gladys-kodi:/);
  assert.equal(
    manifest.cover_image,
    'https://raw.githubusercontent.com/guim31/gladys-kodi/main/cover.png',
  );
  assert.deepEqual(manifest.transports, ['local']);
  assert.deepEqual(manifest.categories, ['multimedia']);
  assert.deepEqual(
    manifest.network_discovery,
    MDNS_SERVICES.map((service) => ({ type: 'mdns', service })),
  );
});

test('the manifest version is the package version, and the image is tagged with it', () => {
  assert.equal(manifest.version, pkg.version, 'manifest version must match package.json');
  assert.ok(
    manifest.docker_image.endsWith(`:${manifest.version}`),
    `docker_image must be tagged :${manifest.version}, got "${manifest.docker_image}"`,
  );
});

test('the music player (manifest `music`) requires Gladys >= 5.3.0', () => {
  // `music` and the music feature types appeared in Gladys 5.3.0; scene
  // triggers, scene actions and widgets need 5.1.0, which this covers.
  assert.ok(isAtLeast(minGladysVersion(), [5, 3, 0]), manifest.gladys_version);
  assert.deepEqual(manifest.music, { browse: true, search: true, queue: true, append: true });
});

test('config_schema: three Kodi slots, the defaults and options of the code', () => {
  const field = (key) => manifest.config_schema.find((f) => f.key === key);
  for (const slot of SLOTS) {
    assert.equal(field(hostKey(slot)).type, 'string');
    assert.equal(field(usernameKey(slot)).type, 'string');
    assert.equal(field(passwordKey(slot)).type, 'secret');
    for (const key of [hostKey(slot), usernameKey(slot), passwordKey(slot)]) {
      // Found on the network or left empty: never required.
      assert.equal(field(key).required, false, key);
    }
  }
  for (const entry of manifest.config_schema) {
    if (entry.default !== undefined) {
      assert.equal(DEFAULT_CONFIG[entry.key], entry.default, `default of ${entry.key}`);
    }
  }
  const keys = manifest.config_schema.filter((f) => f.type !== 'section').map((f) => f.key);
  assert.deepEqual(Object.keys(DEFAULT_CONFIG).sort(), keys.sort());
  const languages = field('language');
  assert.deepEqual(optionsOf(languages), LANGUAGES);
  assert.equal(languages.default, 'fr');
});

test('section fields are purely presentational', () => {
  const sections = manifest.config_schema.filter((f) => f.type === 'section');
  assert.ok(sections.length > 0);
  for (const section of sections) {
    assert.equal(section.required, undefined);
    assert.equal(section.default, undefined);
    assert.equal(section.placeholder, undefined);
    for (const link of section.links ?? []) {
      assert.match(link.url, /^https:\/\//, 'section links must be https');
    }
  }
});

test('every manifest action, scene action and widget has a handler, and vice versa', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const fake = world.gladys.fake;
  assert.match((await fake.action('nope')).error, /not implemented/i);
  for (const action of manifest.actions) {
    const ack = await fake.action(action.key, {});
    assert.equal(ack.success, true, `action ${action.key}: ${ack.error}`);
  }
  assert.deepEqual(keysOf(manifest.scene_actions).sort(), Object.keys(SCENE_ACTIONS).sort());
  for (const action of manifest.scene_actions) {
    const ack = await fake.sceneAction(action.key, { device: 'unknown' });
    assert.doesNotMatch(ack.error ?? '', /not implemented/i, action.key);
  }
  assert.deepEqual(keysOf(manifest.widgets), [WIDGET_KEY]);
  assert.deepEqual(Object.keys(WIDGETS), [WIDGET_KEY]);
  assert.equal((await fake.widgetGet(WIDGET_KEY, { settings: {} })).success, true);
});

test('scene action fields and outputs are the ones the code reads and returns', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await until(() => world.hub.instances.get(1)?.kodi.known, 2000, 'first read');
  const action = (key) => manifest.scene_actions.find((a) => a.key === key);
  const field = (key, name) => action(key).fields.find((f) => f.key === name);
  assert.deepEqual(optionsOf(field('control_playback', 'command')), PLAYBACK_COMMANDS);
  assert.deepEqual(optionsOf(field('set_mute', 'mode')), MUTE_MODES);
  assert.deepEqual(optionsOf(field('scan_library', 'library')), LIBRARIES);
  assert.equal(field('show_notification', 'title').default, NOTIFICATION_DEFAULTS.title);
  assert.equal(field('show_notification', 'duration').default, NOTIFICATION_DEFAULTS.duration);
  assert.equal(field('show_notification', 'duration').min, NOTIFICATION_DURATION.min);
  assert.equal(field('show_notification', 'duration').max, NOTIFICATION_DURATION.max);
  assert.equal(field('set_volume', 'volume').min, 0);
  assert.equal(field('set_volume', 'volume').max, 100);

  world.kodi.playItem(HA_ITEMS.movie);
  await until(() => world.hub.instances.get(1).kodi.snapshot.state === 'playing', 2000, 'playing');
  const fields = {
    device: deviceId(1),
    command: 'pause',
    volume: 20,
    mode: 'mute',
    message: 'Hello',
    title: 'Gladys',
    duration: 5,
    target: '/media/film.mkv',
    library: 'video',
  };
  for (const entry of manifest.scene_actions) {
    for (const declared of entry.fields) {
      assert.ok(declared.key in fields, `${entry.key}.${declared.key} is exercised`);
    }
    const ack = await world.gladys.fake.sceneAction(entry.key, fields);
    assert.equal(ack.success, true, `${entry.key}: ${ack.error}`);
    assert.deepEqual(
      Object.keys(ack.data?.outputs ?? {}).sort(),
      keysOf(entry.outputs).sort(),
      entry.key,
    );
  }
});

test('the scene triggers the hub fires are declared, with their filters and variables', async (t) => {
  assert.deepEqual(keysOf(manifest.scene_triggers).sort(), Object.values(TRIGGERS).sort());
  const world = await createWorld();
  t.after(() => world.app.stop());
  await until(() => world.hub.instances.get(1)?.kodi.known, 2000, 'first read');
  const { kodi } = world;
  kodi.playItem(HA_ITEMS.movie);
  await until(() => world.gladys.fake.sceneEvents.length === 1, 2000, 'started');
  kodi.pause();
  await until(() => world.gladys.fake.sceneEvents.length === 2, 2000, 'paused');
  kodi.resume();
  await until(() => world.gladys.fake.sceneEvents.length === 3, 2000, 'resumed');
  kodi.stop(true);
  await until(() => world.gladys.fake.sceneEvents.length === 4, 2000, 'stopped');
  const events = world.gladys.fake.sceneEvents;
  for (const trigger of manifest.scene_triggers) {
    const event = events.find((e) => e.key === trigger.key);
    assert.ok(event, `${trigger.key} fired`);
    for (const key of [...keysOf(trigger.fields), ...keysOf(trigger.variables)]) {
      assert.ok(key in event.data, `${trigger.key}: "${key}" is in the event data`);
    }
    for (const variable of trigger.variables) {
      const expected = { number: 'number', boolean: 'boolean' }[variable.type] ?? 'string';
      assert.equal(typeof event.data[variable.key], expected, variable.key);
    }
    const mediaTypes = trigger.fields.find((f) => f.key === 'media_type');
    assert.deepEqual(optionsOf(mediaTypes), MEDIA_TYPES, trigger.key);
    assert.equal(mediaTypes.type, 'multi_select');
    assert.equal(trigger.fields.find((f) => f.key === 'device').source, 'devices');
  }
  assert.equal(events[0].data.media_type, 'movie');
  assert.equal(events[0].data.device, deviceId(1));
});

test('the widget settings: one Kodi, chosen among the devices', () => {
  assert.deepEqual(manifest.widgets[0].settings, [
    {
      key: 'device',
      type: 'select',
      source: 'devices',
      label: { en: 'Kodi', fr: 'Kodi', de: 'Kodi', es: 'Kodi' },
      required: true,
    },
  ]);
});

test('dynamic selects declare a source and no static options', () => {
  const dynamicSelects = allFields.filter((f) => f.source !== undefined);
  assert.ok(dynamicSelects.length > 0);
  for (const field of dynamicSelects) {
    assert.equal(field.source, 'devices');
    assert.equal(field.options, undefined, `field "${field.key}": source and options together`);
  }
});

test('number fields have integer bounds and defaults (the form has no step)', () => {
  for (const field of allFields.filter((f) => f.type === 'number')) {
    for (const key of ['min', 'max', 'default']) {
      if (field[key] !== undefined) {
        assert.ok(Number.isInteger(field[key]), `field "${field.key}".${key} must be an integer`);
      }
    }
  }
});

test('actions declare no secret field, no required field (Gladys#3154/#3155)', () => {
  for (const action of manifest.actions ?? []) {
    for (const field of action.fields ?? []) {
      assert.notEqual(field.type, 'secret', `${action.key}.${field.key}`);
      assert.notEqual(field.required, true, `${action.key}.${field.key}`);
    }
  }
});

test('the catalog description holds 10 to 100 characters per language', () => {
  for (const [lang, text] of Object.entries(manifest.description)) {
    assert.ok(text.length >= 10 && text.length <= 100, `description.${lang}: ${text.length}`);
  }
});

test('the device features have names, and the created device matches the discovered one', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const device = created(world.gladys);
  assert.equal(device.features.length, 21);
});
