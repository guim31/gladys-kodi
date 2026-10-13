// -----------------------------------------------------------------------------
// The two ways to Kodi: JSON-RPC over HTTP (Basic authentication, errors,
// images) and over the WebSocket (calls, notifications, reconnection, ping).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KodiError, KodiHttp } from '../src/kodi/http.js';
import { KodiSocket } from '../src/kodi/socket.js';
import { COVER, FakeKodi, fixture, network, settle, until } from './helpers/fakeKodi.js';

const httpOf = (kodi, password = kodi.password, fetch = network(kodi).fetch) =>
  new KodiHttp({ httpUrl: kodi.httpUrl, username: 'kodi', password, fetch });

test('HTTP: a call with the password, its result', async () => {
  const kodi = new FakeKodi();
  assert.deepEqual(
    await httpOf(kodi).call('Application.GetProperties', { properties: ['volume'] }),
    fixture('application-properties.json').result,
  );
});

test('HTTP: errors by kind — password refused, no answer, JSON-RPC error, other status', async () => {
  const kodi = new FakeKodi();
  await assert.rejects(httpOf(kodi, 'wrong').call('JSONRPC.Ping'), { kind: 'unauthorized' });
  kodi.down = true;
  await assert.rejects(httpOf(kodi).call('JSONRPC.Ping'), { kind: 'unreachable' });
  kodi.down = false;
  await assert.rejects(httpOf(kodi).call('Player.GetProperties', { playerid: 1, properties: [] }), {
    kind: 'rpc',
    code: -32602,
  });
  const redirect = async () =>
    new Response(null, { status: 302, headers: { location: 'http://elsewhere/' } });
  await assert.rejects(httpOf(kodi, kodi.password, redirect).call('JSONRPC.Ping'), {
    kind: 'http',
    status: 302,
  });
  const notJson = async () => new Response('<html>', { status: 200 });
  await assert.rejects(httpOf(kodi, kodi.password, notJson).call('JSONRPC.Ping'), { kind: 'http' });
  const timeout = async () => {
    const err = new Error('The operation was aborted due to timeout');
    err.name = 'TimeoutError';
    throw err;
  };
  await assert.rejects(httpOf(kodi, kodi.password, timeout).call('JSONRPC.Ping'), (err) => {
    assert.ok(err instanceof KodiError);
    assert.equal(err.kind, 'unreachable');
    assert.match(err.message, /timeout/);
    return true;
  });
});

test('HTTP: the password never leaves for another address, nor shows in errors', async () => {
  const kodi = new FakeKodi();
  const seen = [];
  const fetch = async (url, init) => {
    seen.push({ url, redirect: init.redirect });
    throw new TypeError('fetch failed');
  };
  await assert.rejects(httpOf(kodi, 'S3cret!', fetch).call('JSONRPC.Ping'), (err) => {
    assert.doesNotMatch(err.message, /S3cret/);
    return true;
  });
  assert.deepEqual(seen, [{ url: 'http://192.0.2.20:8080/jsonrpc', redirect: 'manual' }]);
});

test('HTTP: images of the texture cache, refused beyond the limit', async () => {
  const kodi = new FakeKodi();
  const art = 'image://%2fmedia%2fmusic%2fA%2ffolder.jpg/';
  kodi.images.set(art, COVER);
  const { bytes } = await httpOf(kodi).image(art, 300 * 1024);
  assert.ok(bytes.equals(COVER));
  await assert.rejects(httpOf(kodi).image(art, 1000), { code: 'too_large' });
  // A body without length, longer than allowed: cut while reading.
  const chunked = async () => new Response(new Blob([COVER, COVER]).stream(), { status: 200 });
  await assert.rejects(httpOf(kodi, kodi.password, chunked).image(art, COVER.length + 10), {
    code: 'too_large',
  });
  await assert.rejects(httpOf(kodi).image('image://unknown/', 1000), { kind: 'http', status: 404 });
});

const FAST = {
  reconnectMin: 10,
  reconnectMax: 40,
  callTimeout: 100,
  connectTimeout: 100,
  pingInterval: 60_000,
};

test('WebSocket: calls, notifications in order, reconnection after a drop', async (t) => {
  const kodi = new FakeKodi();
  const socket = new KodiSocket({
    wsUrl: 'ws://192.0.2.20:9090/jsonrpc',
    createSocket: network(kodi).createSocket,
    timings: FAST,
  });
  t.after(() => socket.stop());
  const seen = [];
  socket.on('notification', (method) => seen.push(method));
  let opened = 0;
  socket.on('open', () => (opened += 1));
  socket.start();
  await until(() => socket.live, 1000, 'open');
  assert.equal(await socket.call('JSONRPC.Ping'), 'pong');
  await assert.rejects(socket.call('Nope.Nope'), { kind: 'rpc', code: -32601 });
  kodi.playVideoFile();
  await settle();
  assert.deepEqual(seen, ['Player.OnPlay', 'Player.OnAVStart']);

  kodi.dropSockets();
  await until(() => !socket.live, 1000, 'closed');
  await assert.rejects(socket.call('JSONRPC.Ping'), { kind: 'unreachable' });
  await until(() => socket.live, 1000, 'reopened');
  assert.equal(opened, 2);
});

test('WebSocket: a call without answer times out, a silent link is dropped by the ping', async (t) => {
  const kodi = new FakeKodi();
  const socket = new KodiSocket({
    wsUrl: 'ws://192.0.2.20:9090/jsonrpc',
    createSocket: network(kodi).createSocket,
    timings: { ...FAST, pingInterval: 30 },
  });
  t.after(() => socket.stop());
  let closed = 0;
  socket.on('close', () => (closed += 1));
  socket.start();
  await until(() => socket.live, 1000, 'open');
  kodi.silent = true;
  await assert.rejects(socket.call('JSONRPC.Ping'), { kind: 'unreachable' });
  await until(() => closed === 1, 1000, 'dropped by the ping');
  kodi.silent = false;
  await until(() => socket.live, 1000, 'back');
});

test('WebSocket: port closed, retried with a growing delay, stop() ends everything', async () => {
  const kodi = new FakeKodi({ websocket: false });
  const created = [];
  const net = network(kodi);
  const socket = new KodiSocket({
    wsUrl: 'ws://192.0.2.20:9090/jsonrpc',
    createSocket: (url) => {
      created.push(url);
      return net.createSocket(url);
    },
    timings: FAST,
  });
  socket.start();
  await settle(150);
  assert.ok(created.length >= 3 && created.length < 15, `${created.length} attempts`);
  assert.equal(socket.live, false);
  socket.stop();
  const count = created.length;
  await settle(100);
  assert.equal(created.length, count);
});
