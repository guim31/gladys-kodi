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

/**
 * The music library of the bench Kodi 21.2 (k21-*.json): three albums of two
 * artists, the songs of "First Light", the "Evening" playlist, a source, three
 * favourites (a song, a folder, a settings window).
 */
export function k21Library() {
  const songs = structuredClone(result('k21-songs-of-album.json').songs).map((song) => ({
    ...song,
    albumid: 1,
    title: song.label,
    type: 'song',
    id: song.songid,
  }));
  const cafe = structuredClone(result('k21-search-songs.json').songs[0]);
  songs.push({ ...cafe, albumid: 2, title: cafe.label, type: 'song', id: cafe.songid });
  return {
    artists: structuredClone(result('k21-artists.json').artists),
    albums: structuredClone(result('k21-albums.json').albums),
    songs,
    playlists: structuredClone(result('k21-playlists-dir.json').files),
    // The two songs of Evening.m3u, as Files.GetDirectory lists them.
    playlistItems: {
      'special://profile/playlists/music/Evening.m3u': [
        {
          file: '/media/music/Beta Solo/Quiet Room/01 - Silence.mp3',
          label: 'Silence',
          title: 'Silence',
          type: 'song',
          id: 6,
          filetype: 'file',
          artist: ['Beta Solo'],
          duration: 40,
        },
        {
          file: '/media/music/Alpha Band/Second Wind/01 - Breathe.mp3',
          label: 'Breathe',
          title: 'Breathe',
          type: 'song',
          id: 4,
          filetype: 'file',
          artist: ['Alpha Band'],
          duration: 40,
        },
      ],
    },
    sources: structuredClone(result('k21-sources.json').sources),
    sourceDir: structuredClone(result('k21-source-dir.json').files),
    favourites: structuredClone(result('k21-favourites.json').favourites),
  };
}

const page = (rows, limits) => {
  const start = limits?.start ?? 0;
  const end = limits?.end ?? rows.length;
  const items = rows.slice(start, end);
  return { items, limits: { start, end: start + items.length, total: rows.length } };
};

