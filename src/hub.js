// -----------------------------------------------------------------------------
// The hub: one KodiInstance per configured slot, and everything Gladys sees of
// them — devices, states, connection status, scene events, commands, artwork,
// the search on the network.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { createLogger } from '@gladysassistant/integration-sdk';
import { SLOTS, normalizeConfig } from './config.js';
import { BUTTONS, buildDevice, buildStates, deviceIds, featureKeyOf, slotOf } from './devices.js';
import { addressOf, parseKodiEntries, planSlots } from './discovery.js';
import { CommandRefused, KodiInstance } from './instance.js';
import { KodiError } from './kodi/http.js';
import {
  DISCOVERY_TEXT,
  MEDIA_LABELS,
  STATE_LABELS,
  STATUS_TEXT,
  TEST_TEXT,
  UNKNOWN_TITLE,
  commandMessage,
} from './texts.js';

const logger = createLogger({ name: 'kodi-hub' });

export const WIDGET_KEY = 'player';

// Scene trigger keys (manifest `scene_triggers`), by playback event type.
export const TRIGGERS = {
  started: 'playback_started',
  paused: 'playback_paused',
  resumed: 'playback_resumed',
  stopped: 'playback_stopped',
};

// The core refuses a widget image over 300 KB (decoded).
export const MAX_IMAGE_BYTES = 300 * 1024;

// requestWidgetRefresh is dropped by the core beyond one call per 10 s.
const WIDGET_REFRESH_GAP_MS = 10_500;

const MDNS_TIMEOUT_SECONDS = 5;

/** An Error carrying a coded, multi-language message. */
export class CommandError extends Error {
  constructor(code, language) {
    const message = commandMessage(code);
    super(message[language] ?? message.en);
    this.code = code;
    this.messages = message;
  }
}

/** Which image a magic number says (the core accepts these three). */
export function imageType(bytes) {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'jpeg';
  }
  if (bytes.length > 8 && bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) {
    return 'png';
  }
  if (
    bytes.length > 12 &&
    bytes.subarray(0, 4).toString('latin1') === 'RIFF' &&
    bytes.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'webp';
  }
  return null;
}

export class Hub {
  constructor({ gladys, store, fetch, createSocket, timings, socketTimings, now = Date.now }) {
    this.gladys = gladys;
    this.store = store;
    this.fetch = fetch;
    this.createSocket = createSocket;
    this.timings = timings;
    this.socketTimings = socketTimings;
    this.now = now;
    this.config = { instances: [], invalidSlots: [], language: 'fr' };
    this.rawConfig = {};
    // slot -> { slot, settings, kodi }
    this.instances = new Map();
    this.saved = { names: {} };
    // url -> { key, base64 } | { failed: true }; key -> url
    this.artwork = new Map();
    this.artworkKeys = new Map();
    this.lastStatus = '';
    this.widgetRefreshAt = 0;
    this.widgetTimer = null;
    this.stopped = false;
  }

  get language() {
    return this.config.language;
  }

  async start(config, rawConfig) {
    const saved = await this.store.load();
    this.saved = {
      names: saved?.names && typeof saved.names === 'object' ? saved.names : {},
      searched: saved?.searched === true,
    };
    await this.reconfigure(config, rawConfig);
    if (
      this.instances.size === 0 &&
      this.config.invalidSlots.length === 0 &&
      !this.saved.searched
    ) {
      // First start without any address: look for Kodi once by ourselves.
      this.saved.searched = true;
      this.#save();
      await this.discover().catch((err) =>
        logger.warn(`Search on the network failed: ${err.message}`),
      );
    }
  }

  /** New configuration: restart the instances whose address or credentials changed. */
  async reconfigure(config, rawConfig) {
    const languageChanged = config.language !== this.config.language;
    this.config = config;
    if (rawConfig) {
      this.rawConfig = { ...rawConfig };
    }
    const wanted = new Map(config.instances.map((settings) => [settings.slot, settings]));
    for (const [slot, entry] of this.instances) {
      const next = wanted.get(slot);
      if (
        !next ||
        next.httpUrl !== entry.settings.httpUrl ||
        next.username !== entry.settings.username ||
        next.password !== entry.settings.password
      ) {
        entry.kodi.stop();
        this.instances.delete(slot);
      }
    }
    for (const [slot, settings] of wanted) {
      if (!this.instances.has(slot)) {
        this.#addInstance(settings);
      }
    }
    await this.publishDevices();
    if (languageChanged) {
      await this.publishAllStates();
    }
    await this.updateConnectionStatus();
    this.refreshWidget();
  }

