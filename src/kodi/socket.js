// -----------------------------------------------------------------------------
// Kodi's JSON-RPC over WebSocket (`ws://<host>:9090/jsonrpc`): the same calls
// as over HTTP, plus the notifications Kodi pushes to every client
// (Player.OnPlay, OnPause, OnResume, OnStop, Application.OnVolumeChanged...).
//
// Checked on Kodi 20.1 and 21.3: no authentication on this port (Kodi only
// opens it to the network with "Allow remote control from applications on
// other systems"), one JSON object per frame, and nothing is sent while
// nothing happens — a ping every 30 s tells a dead link from a quiet one.
//
// Node 22+ ships WebSocket as a global: no dependency needed.
// -----------------------------------------------------------------------------

import { EventEmitter } from 'node:events';
import { createLogger } from '@gladysassistant/integration-sdk';
import { KodiError } from './http.js';

const logger = createLogger({ name: 'kodi-socket' });

export const DEFAULT_SOCKET_TIMINGS = {
  callTimeout: 5_000,
  // Kodi is silent at rest: ping it to notice a link that died quietly.
  pingInterval: 30_000,
  connectTimeout: 5_000,
  reconnectMin: 2_000,
  reconnectMax: 60_000,
};

/**
 * Emits `open`, `close` and `notification` (method, data). Reconnects by
 * itself until stop().
 */
export class KodiSocket extends EventEmitter {
  constructor({ wsUrl, createSocket = (url) => new WebSocket(url), timings = {} }) {
    super();
    this.url = wsUrl;
    this.createSocket = createSocket;
    this.timings = { ...DEFAULT_SOCKET_TIMINGS, ...timings };
    this.socket = null;
    this.running = false;
    this.live = false;
    this.failures = 0;
    this.nextId = 1;
    this.pending = new Map();
    this.retryTimer = null;
    this.pingTimer = null;
    this.connectTimer = null;
  }

  start() {
    if (this.running) {
      return;
    }
    this.running = true;
    this.#open();
  }

  stop() {
    this.running = false;
    clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.#drop('stopped');
  }

  /** Reconnect now (Kodi was seen back over HTTP, no need to wait the backoff). */
  retryNow() {
    if (!this.running || this.socket || !this.retryTimer) {
      return;
    }
    clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.#open();
  }

  /**
   * One JSON-RPC call over the socket. Throws a KodiError when the socket is
   * not open, closes, or Kodi does not answer in time.
   */
  call(method, params) {
    const socket = this.socket;
    if (!this.live || !socket) {
      return Promise.reject(new KodiError('unreachable', 'WebSocket not connected'));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new KodiError('unreachable', `${method}: no answer over the WebSocket`));
      }, this.timings.callTimeout);
      timer.unref?.();
      this.pending.set(id, { resolve, reject, timer, method });
      try {
        socket.send(JSON.stringify({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) }));
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new KodiError('unreachable', `${method}: ${err.message}`));
      }
    });
  }

  #open() {
    let socket;
    try {
      socket = this.createSocket(this.url);
    } catch (err) {
      this.#scheduleRetry(err.message);
      return;
    }
    this.socket = socket;
    this.connectTimer = setTimeout(() => {
      if (this.socket === socket && !this.live) {
        this.#drop('connection timeout');
        this.#scheduleRetry('connection timeout');
      }
    }, this.timings.connectTimeout);
    this.connectTimer.unref?.();
    socket.onopen = () => {
      if (this.socket !== socket) {
        return;
      }
      clearTimeout(this.connectTimer);
      this.failures = 0;
      this.live = true;
      this.#armPing();
      this.emit('open');
    };
    socket.onmessage = (event) => this.#receive(socket, event.data);
    socket.onerror = () => {
      // The close event follows and carries the retry.
    };
    socket.onclose = () => {
      if (this.socket !== socket) {
        return;
      }
      this.#drop('socket closed');
      this.#scheduleRetry('socket closed');
    };
  }

  #receive(socket, raw) {
    if (this.socket !== socket) {
      return;
    }
    let message;
    try {
      message = JSON.parse(typeof raw === 'string' ? raw : raw.toString());
    } catch {
      return;
    }
    if (!message || typeof message !== 'object') {
      return;
    }
    if (message.id !== undefined && message.id !== null) {
      const pending = this.pending.get(message.id);
      if (!pending) {
        return;
      }
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) {
        pending.reject(
          new KodiError('rpc', `${pending.method}: ${message.error.message ?? 'error'}`, {
            code: message.error.code,
          }),
        );
      } else {
        pending.resolve(message.result);
      }
      return;
    }
    if (typeof message.method === 'string') {
      this.emit('notification', message.method, message.params?.data ?? null);
    }
  }

  #armPing() {
    clearTimeout(this.pingTimer);
    this.pingTimer = setTimeout(async () => {
      const socket = this.socket;
      try {
        await this.call('JSONRPC.Ping');
      } catch {
        if (this.socket === socket && this.live) {
          // The instance logs the loss ("WebSocket closed") once.
          logger.debug(`No answer from ${this.url}, reconnecting`);
          this.#drop('no answer to ping');
          this.#scheduleRetry('no answer to ping');
        }
        return;
      }
      if (this.socket === socket && this.live) {
        this.#armPing();
      }
    }, this.timings.pingInterval);
    this.pingTimer.unref?.();
  }

  #drop(reason) {
    clearTimeout(this.pingTimer);
    clearTimeout(this.connectTimer);
    this.pingTimer = null;
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onclose = null;
      socket.onerror = null;
      try {
        socket.close();
      } catch {
        // already closed
      }
    }
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new KodiError('unreachable', `${pending.method}: ${reason}`));
      this.pending.delete(id);
    }
    if (this.live) {
      this.live = false;
      this.emit('close');
    }
  }

  #scheduleRetry(reason) {
    if (!this.running) {
      return;
    }
    this.failures += 1;
    const delay = Math.min(
      this.timings.reconnectMax,
      this.timings.reconnectMin * 2 ** Math.min(this.failures - 1, 10),
    );
    if (this.failures === 1 || this.failures % 20 === 0) {
      logger.debug(`WebSocket ${this.url} down (${reason}), retrying in ${delay} ms`);
    }
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.running && !this.socket) {
        this.#open();
      }
    }, delay);
    this.retryTimer.unref?.();
  }
}
