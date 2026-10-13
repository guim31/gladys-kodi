// -----------------------------------------------------------------------------
// A Kodi in memory: its JSON-RPC over HTTP (a `fetch` implementation, Basic
// authentication, `/image/`) and over WebSocket (a WebSocket stand-in with
// Kodi's notifications), answering with the bodies recorded on Kodi 20.1
// (test/fixtures/kodi/). The tests drive it: play, pause, stop, change the
// volume, close the WebSocket port, turn Kodi off.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

// Silent integration logs (LOG_LEVEL is read on every log call);
// LOG_LEVEL=debug npm test shows them.
process.env.LOG_LEVEL ??= 'silent';

export function fixture(name) {
  return JSON.parse(readFileSync(new URL(`../fixtures/kodi/${name}`, import.meta.url), 'utf8'));
}

export const COVER = readFileSync(new URL('../fixtures/kodi/cover.jpg', import.meta.url));
export const HA_ITEMS = fixture('items-home-assistant.json');

/** The `result` of a recorded JSON-RPC answer. */
export const result = (name) => fixture(name).result;

export const settle = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

/** Wait until `check()` is true (or fail after `timeout` ms). */
export async function until(check, timeout = 2000, what = 'condition') {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeout) {
      throw new Error(`Timed out waiting for ${what}`);
    }
    await settle(5);
  }
}

const json = (status, body) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

class FakeSocket {
  constructor(server, url) {
    this.server = server;
    this.url = url;
    this.sent = [];
    this.closed = false;
    this.onopen = null;
    this.onmessage = null;
    this.onclose = null;
    this.onerror = null;
    setImmediate(() => {
      if (this.closed) {
        return;
      }
      if (!server.websocket || server.down) {
        this.#close();
        return;
      }
      server.sockets.add(this);
      this.onopen?.();
    });
  }

  send(text) {
    if (this.closed) {
      throw new Error('socket closed');
    }
    const request = JSON.parse(text);
    this.sent.push(request);
    if (this.server.silent) {
      return;
    }
    const answer = this.server.handle(request.method, request.params);
    setImmediate(() =>
      this.deliver(
        answer.error
          ? { id: request.id, jsonrpc: '2.0', error: answer.error }
          : { id: request.id, jsonrpc: '2.0', result: answer.result },
      ),
    );
  }

  deliver(message) {
    if (!this.closed) {
      this.onmessage?.({ data: JSON.stringify(message) });
    }
  }

  close() {
    this.#close();
  }

  #close() {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.server.sockets.delete(this);
    setImmediate(() => this.onclose?.({ code: 1006 }));
  }
}

export class FakeKodi {
  /**
   * @param {object} [options]
   * @param {string} [options.host]
   * @param {number} [options.port] HTTP port
   * @param {string|null} [options.password] null: no authentication
   * @param {boolean} [options.websocket] port 9090 open to the network
   */
  constructor({
    host = '192.0.2.20',
    port = 8080,
    password = 'test-password',
    websocket = true,
    name = 'Kodi Test',
  } = {}) {
    this.host = host;
    this.port = port;
    this.username = 'kodi';
    this.password = password;
    this.websocket = websocket;
    this.friendlyName = name;
    this.application = { ...result('application-properties.json') };
    this.down = false;
    this.downCode = 'EHOSTUNREACH';
    this.silent = false;
    this.sockets = new Set();
    this.calls = [];
    this.notifications = [];
    this.images = new Map();
    this.player = null; // { player, properties, item }
  }

  get httpUrl() {
    return `http://${this.host}:${this.port}`;
  }

  get address() {
    return this.port === 8080 ? this.host : `${this.host}:${this.port}`;
  }

  // --- What the tests do on Kodi -------------------------------------------

  notify(method, data) {
    for (const socket of [...this.sockets]) {
      socket.deliver({ jsonrpc: '2.0', method, params: { data, sender: 'xbmc' } });
    }
  }

  /** The recorded video file (outside the library), playing. */
  playVideoFile() {
    this.player = {
      player: result('active-players-video.json')[0],
      properties: structuredClone(result('properties-video-playing.json')),
      item: structuredClone(result('item-video-file.json').item),
    };
    const data = {
      item: { title: 'Big Test Movie (2024).mp4', type: 'movie' },
      player: { playerid: 1, speed: 1 },
    };
    this.notify('Player.OnPlay', data);
    this.notify('Player.OnAVStart', data);
  }

  /** A library item (`items-home-assistant.json` or `item-song-library.json`). */
  playItem(item, type = item.type === 'song' ? 'audio' : 'video') {
    const playerid = type === 'audio' ? 0 : 1;
    this.player = {
      player: { playerid, playertype: 'internal', type },
      properties: structuredClone(
        result(
          type === 'audio' ? 'properties-audio-playing.json' : 'properties-video-playing.json',
        ),
      ),
      item: structuredClone(item),
    };
    const data = { item: { id: item.id, type: item.type }, player: { playerid, speed: 1 } };
    this.notify('Player.OnPlay', data);
    this.notify('Player.OnAVStart', data);
  }

  playSong() {
    this.playItem(result('item-song-library.json').item, 'audio');
  }

  pause() {
    this.player.properties.speed = 0;
    this.notify('Player.OnPause', {
      item: {},
      player: { playerid: this.player.player.playerid, speed: 0 },
    });
  }