  /** Gladys reconnected (it may have restarted): send everything again. */
  async resync(config, rawConfig) {
    this.gladys.forgetPublishedStates?.();
    await this.reconfigure(config, rawConfig);
    await this.publishAllStates();
    this.lastStatus = '';
    await this.updateConnectionStatus();
  }

  stop() {
    this.stopped = true;
    for (const entry of this.instances.values()) {
      entry.kodi.stop();
    }
    clearTimeout(this.widgetTimer);
    return this.store.flush();
  }

  #addInstance(settings) {
    const kodi = new KodiInstance({
      ...settings,
      fetch: this.fetch,
      createSocket: this.createSocket,
      timings: this.timings,
      socketTimings: this.socketTimings,
    });
    const saved = this.saved.names[settings.slot];
    if (saved?.url === settings.httpUrl && typeof saved.name === 'string') {
      kodi.friendlyName = saved.name;
    }
    const entry = { slot: settings.slot, settings, kodi };
    this.instances.set(settings.slot, entry);
    kodi.on('update', (snapshot, previous) => this.#onUpdate(entry, snapshot, previous));
    kodi.on('playback', (event) => this.#onPlayback(entry, event));
    kodi.on('info', () => this.#onInfo(entry));
    kodi.on('connection', () => {
      this.updateConnectionStatus();
      this.refreshWidget();
    });
    kodi.start();
  }

  #isCurrent(entry) {
    return !this.stopped && this.instances.get(entry.slot) === entry;
  }

  // --- Devices and states -------------------------------------------------

  #deviceOf(entry) {
    return buildDevice(
      this.gladys,
      { slot: entry.slot, httpUrl: entry.settings.httpUrl, friendlyName: entry.kodi.friendlyName },
      this.language,
    );
  }

  buildDevices() {
    return [...this.instances.values()]
      .sort((a, b) => a.slot - b.slot)
      .map((entry) => this.#deviceOf(entry));
  }

  async publishDevices() {
    if (this.stopped) {
      return;
    }
    try {
      await this.gladys.publishDiscoveredDevices(this.buildDevices());
    } catch (err) {
      logger.error('Cannot publish the devices', err);
    }
  }

  async #onInfo(entry) {
    if (!this.#isCurrent(entry) || !entry.kodi.friendlyName) {
      return;
    }
    const saved = this.saved.names[entry.slot];
    if (saved?.name !== entry.kodi.friendlyName || saved?.url !== entry.settings.httpUrl) {
      this.saved.names[entry.slot] = { url: entry.settings.httpUrl, name: entry.kodi.friendlyName };
      this.#save();
      await this.publishDevices();
    }
  }

