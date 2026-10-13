// -----------------------------------------------------------------------------
// One Kodi: its WebSocket (calls + notifications), its HTTP API (fallback
// calls, images), the snapshot of what plays, the playback events, commands.
//
// - WebSocket up: a notification (Player.OnPlay, OnPause, OnStop...) triggers
//   a refresh; while something plays, a light read every `progressInterval`
//   follows the progress (Kodi pushes no position).
// - WebSocket down (port 9090 closed to the network): everything is read over
//   HTTP every `pollInterval`, transitions included.
// - Kodi unreachable (turned off): one HTTP attempt every `offlineInterval`.
//
// Between two items of a playlist Kodi sends Player.OnStop then, 0.1 s later,
// Player.OnPlay: the refresh after an OnStop waits `stopGrace`, so the next
// episode is a "started" and not a "stopped" followed by a "started".
// -----------------------------------------------------------------------------

import { EventEmitter } from 'node:events';
import { createLogger } from '@gladysassistant/integration-sdk';
import { KodiError, KodiHttp } from './kodi/http.js';
import {
  ACTIVE_STATES,
  APPLICATION_PROPERTIES,
  ITEM_PROPERTIES,
  PLAYER_PROPERTIES,
  choosePlayer,
  emptySnapshot,
  playbackEvents,
  readSnapshot,
  toSeconds,
} from './kodi/model.js';
import { KodiSocket } from './kodi/socket.js';

const logger = createLogger({ name: 'kodi-instance' });

export const DEFAULT_TIMINGS = {
  // Over HTTP only: how fast a pause or a stop is seen.
  pollInterval: 10_000,
  // While playing, with the WebSocket: progress and time left.
  progressInterval: 10_000,
  // Kodi turned off: an HTTP attempt this often.
  offlineInterval: 30_000,
  // Notifications come in bursts (OnPlay, OnAVChange, OnAVStart...).
  notificationDelay: 300,
  stopGrace: 1_500,
};

// Notifications that change what the snapshot holds.
const PLAYER_NOTIFICATIONS = new Set([
  'Player.OnPlay',
  'Player.OnAVStart',
  'Player.OnResume',
  'Player.OnPause',
  'Player.OnStop',
  'Player.OnSpeedChanged',
  'Player.OnPropertyChanged',
  'Playlist.OnClear',
]);

/** Kodi refused a command for a reason the user can act on. */
export class CommandRefused extends Error {
  constructor(code, message = code) {
    super(message);
    this.code = code;
  }
}

/**
 * Emits:
 * - `update` (snapshot, previous): the snapshot changed;
 * - `playback` ({ type, snapshot, ended }): a scene event;
 * - `info` (): the friendly name or the version changed;
 * - `connection` (): reachable / unauthorized / WebSocket changed.
 */
export class KodiInstance extends EventEmitter {
  constructor({
    slot,
    httpUrl,
    wsUrl,
    username,
    password,
    fetch,
    createSocket,
    timings,
    socketTimings,
  }) {
    super();
    this.slot = slot;
    this.httpUrl = httpUrl;
    this.wsUrl = wsUrl;
    this.username = username;
    this.password = password;
    this.timings = { ...DEFAULT_TIMINGS, ...timings };
    this.http = new KodiHttp({ httpUrl, username, password, fetch });
    this.socket = new KodiSocket({ wsUrl, createSocket, timings: socketTimings });
    this.snapshot = emptySnapshot('off');
    this.known = false; // a first refresh succeeded since start
    this.reachable = false;
    this.unauthorized = false;
    this.lastError = null;
    this.friendlyName = null;
    this.version = null;
    this.lastIdentity = '';
    this.stopEnded = null;
    this.httpChecked = false;
    this.httpError = undefined;
    this.running = false;
    this.loopTimer = null;
    this.notifyTimer = null;
    this.refreshing = null;
    this.again = false;
    this.generation = 0;

    this.socket.on('open', () => {
      logger.info(`Kodi ${slot}: WebSocket connected`);
      this.emit('connection');
      this.requestRefresh(0);
    });
    this.socket.on('close', () => {
      logger.info(`Kodi ${slot}: WebSocket closed, reading over HTTP`);
      this.emit('connection');
      this.#schedule(0);
    });
    this.socket.on('notification', (method, data) => this.#onNotification(method, data));
  }

  get wsLive() {
    return this.socket.live;
  }

  start() {
    if (this.running) {
      return;
    }
    this.running = true;
    this.socket.start();
    this.#schedule(0);
  }

  stop() {
    this.running = false;
    this.generation += 1;
    clearTimeout(this.loopTimer);
    clearTimeout(this.notifyTimer);
    this.loopTimer = null;
    this.notifyTimer = null;
    this.socket.stop();
    this.removeAllListeners();
  }

  /** A JSON-RPC call over the WebSocket when it is open, over HTTP otherwise. */
  async call(method, params) {
    if (this.socket.live) {
      try {
        return await this.socket.call(method, params);
      } catch (err) {
        // A slow answer on a live socket (Kodi busy scanning its library) is
        // not a reason to try HTTP: its password may be wrong on purpose
        // (artwork only), which would turn a delay into "password refused".
        if (err.kind !== 'unreachable' || this.socket.live) {
          throw err;
        }
        // The socket died during the call: HTTP may still answer.
      }
    }
    return this.http.call(method, params);
  }

  // --- Reading ------------------------------------------------------------

  /** Refresh soon (coalesced). */
  requestRefresh(delay = this.timings.notificationDelay) {
    if (!this.running) {
      return;
    }
    clearTimeout(this.notifyTimer);
    this.notifyTimer = setTimeout(() => {
      this.notifyTimer = null;
      this.refresh().catch(() => {});
    }, delay);
    this.notifyTimer.unref?.();
  }

  /** A read soon, unless one is already scheduled (a stop grace included). */
  #refreshSoon() {
    if (!this.notifyTimer) {
      this.requestRefresh();
    }
  }