const ruleMatches = (rule, row, fields) => {
  if (rule.and) {
    return rule.and.every((part) => ruleMatches(part, row, fields));
  }
  const value = fields[rule.field]?.(row);
  const values = (Array.isArray(value) ? value : [value]).map((v) => String(v ?? '').toLowerCase());
  const wanted = String(rule.value).toLowerCase();
  return rule.operator === 'is' ? values.includes(wanted) : values.some((v) => v.includes(wanted));
};

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
    this.imageRequests = [];
    this.player = null; // { player, properties, item }
    this.library = k21Library();
    this.playlists = { 0: [], 1: [] };
  }

  /** Start item `position` of a playlist, as Player.Open / GoTo do. */
  playFromPlaylist(playlistid, position) {
    const item = this.playlists[playlistid][position];
    const type = playlistid === 1 ? 'video' : 'audio';
    this.player = {
      player: { playerid: playlistid === 1 ? 1 : 0, playertype: 'internal', type },
      properties: {
        ...structuredClone(result('k21-properties-audio.json')),
        time: { hours: 0, minutes: 0, seconds: 0, milliseconds: 0 },
        percentage: 0,
        playlistid,
        position,
        shuffled: this.player?.properties.shuffled ?? false,
        repeat: this.player?.properties.repeat ?? 'off',
      },
      item: structuredClone(item),
    };
    const data = { item: { id: item.id, type: item.type }, player: { playerid: 0, speed: 1 } };
    this.notify('Player.OnPlay', data);
  }

  /** The songs of a Playlist.Item, as Kodi adds them. */
  itemsOf(item) {
    const { songs } = this.library;
    if (item.albumid !== undefined) {
      return songs.filter((song) => song.albumid === item.albumid);
    }
    if (item.artistid !== undefined) {
      const artist = this.library.artists.find((a) => a.artistid === item.artistid);
      return songs.filter((song) => song.artist.includes(artist?.artist));
    }
    if (item.songid !== undefined) {
      return songs.filter((song) => song.songid === item.songid);
    }
    if (item.directory !== undefined) {
      return this.library.playlistItems[item.directory] ?? [];
    }
    if (item.file !== undefined) {
      const song = songs.find((s) => s.file === item.file);
      return [song ?? { file: item.file, label: item.file.split('/').at(-1), type: 'unknown' }];
    }
    return [];
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
        if (!playerMatches()) {
          return invalid;
        }
        if (Number.isInteger(params.to)) {
          const playlistid = current.properties.playlistid ?? 0;
          if (!this.playlists[playlistid]?.[params.to]) {
            return invalid;
          }
          this.playFromPlaylist(playlistid, params.to);
        }
        return ok('OK');
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
        if (Number.isInteger(params?.item?.playlistid)) {
          if (!this.playlists[params.item.playlistid]?.[params.item.position ?? 0]) {
            return invalid;
          }
          this.playFromPlaylist(params.item.playlistid, params.item.position ?? 0);
          return ok('OK');
        }
        if (typeof params?.item?.file !== 'string') {
          return invalid;
        }
        this.playVideoFile();
        return ok('OK');
      case 'VideoLibrary.Scan':
      case 'AudioLibrary.Scan':
        return ok('OK');
      // --- The music catalog (Gladys 5.3), on the k21 library -------------
      case 'AudioLibrary.GetArtists': {
        const rows = this.library.artists.filter(
          (row) => !params.filter || ruleMatches(params.filter, row, { artist: (r) => r.artist }),
        );
        const { items, limits } = page(rows, params.limits);
        return ok({ artists: items, limits });
      }
      case 'AudioLibrary.GetAlbums': {
        const fields = { album: (r) => r.label, artist: (r) => r.artist };
        const artist = this.library.artists.find((a) => a.artistid === params.filter?.artistid);
        const rows = this.library.albums.filter((row) => {
          if (params.filter?.artistid !== undefined) {
            return row.artist.includes(artist?.artist);
          }
          return !params.filter || ruleMatches(params.filter, row, fields);
        });
        const { items, limits } = page(rows, params.limits);
        return ok({ albums: items, limits });
      }
      case 'AudioLibrary.GetSongs': {
        const rows = this.library.songs.filter((row) => {
          if (params.filter?.albumid !== undefined) {
            return row.albumid === params.filter.albumid;
          }
          return !params.filter || ruleMatches(params.filter, row, { title: (r) => r.title });
        });
        const { items, limits } = page(rows, params.limits);
        return ok({ songs: items, limits });
      }
      case 'AudioLibrary.GetAlbumDetails': {
        const album = this.library.albums.find((a) => a.albumid === params.albumid);
        return album ? ok({ albumdetails: { ...album, title: album.label } }) : invalid;
      }
      case 'AudioLibrary.GetArtistDetails': {
        const artist = this.library.artists.find((a) => a.artistid === params.artistid);
        return artist ? ok({ artistdetails: artist }) : invalid;
      }
      case 'Files.GetSources':
        return ok({ sources: this.library.sources, limits: { start: 0, end: 1, total: 1 } });
      case 'Files.GetDirectory': {
        const rows =
          params.directory === 'special://musicplaylists/'
            ? this.library.playlists
            : params.directory === '/media/music/'
              ? this.library.sourceDir
              : this.library.playlistItems[params.directory];
        if (!rows) {
          return invalid;
        }
        const { items, limits } = page(rows, params.limits);
        return ok({ files: items, limits });
      }
      case 'Favourites.GetFavourites':
        return ok({
          favourites: this.library.favourites,
          limits: { start: 0, end: 3, total: 3 },
        });
      case 'Playlist.Clear':
        this.playlists[params.playlistid] = [];
        return ok('OK');
      case 'Playlist.Add':
        this.playlists[params.playlistid].push(...structuredClone(this.itemsOf(params.item)));
        return ok('OK');
      case 'Playlist.Insert':
        this.playlists[params.playlistid].splice(
          params.position,
          0,
          ...structuredClone(this.itemsOf(params.item)),
        );
        return ok('OK');
      case 'Playlist.GetItems': {
        const { items, limits } = page(this.playlists[params.playlistid] ?? [], params.limits);
        return ok({ items, limits });
      }
      case 'Player.Seek': {
        if (!playerMatches() || !params.value?.time) {
          return invalid;
        }
        current.properties.time = { ...params.value.time };
        this.notify('Player.OnSeek', {
          item: {},
          player: { playerid: current.player.playerid, speed: 1, time: params.value.time },
        });
        return ok({ time: params.value.time });
      }
      case 'Player.SetShuffle':
        if (!playerMatches()) {
          return invalid;
        }
        current.properties.shuffled = params.shuffle;
        this.notify('Player.OnPropertyChanged', {
          player: { playerid: current.player.playerid },
          property: { shuffled: params.shuffle },
        });
        return ok('OK');
      case 'Player.SetRepeat':
        if (!playerMatches()) {
          return invalid;
        }
        current.properties.repeat = params.repeat;
        this.notify('Player.OnPropertyChanged', {
          player: { playerid: current.player.playerid },
          property: { repeat: params.repeat },
        });
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
      const sized = decodeURIComponent(pathname.slice('/image/'.length));
      // Kodi resizes an art of its cache on `?width=` (checked on Kodi 21.2);
      // the fake serves the same bytes and records the width asked.
      const width = /\?width=(\d+)$/.exec(sized)?.[1];
      const art = sized.replace(/\?width=\d+$/, '');
      this.imageRequests.push({ art, width: width ? Number(width) : null });
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