  #save() {
    this.store.save({ names: this.saved.names, searched: this.saved.searched === true });
  }

  async #onUpdate(entry, snapshot, previous) {
    if (!this.#isCurrent(entry)) {
      return;
    }
    await this.#publishStates(entry);
    if (snapshot.art.join('|') !== previous.art.join('|')) {
      this.#prefetchArtwork(entry, snapshot.art);
    }
    if (
      snapshot.state !== previous.state ||
      snapshot.title !== previous.title ||
      snapshot.volume !== previous.volume ||
      snapshot.muted !== previous.muted
    ) {
      this.refreshWidget();
    }
  }

  async #publishStates(entry) {
    if (!this.#isCurrent(entry)) {
      return;
    }
    const states = buildStates(this.gladys, entry.slot, entry.kodi.snapshot, this.language);
    try {
      await this.gladys.publishChangedStates(states);
    } catch (err) {
      logger.warn(`Cannot publish the states of Kodi ${entry.slot}: ${err.message}`);
    }
  }

  async publishAllStates() {
    for (const entry of this.instances.values()) {
      await this.#publishStates(entry);
    }
  }

  /** The user added a device: states sent before were dropped by Gladys. */
  async onDeviceCreated(device) {
    const entry = this.instances.get(slotOf(this.gladys, device?.external_id));
    if (!entry) {
      return;
    }
    this.gladys.forgetPublishedStates?.(device.external_id);
    await this.#publishStates(entry);
    this.refreshWidget();
  }

  // --- Scene events ---------------------------------------------------------

  async #onPlayback(entry, event) {
    const key = TRIGGERS[event.type];
    if (!key || !this.#isCurrent(entry)) {
      return;
    }
    const { snapshot } = event;
    const labels = MEDIA_LABELS[this.language] ?? MEDIA_LABELS.en;
    const data = {
      device: deviceIds(this.gladys, entry.slot).device,
      kodi: this.deviceName(entry),
      media_type: snapshot.mediaType ?? 'video',
      media_label: labels[snapshot.mediaType ?? 'video'],
      title: snapshot.title || (UNKNOWN_TITLE[this.language] ?? UNKNOWN_TITLE.en),
    };
    if (event.type === 'stopped') {
      data.ended = event.ended === true;
    }
    logger.info(`Kodi ${entry.slot}: playback ${event.type} (${data.media_type})`);
    try {
      await this.gladys.publishSceneEvent(key, data);
    } catch (err) {
      logger.warn(`Cannot fire ${key}: ${err.message}`);
    }
    this.refreshWidget();
  }

  /** The name of the device in Gladys (the user may have renamed it). */
  deviceName(entry) {
    const created = (this.gladys.devices ?? []).find(
      (device) => device.external_id === deviceIds(this.gladys, entry.slot).device,
    );
    return created?.name ?? this.#deviceOf(entry).name;
  }

  isCreated(slot) {
    const id = deviceIds(this.gladys, slot).device;
    return (this.gladys.devices ?? []).some((device) => device.external_id === id);
  }

  // --- Widget -------------------------------------------------------------

  /** Nudge the open dashboards, with a trailing call inside the core's 10 s gap. */
  refreshWidget() {
    if (this.stopped) {
      return;
    }
    const wait = this.widgetRefreshAt + WIDGET_REFRESH_GAP_MS - this.now();
    if (wait <= 0) {
      this.widgetRefreshAt = this.now();
      this.gladys.requestWidgetRefresh(WIDGET_KEY);
      return;
    }
    if (!this.widgetTimer) {
      this.widgetTimer = setTimeout(() => {
        this.widgetTimer = null;
        this.refreshWidget();
      }, wait);
      this.widgetTimer.unref?.();
    }
  }

  /**
   * Fetch the artwork of a new item once, keep the first image Kodi serves
   * under the core's limit, then nudge the widget. Kodi only serves the art
   * of its library (its texture cache): a file played outside has none.
   */
  async #prefetchArtwork(entry, urls) {
    for (const url of urls) {
      const known = this.artwork.get(url);
      if (known?.key) {
        return;
      }
      if (known?.failed) {
        continue;
      }
      try {
        const { bytes } = await entry.kodi.artwork([url], MAX_IMAGE_BYTES);
        if (!imageType(bytes)) {
          throw new Error('not a JPEG, PNG or WebP image');
        }
        const key = `cover-${createHash('sha256').update(bytes).digest('hex').slice(0, 24)}`;
        this.#rememberArtwork(url, { key, base64: bytes.toString('base64') });
        this.artworkKeys.set(key, url);
        if (this.#isCurrent(entry)) {
          this.refreshWidget();
        }
        return;
      } catch (err) {
        logger.debug(`Kodi ${entry.slot}: no artwork from ${url} (${err.message})`);
        // A temporary failure (Kodi busy) is retried with the next item only.
        this.#rememberArtwork(url, { failed: true });
      }
    }
  }

  #rememberArtwork(url, value) {
    this.artwork.delete(url);
    this.artwork.set(url, value);
    // A few covers are enough: the current item of three Kodi, and recent ones.
    while (this.artwork.size > 12) {
      const [oldest, entry] = this.artwork.entries().next().value;
      this.artwork.delete(oldest);
      if (entry.key) {
        this.artworkKeys.delete(entry.key);
      }
    }
  }

  /** The image key of what an instance plays, once fetched. */
  artworkKey(entry) {
    for (const url of entry.kodi.snapshot.art) {
      const known = this.artwork.get(url);
      if (known?.key) {
        return known.key;
      }
    }
    return null;
  }

  /** onWidgetGetImage: the raw base64 of a cover key. */
  widgetImage(key) {
    const url = this.artworkKeys.get(key);
    const known = url ? this.artwork.get(url) : null;
    if (!known?.base64) {
      throw new Error(`Unknown image ${key}`);
    }
    return known.base64;
  }

  // --- Connection status --------------------------------------------------

  statusMessage() {
    const lines = Object.fromEntries(Object.keys(STATUS_TEXT).map((language) => [language, []]));
    const add = (key, slot) => {
      for (const [language, table] of Object.entries(STATUS_TEXT)) {
        lines[language].push(table[key](slot));
      }
    };
    for (const slot of this.config.invalidSlots) {
      add('invalid', slot);
    }
    for (const slot of SLOTS) {
      const kodi = this.instances.get(slot)?.kodi;
      if (!kodi) {
        continue;
      }
      if (kodi.unauthorized) {
        add('unauthorized', slot);
      } else if (!kodi.reachable && kodi.lastError) {
        // Only once an attempt failed (a fresh start says nothing yet).
        add('unreachable', slot);
      } else if (kodi.reachable && kodi.httpError === 'unauthorized') {
        add('artwork', slot);
      }
    }
    if (this.instances.size === 0 && this.config.invalidSlots.length === 0) {
      for (const [language, table] of Object.entries(STATUS_TEXT)) {
        lines[language].push(table.none);
      }
    }
    if (lines.en.length === 0) {
      return null;
    }
    return Object.fromEntries(
      Object.entries(lines).map(([language, list]) => [language, list.join(' ').slice(0, 500)]),
    );
  }

  async updateConnectionStatus() {
    if (this.stopped) {
      return;
    }
    const message = this.statusMessage();
    const instances = [...this.instances.values()].map((entry) => entry.kodi);
    const connected = instances.some((kodi) => kodi.reachable && !kodi.unauthorized);
    // An instance still on its first attempt, nothing known yet: wait.
    if (!connected && message === null && instances.some((kodi) => !kodi.lastError)) {
      return;
    }
    const fingerprint = JSON.stringify({ connected, message });
    if (fingerprint === this.lastStatus) {
      return;
    }
    this.lastStatus = fingerprint;
    try {
      await this.gladys.setConnectionStatus(connected, message ?? undefined);
    } catch (err) {
      logger.warn(`Cannot set the connection status: ${err.message}`);
    }
  }

  // --- Commands -------------------------------------------------------------

  entryOf(externalId) {
    const entry = this.instances.get(slotOf(this.gladys, externalId));
    if (!entry) {
      throw new CommandError('unknown_device', this.language);
    }
    return entry;
  }

  /**
   * Run `action(kodi)` on the Kodi of a device external id; Kodi's refusals
   * become CommandErrors (coded, multi-language).
   */
  async run(externalId, action) {
    const entry = this.entryOf(externalId);
    try {
      return await action(entry.kodi);
    } catch (err) {
      if (err instanceof CommandRefused) {
        throw new CommandError(err.code, this.language);
      }
      if (err instanceof KodiError) {
        const code =
          err.kind === 'unauthorized'
            ? 'unauthorized'
            : err.kind === 'unreachable'
              ? 'unreachable'
              : 'refused';
        logger.warn(`Kodi ${entry.slot}: command failed (${err.message})`);
        throw new CommandError(code, this.language);
      }
      throw err;
    }
  }

  checkVolume(value) {
    const number = typeof value === 'string' ? Number(value.replace(',', '.')) : value;
    if (typeof number !== 'number' || !Number.isFinite(number) || number < 0 || number > 100) {
      throw new CommandError('out_of_range', this.language);
    }
    return Math.round(number);
  }

  /** onSetValue: the volume slider and the remote-control keys. */
  async setValue(device, feature, value) {
    const key = featureKeyOf(feature?.external_id);
    if (key === 'volume') {
      const volume = this.checkVolume(value);
      await this.run(device.external_id, (kodi) => kodi.setVolume(volume));
      return;
    }
    if (key === 'mute') {
      await this.run(device.external_id, (kodi) => kodi.setMute('toggle'));
      return;
    }
    if (key in BUTTONS) {
      await this.run(device.external_id, (kodi) => kodi.playback(key));
      return;
    }
    throw new Error(`Feature ${key} cannot be controlled`);
  }

  /** onPoll (the devices are not polled; this only serves a Gladys that would). */
  async poll(device) {
    await this.instances.get(slotOf(this.gladys, device?.external_id))?.kodi.refresh();
  }

  // --- "Find Kodi on the network" -----------------------------------------

  /**
   * Browse mDNS through the core, fill the free slots with what is found and
   * restart with them. Resolves the message shown under the action button.
   */
  async discover() {
    let entries;
    try {
      entries = await this.gladys.scanNetwork('mdns', { timeoutSeconds: MDNS_TIMEOUT_SECONDS });
    } catch (err) {
      logger.warn(`mDNS search unavailable: ${err.message}`);
      return discoveryText('unavailable');
    }
    const found = parseKodiEntries(entries);
    logger.info(`mDNS search: ${found.length} Kodi found`);
    if (found.length === 0) {
      return discoveryText('none');
    }
    const plan = planSlots(this.rawConfig, found);
    if (Object.keys(plan.updates).length > 0) {
      // Validated by Gladys against the schema; no config-updated echo.
      await this.gladys.setConfig(plan.updates);
      this.rawConfig = { ...this.rawConfig, ...plan.updates };
      for (const kodi of plan.added) {
        logger.info(`Kodi "${kodi.name}" found at ${addressOf(kodi)}, saved in slot ${kodi.slot}`);
      }
      await this.reconfigure(normalizeConfig(this.rawConfig));
    }
    const describe = (list) =>
      list.map((kodi) => `${kodi.name || 'Kodi'} (${addressOf(kodi)})`).join(', ');
    const parts = [];
    if (plan.added.length > 0) {
      parts.push(['added', describe(plan.added)]);
    }
    if (plan.known.length > 0) {
      parts.push(['known', describe(plan.known)]);
    }
    if (plan.full.length > 0) {
      parts.push(['full', describe(plan.full)]);
    }
    return Object.fromEntries(
      Object.entries(DISCOVERY_TEXT).map(([language, table]) => [
        language,
        parts
          .map(([key, list]) => table[key](list))
          .join(' ')
          .slice(0, 500),
      ]),
    );
  }

  // --- "Test the connection" ----------------------------------------------

  async testReport() {
    if (this.instances.size === 0) {
      return Object.fromEntries(Object.entries(TEST_TEXT).map(([lang, t]) => [lang, t.none]));
    }
    const lines = Object.fromEntries(Object.keys(TEST_TEXT).map((language) => [language, []]));
    for (const entry of [...this.instances.values()].sort((a, b) => a.slot - b.slot)) {
      const { kodi } = entry;
      await kodi.refresh().catch(() => {});
      for (const [language, table] of Object.entries(TEST_TEXT)) {
        if (kodi.unauthorized) {
          lines[language].push(table.unauthorized(entry.slot));
          continue;
        }
        if (!kodi.reachable) {
          lines[language].push(table.failed(entry.slot));
          continue;
        }
        const state = STATE_LABELS[language][kodi.snapshot.state].toLowerCase();
        lines[language].push(
          table.ok(entry.slot, this.deviceName(entry), kodi.version ?? '?', state),
        );
        if (!kodi.wsLive) {
          lines[language].push(table.noSocket(entry.slot));
        }
      }
    }
    return Object.fromEntries(
      Object.entries(lines).map(([language, list]) => [language, list.join(' ').slice(0, 1000)]),
    );
  }
}

function discoveryText(key) {
  return Object.fromEntries(
    Object.entries(DISCOVERY_TEXT).map(([language, table]) => [language, table[key]]),
  );
}