  #onNotification(method, data) {
    if (method === 'Application.OnVolumeChanged') {
      if (data && Number.isFinite(data.volume)) {
        this.#apply({
          ...this.snapshot,
          volume: Math.round(data.volume),
          muted: typeof data.muted === 'boolean' ? data.muted : this.snapshot.muted,
        });
      }
      return;
    }
    if (method === 'Player.OnStop') {
      this.stopEnded = typeof data?.end === 'boolean' ? data.end : null;
      this.requestRefresh(this.timings.stopGrace);
      return;
    }
    if (method === 'Player.OnSeek' && data?.player?.time) {
      const time = toSeconds(data.player.time);
      if (time !== null && ACTIVE_STATES.has(this.snapshot.state)) {
        const percentage = this.snapshot.total ? (time / this.snapshot.total) * 100 : null;
        this.#apply({ ...this.snapshot, time, percentage });
      }
      return;
    }
    if (PLAYER_NOTIFICATIONS.has(method)) {
      if (method === 'Player.OnPlay' || method === 'Player.OnAVStart') {
        // The next item of a playlist: not a stop.
        this.stopEnded = null;
      }
      this.requestRefresh();
    }
  }

  /**
   * Read everything Kodi says now. Concurrent calls share the run in progress,
   * and one more run follows when asked meanwhile (a notification arrived
   * during the read).
   */
  refresh() {
    if (this.refreshing) {
      this.again = true;
      return this.refreshing;
    }
    this.refreshing = (async () => {
      try {
        do {
          this.again = false;
          await this.#readAll();
        } while (this.again && this.running);
      } finally {
        this.refreshing = null;
      }
    })();
    return this.refreshing;
  }

  async #readAll() {
    const generation = this.generation;
    let answers;
    try {
      answers = await this.#read();
    } catch (err) {
      if (generation !== this.generation) {
        return;
      }
      this.#failed(err);
      return;
    }
    if (generation !== this.generation || !this.running) {
      return;
    }
    const wasReachable = this.reachable;
    this.reachable = true;
    this.unauthorized = false;
    this.lastError = null;
    if (!this.httpChecked) {
      await this.#checkHttp();
    }
    if (!wasReachable) {
      logger.info(`Kodi ${this.slot} reachable at ${this.httpUrl}`);
      this.socket.retryNow();
    }
    const changedInfo =
      (answers.friendlyName && answers.friendlyName !== this.friendlyName) ||
      (answers.version && answers.version !== this.version);
    if (answers.friendlyName) {
      this.friendlyName = answers.friendlyName;
    }
    if (answers.version) {
      this.version = answers.version;
    }
    if (changedInfo) {
      this.emit('info');
    }
    if (!wasReachable) {
      this.emit('connection');
    }
    const next = readSnapshot(answers, this.snapshot);
    const context = { lastIdentity: this.lastIdentity };
    if (this.stopEnded !== null) {
      context.ended = this.stopEnded;
    }
    if (next.state === 'stopped' || ACTIVE_STATES.has(next.state)) {
      this.stopEnded = null;
    }
    this.#apply(next, context);
  }

  /**
   * Over the WebSocket, a wrong password goes unnoticed (that port has no
   * authentication), but the artwork comes over HTTP: check it once per
   * connection, to say so in the status.
   */
  async #checkHttp() {
    this.httpChecked = true;
    const before = this.httpError;
    try {
      await this.http.call('JSONRPC.Ping');
      this.httpError = null;
    } catch (err) {
      this.httpError = err instanceof KodiError ? err.kind : 'unreachable';
    }
    if (before !== undefined && before !== this.httpError) {
      this.emit('connection');
    }
  }

  async #read() {
    const players = await this.call('Player.GetActivePlayers');
    const player = choosePlayer(players);
    const answers = { player };
    const reads = [this.call('Application.GetProperties', { properties: APPLICATION_PROPERTIES })];
    if (!this.friendlyName || !this.known) {
      reads.push(this.call('XBMC.GetInfoLabels', { labels: ['System.FriendlyName'] }));
    }
    const [application, labels] = await Promise.all(reads);
    answers.application = application;
    answers.version = versionText(application?.version);
    const name = labels?.['System.FriendlyName'];
    if (typeof name === 'string' && name.trim() !== '' && name !== 'Busy') {
      answers.friendlyName = name.trim().slice(0, 60);
    }
    if (player) {
      const [properties, item] = await Promise.all([
        this.call('Player.GetProperties', {
          playerid: player.playerid,
          properties: PLAYER_PROPERTIES,
        }),
        this.call('Player.GetItem', { playerid: player.playerid, properties: ITEM_PROPERTIES }),
      ]);
      answers.properties = properties;
      answers.item = item?.item ?? null;
    }
    return answers;
  }

  /** While playing over the WebSocket: only the position moves. */
  async #readProgress() {
    const { playerId } = this.snapshot;
    if (playerId === null) {
      return;
    }
    const generation = this.generation;
    let properties;
    try {
      properties = await this.call('Player.GetProperties', {
        playerid: playerId,
        properties: PLAYER_PROPERTIES,
      });
    } catch (err) {
      if (err.kind === 'rpc') {
        // The player is gone: read everything, through requestRefresh so that
        // a pending stop grace (next item of a playlist) is kept.
        this.#refreshSoon();
      }
      return;
    }
    if (generation !== this.generation || this.snapshot.playerId !== playerId) {
      return;
    }
    const state = properties.speed === 0 ? 'paused' : 'playing';
    if (state !== this.snapshot.state) {
      this.#refreshSoon();
      return;
    }
    const total = toSeconds(properties.totaltime);
    this.#apply({
      ...this.snapshot,
      time: toSeconds(properties.time),
      total: total && total > 0 ? total : null,
      percentage: Number.isFinite(properties.percentage) ? properties.percentage : null,
    });
  }

  #failed(err) {
    const kind = err instanceof KodiError ? err.kind : 'unreachable';
    if (kind === 'rpc') {
      // Kodi answered, refusing one call (a player that stopped between two
      // calls): the next read sorts it out.
      logger.debug(`Kodi ${this.slot}: ${err.message}`);
      return;
    }
    const message = err?.message ?? String(err);
    if (this.socket.live) {
      // The WebSocket still answers its pings: Kodi is there, only slow.
      // The next notification or tick reads again.
      logger.debug(`Kodi ${this.slot}: ${message}`);
      return;
    }
    if (message !== this.lastError) {
      logger.warn(`Kodi ${this.slot}: ${message}`);
    }
    const unauthorized = kind === 'unauthorized';
    const changed = this.reachable || this.unauthorized !== unauthorized || this.lastError === null;
    this.reachable = false;
    this.unauthorized = unauthorized;
    this.lastError = message;
    this.httpChecked = false;
    if (this.snapshot.state !== 'off') {
      const { volume, muted } = this.snapshot;
      this.#apply({ ...emptySnapshot('off'), volume, muted });
    }
    if (changed) {
      this.emit('connection');
    }
  }

  #apply(next, context) {
    const previous = this.snapshot;
    const first = !this.known;
    this.snapshot = next;
    if (next.state !== 'off') {
      this.known = true;
    }
    // What played when Kodi went away: coming back with it is no new start.
    if (ACTIVE_STATES.has(next.state)) {
      this.lastIdentity = next.identity;
    } else if (next.state === 'stopped') {
      this.lastIdentity = '';
    }
    if (context) {
      const events = first ? [] : playbackEvents(previous, next, context);
      for (const event of events) {
        this.emit('playback', event);
      }
    }
    if (!sameSnapshot(previous, next)) {
      this.emit('update', next, previous);
    }
  }

  // --- Loop ---------------------------------------------------------------

  #schedule(delay) {
    if (!this.running) {
      return;
    }
    clearTimeout(this.loopTimer);
    this.loopTimer = setTimeout(() => this.#tick(), delay);
    this.loopTimer.unref?.();
  }

  async #tick() {
    this.loopTimer = null;
    if (!this.running) {
      return;
    }
    try {
      if (!this.socket.live || !this.known || !this.reachable) {
        await this.refresh();
      } else if (this.snapshot.state === 'playing') {
        await this.#readProgress();
      }
    } catch (err) {
      logger.debug(`Kodi ${this.slot}: read failed (${err.message})`);
    }
    this.#schedule(this.#nextDelay());
  }

  #nextDelay() {
    if (!this.reachable || this.unauthorized) {
      return this.timings.offlineInterval;
    }
    return this.socket.live ? this.timings.progressInterval : this.timings.pollInterval;
  }

  // --- Commands -----------------------------------------------------------

  /** The active player, read fresh (a command never acts on a stale id). */
  async #player() {
    const player = choosePlayer(await this.call('Player.GetActivePlayers'));
    if (!player) {
      throw new CommandRefused('nothing_playing');
    }
    return player;
  }

  async #afterCommand() {
    // Over HTTP nothing is pushed: read the result right away.
    if (!this.socket.live) {
      await this.refresh();
    }
  }

  /**
   * @param {'play'|'pause'|'play_pause'|'stop'|'next'|'previous'} command
   */
  async playback(command) {
    const player = await this.#player();
    switch (command) {
      case 'play':
        await this.call('Player.PlayPause', { playerid: player.playerid, play: true });
        break;
      case 'pause':
        await this.call('Player.PlayPause', { playerid: player.playerid, play: false });
        break;
      case 'play_pause':
        await this.call('Player.PlayPause', { playerid: player.playerid, play: 'toggle' });
        break;
      case 'stop':
        await this.call('Player.Stop', { playerid: player.playerid });
        break;
      case 'next':
        await this.call('Player.GoTo', { playerid: player.playerid, to: 'next' });
        break;
      case 'previous':
        await this.call('Player.GoTo', { playerid: player.playerid, to: 'previous' });
        break;
      default:
        throw new Error(`Unknown playback command ${command}`);
    }
    await this.#afterCommand();
  }

  async setVolume(volume) {
    const value = Math.round(Math.min(100, Math.max(0, volume)));
    const result = await this.call('Application.SetVolume', { volume: value });
    if (!this.socket.live) {
      this.#apply({ ...this.snapshot, volume: Number.isFinite(result) ? result : value });
    }
    return value;
  }

  /** `true`, `false` or `'toggle'`; resolves the new mute state. */
  async setMute(mute) {
    const result = await this.call('Application.SetMute', { mute });
    if (typeof result === 'boolean' && !this.socket.live) {
      this.#apply({ ...this.snapshot, muted: result });
    }
    return result;
  }

  async notify(title, message, displaySeconds) {
    await this.call('GUI.ShowNotification', {
      title,
      message,
      image: 'info',
      displaytime: Math.round(displaySeconds * 1000),
    });
  }

  async open(target) {
    await this.call('Player.Open', { item: { file: target } });
    await this.#afterCommand();
  }

  /** @param {'video'|'audio'} library */
  async scanLibrary(library) {
    await this.call(library === 'audio' ? 'AudioLibrary.Scan' : 'VideoLibrary.Scan');
  }

  /** The bytes of the first art of the current item Kodi serves within `maxBytes`. */
  async artwork(urls, maxBytes) {
    let lastError = null;
    for (const url of urls) {
      try {
        return await this.http.image(url, maxBytes);
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError ?? new KodiError('http', 'no artwork');
  }
}

function versionText(version) {
  if (!version || typeof version !== 'object' || !Number.isInteger(version.major)) {
    return null;
  }
  return `${version.major}.${version.minor ?? 0}`;
}

function sameSnapshot(a, b) {
  return (
    a.state === b.state &&
    a.playerId === b.playerId &&
    a.mediaType === b.mediaType &&
    a.title === b.title &&
    a.identity === b.identity &&
    a.time === b.time &&
    a.total === b.total &&
    a.percentage === b.percentage &&
    a.volume === b.volume &&
    a.muted === b.muted &&
    a.art.join('|') === b.art.join('|')
  );
}
