// -----------------------------------------------------------------------------
// Registers every SDK handler on a GladysIntegration (or the SDK's fake Gladys
// in the tests) and returns the hub, so index.js stays a few lines and the
// tests drive the very same wiring.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { Catalog } from './catalog.js';
import { normalizeConfig } from './config.js';
import { Hub } from './hub.js';
import { SCENE_ACTIONS } from './scenes.js';
import { Store } from './store.js';
import { INIT_FAILED } from './texts.js';
import { WIDGETS } from './widgets.js';

const logger = createLogger({ name: 'kodi-app' });

/**
 * @param {object} gladys GladysIntegration instance
 * @param {object} [options] test seams: store, fetch, createSocket, timings,
 *   socketTimings, resolve (host names -> IPv4), now
 */
export function registerHandlers(gladys, options = {}) {
  const hub = new Hub({
    gladys,
    store: options.store ?? new Store(),
    fetch: options.fetch,
    createSocket: options.createSocket,
    timings: options.timings,
    socketTimings: options.socketTimings,
    resolve: options.resolve,
    now: options.now,
  });

  // Resolved once the hub has started; every handler waits for it, so a
  // command arriving during the start is not lost.
  let resolveReady;
  const ready = new Promise((resolve) => {
    resolveReady = resolve;
  });
  let started = false;
  const whenReady =
    (fn) =>
    async (...args) => {
      await ready;
      return fn(...args);
    };

  gladys.on('connected', async () => {
    try {
      const raw = await gladys.getConfig();
      const config = normalizeConfig(raw);
      if (started) {
        // A reconnection (Gladys restarted): re-sync what Gladys may have lost.
        await hub.resync(config, raw);
        return;
      }
      started = true;
      await hub.start(config, raw);
    } catch (err) {
      logger.error('Initialization failed', err);
      await gladys.setConnectionStatus(false, INIT_FAILED).catch(() => {});
    } finally {
      resolveReady();
    }
  });

  // A scan from the Discovery tab also looks for Kodi on the network.
  gladys.onScanRequest(
    whenReady(async () => {
      await hub
        .discover()
        .catch((err) => logger.warn(`Search on the network failed: ${err.message}`));
      await hub.publishDevices();
    }),
  );
  gladys.onSetValue(whenReady((device, feature, value) => hub.setValue(device, feature, value)));
  // The devices are published with should_poll: false (Kodi pushes its
  // changes); this only serves a Gladys that would poll anyway.
  gladys.onPoll(whenReady((device) => hub.poll(device)));
  gladys.onDeviceCreated(whenReady((device) => hub.onDeviceCreated(device)));
  // "Update" in Discover (the music features of 1.1 on a 1.0 device): the SDK
  // forgot what it published, the hub publishes everything again.
  gladys.onDeviceUpdated(whenReady((device) => hub.onDeviceCreated(device)));
  gladys.onConfigUpdated(whenReady((config) => hub.reconfigure(normalizeConfig(config), config)));

  gladys.onAction(
    'find_kodi',
    whenReady(() => hub.discover()),
  );
  gladys.onAction(
    'test_connection',
    whenReady(() => hub.testReport()),
  );

  for (const [key, handler] of Object.entries(SCENE_ACTIONS)) {
    gladys.onSceneAction(
      key,
      whenReady((fields) => handler(hub, { fields })),
    );
  }

  for (const [key, widget] of Object.entries(WIDGETS)) {
    gladys.onWidgetGet(
      key,
      whenReady((request) => widget.get(hub, request)),
    );
    gladys.onWidgetAction(
      key,
      whenReady((actionKey, params, context = {}) =>
        widget.action(hub, { actionKey, params, ...context }),
      ),
    );
  }
  gladys.onWidgetGetImage(whenReady((imageKey) => hub.widgetImage(imageKey)));

  // Gladys 5.3 music player: the catalog panel and the artworks (manifest
  // `music`). The artworks are read with the credentials of their Kodi, never
  // by the SDK's default handler.
  const catalog = new Catalog(hub);
  gladys.onMusicBrowse(whenReady((device, options) => catalog.browse(device, options)));
  gladys.onMusicSearch(whenReady((device, options) => catalog.search(device, options)));
  gladys.onMusicPlay(whenReady((device, media, mode) => catalog.play(device, media, mode)));
  gladys.onMusicQueueGet(whenReady((device, options) => catalog.queueGet(device, options)));
  gladys.onMusicQueuePlay(whenReady((device, index) => catalog.queuePlay(device, index)));
  gladys.onMusicGetArtwork(whenReady((key) => hub.musicArtwork(key)));

  return {
    hub,
    catalog,
    ready,
    stop: () => hub.stop(),
  };
}
