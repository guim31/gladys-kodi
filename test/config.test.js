// -----------------------------------------------------------------------------
// Configuration: addresses as users type them, slots, defaults.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, freeSlots, normalizeAddress, normalizeConfig } from '../src/config.js';

test('addresses as users type them', () => {
  assert.deepEqual(normalizeAddress('192.0.2.20'), {
    host: '192.0.2.20',
    httpUrl: 'http://192.0.2.20:8080',
    wsUrl: 'ws://192.0.2.20:9090/jsonrpc',
  });
  assert.equal(normalizeAddress(' 192.0.2.20:8081 ').httpUrl, 'http://192.0.2.20:8081');
  assert.equal(normalizeAddress('http://kodi.lan:8080/').httpUrl, 'http://kodi.lan:8080');
  assert.equal(normalizeAddress('https://kodi.lan').httpUrl, 'https://kodi.lan');
  assert.equal(normalizeAddress('https://kodi.lan').wsUrl, 'ws://kodi.lan:9090/jsonrpc');
  assert.equal(normalizeAddress('kodi.lan').httpUrl, 'http://kodi.lan:8080');
});

test('unusable addresses are refused', () => {
  for (const bad of [
    '',
    '   ',
    'ftp://192.0.2.20',
    'http://kodi:pass@192.0.2.20',
    'http://192.0.2.20/jsonrpc',
    'http://',
    42,
    null,
  ]) {
    assert.equal(normalizeAddress(bad), null, String(bad));
  }
});

test('slots: typed ones only, the user name defaults to kodi, invalid ones reported', () => {
  const config = normalizeConfig({
    host_1: '192.0.2.20',
    password_1: ' secret ',
    host_2: '',
    host_3: 'ftp://nope',
    username_3: 'me',
    language: 'xx',
  });
  assert.deepEqual(config.instances, [
    {
      slot: 1,
      host: '192.0.2.20',
      httpUrl: 'http://192.0.2.20:8080',
      wsUrl: 'ws://192.0.2.20:9090/jsonrpc',
      username: 'kodi',
      password: ' secret ',
    },
  ]);
  assert.deepEqual(config.invalidSlots, [3]);
  assert.equal(config.language, 'fr');
  assert.deepEqual(normalizeConfig(undefined).instances, []);
  assert.deepEqual(freeSlots({ host_1: '192.0.2.20', host_3: ' ' }), [2, 3]);
});

test('defaults: French, every slot empty', () => {
  assert.equal(DEFAULT_CONFIG.language, 'fr');
  assert.deepEqual(normalizeConfig(DEFAULT_CONFIG).instances, []);
});