  resume() {
    this.player.properties.speed = 1;
    this.notify('Player.OnResume', {
      item: {},
      player: { playerid: this.player.player.playerid, speed: 1 },
    });
  }

  stop(end = false) {
    this.player = null;
    this.notify('Player.OnStop', { end, item: {} });
  }

  /** Move the position (seconds), without notification (Kodi pushes none). */
  advance(seconds) {
    const props = this.player.properties;
    const total =
      props.totaltime.hours * 3600 + props.totaltime.minutes * 60 + props.totaltime.seconds;
    const now = props.time.hours * 3600 + props.time.minutes * 60 + props.time.seconds + seconds;
    props.time = {
      hours: Math.floor(now / 3600),
      minutes: Math.floor((now % 3600) / 60),
      seconds: Math.floor(now % 60),
      milliseconds: 0,
    };
    props.percentage = total > 0 ? (now / total) * 100 : 0;
  }

  /** Close every WebSocket (Kodi restarted its server, network cut). */
  dropSockets() {
    for (const socket of [...this.sockets]) {
      socket.close();
    }
  }

  // --- JSON-RPC -------------------------------------------------------------

  handle(method, params = {}) {
    this.calls.push({ method, params });
    const invalid = { error: { code: -32602, message: 'Invalid params.' } };
    const ok = (value) => ({ result: value });
    const current = this.player;
    const playerMatches = () => current && params?.playerid === current.player.playerid;
    switch (method) {
      case 'JSONRPC.Ping':
        return ok('pong');
      case 'Player.GetActivePlayers':
        return ok(current ? [current.player] : []);
      case 'Player.GetProperties':
        return playerMatches() ? ok(structuredClone(current.properties)) : invalid;
      case 'Player.GetItem':
        return playerMatches()
          ? ok({ item: structuredClone(current.item) })
          : ok({ item: { label: '', type: 'unknown' } });
      case 'Application.GetProperties':
        return ok({ ...this.application });
      case 'XBMC.GetInfoLabels':
        return ok({ 'System.FriendlyName': this.friendlyName });
      case 'Player.PlayPause': {
        if (!playerMatches()) {
          return invalid;
        }
        const play = params.play === 'toggle' ? current.properties.speed === 0 : params.play;
        if (play && current.properties.speed === 0) {
          this.resume();
        } else if (!play && current.properties.speed !== 0) {
          this.pause();
        }
        return ok({ speed: current.properties.speed });
      }
      case 'Player.Stop':
        if (!playerMatches()) {
          return invalid;
        }
        this.stop(false);
        return ok('OK');
      case 'Player.GoTo':
        return playerMatches() ? ok('OK') : invalid;
      case 'Application.SetVolume':
        if (!Number.isInteger(params.volume)) {
          return invalid;
        }
        this.application.volume = params.volume;
        this.notify('Application.OnVolumeChanged', {
          muted: this.application.muted,
          volume: params.volume,
        });
        return ok(params.volume);
      case 'Application.SetMute':
        this.application.muted = params.mute === 'toggle' ? !this.application.muted : params.mute;
        this.notify('Application.OnVolumeChanged', {
          muted: this.application.muted,
          volume: this.application.volume,
        });
        return ok(this.application.muted);
      case 'GUI.ShowNotification':
        this.notifications.push(params);
        return ok('OK');
      case 'Player.Open':
        if (typeof params?.item?.file !== 'string') {
          return invalid;
        }
        this.playVideoFile();
        return ok('OK');
      case 'VideoLibrary.Scan':
      case 'AudioLibrary.Scan':
        return ok('OK');
      default:
        return { error: { code: -32601, message: 'Method not found.' } };
    }
  }

  async fetch(url, init = {}) {
    if (this.down) {
      throw new TypeError('fetch failed', { cause: { code: this.downCode } });
    }
    const { pathname } = new URL(url);
    if (this.password !== null) {
      const expected = `Basic ${Buffer.from(`${this.username}:${this.password}`).toString('base64')}`;
      if (init.headers?.authorization !== expected) {
        return new Response(null, { status: 401 });
      }
    }
    if (pathname === '/jsonrpc' && init.method === 'POST') {
      const request = JSON.parse(init.body);
      const answer = this.handle(request.method, request.params);
      return json(200, { id: request.id, jsonrpc: '2.0', ...answer });
    }
    if (pathname.startsWith('/image/')) {
      const art = decodeURIComponent(pathname.slice('/image/'.length));
      const bytes = this.images.get(art);
      if (!bytes) {
        return new Response('<html>File not found</html>', { status: 404 });
      }
      return new Response(bytes, {
        status: 200,
        headers: { 'content-length': String(bytes.length) },
      });
    }
    return new Response('<html>File not found</html>', { status: 404 });
  }
}

/** Route fetch and WebSocket calls to the fake Kodi of their host. */
export function network(...servers) {
  const byHost = (url) => {
    const { hostname } = new URL(url);
    return servers.find((server) => server.host === hostname);
  };
  return {
    fetch: async (url, init) => {
      const server = byHost(url);
      if (!server) {
        throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } });
      }
      return server.fetch(url, init);
    },
    createSocket: (url) => {
      const server = byHost(url);
      if (!server) {
        return new FakeSocket({ websocket: false, sockets: new Set() }, url);
      }
      return new FakeSocket(server, url);
    },
  };
}
