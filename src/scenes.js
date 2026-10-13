// -----------------------------------------------------------------------------
// Scene action handlers (manifest `scene_actions`, Gladys 5.1+).
//
// A command Kodi has nothing to apply to (pause when nothing plays) is not an
// error of the scene: the action resolves `applied: false`, so the scene can
// go on or test it. An unreachable Kodi, or an unknown device, throws (the
// action fails, the scene continues and logs it).
//
// The triggers (`playback_started`...) are fired from Kodi's own
// notifications, whatever started the playback: a `play_media` action is
// followed by `playback_started` like a play from the remote. A scene that
// reacts to `playback_started` by starting a playback would loop: the
// documentation says so.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { CommandError } from './hub.js';
import { minutesLeftOf, progressOf } from './kodi/model.js';

const logger = createLogger({ name: 'kodi-scenes' });

export const PLAYBACK_COMMANDS = ['play', 'pause', 'play_pause', 'stop', 'next', 'previous'];
export const MUTE_MODES = ['mute', 'unmute', 'toggle'];
export const LIBRARIES = ['video', 'audio'];

// Defaults, mirrored by the manifest.
export const NOTIFICATION_DEFAULTS = { title: 'Gladys', duration: 5 };
export const NOTIFICATION_DURATION = { min: 2, max: 60 };
const MAX_TEXT = 1000;

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function number(value, fallback) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  return typeof value === 'string' ? Number(value.replace(',', '.')) : value;
}

async function applied(run, what) {
  try {
    await run();
    return { applied: true };
  } catch (err) {
    if (err instanceof CommandError && err.code === 'nothing_playing') {
      logger.info(`${what}: not applied (nothing playing)`);
      return { applied: false };
    }
    throw err;
  }
}

export const SCENE_ACTIONS = {
  control_playback(hub, { fields }) {
    const command = fields.command;
    if (!PLAYBACK_COMMANDS.includes(command)) {
      throw new Error(`Unknown playback command ${command}`);
    }
    return applied(
      () => hub.run(fields.device, (kodi) => kodi.playback(command)),
      `control_playback ${command}`,
    );
  },

  async set_volume(hub, { fields }) {
    const volume = hub.checkVolume(number(fields.volume, null));
    await hub.run(fields.device, (kodi) => kodi.setVolume(volume));
    return { volume };
  },

  async set_mute(hub, { fields }) {
    const mode = MUTE_MODES.includes(fields.mode) ? fields.mode : 'toggle';
    const mute = mode === 'toggle' ? 'toggle' : mode === 'mute';
    const muted = await hub.run(fields.device, (kodi) => kodi.setMute(mute));
    return { muted: muted === true };
  },

  async show_notification(hub, { fields }) {
    const message = text(fields.message).slice(0, MAX_TEXT);
    if (!message) {
      throw new CommandError('empty_message', hub.language);
    }
    const title = text(fields.title).slice(0, 200) || NOTIFICATION_DEFAULTS.title;
    const seconds = number(fields.duration, NOTIFICATION_DEFAULTS.duration);
    const duration = Number.isFinite(seconds)
      ? Math.min(NOTIFICATION_DURATION.max, Math.max(NOTIFICATION_DURATION.min, seconds))
      : NOTIFICATION_DEFAULTS.duration;
    await hub.run(fields.device, (kodi) => kodi.notify(title, message, duration));
  },

  async play_media(hub, { fields }) {
    const target = text(fields.target);
    if (!target || target.length > 2000) {
      throw new CommandError('empty_target', hub.language);
    }
    await hub.run(fields.device, (kodi) => kodi.open(target));
  },

  async scan_library(hub, { fields }) {
    const library = LIBRARIES.includes(fields.library) ? fields.library : 'video';
    await hub.run(fields.device, (kodi) => kodi.scanLibrary(library));
  },

  /** What Kodi does now, for the conditions of the following steps. */
  async get_status(hub, { fields }) {
    const entry = hub.entryOf(fields.device);
    await entry.kodi.refresh();
    const { snapshot } = entry.kodi;
    const active = snapshot.state === 'playing' || snapshot.state === 'paused';
    return {
      state: snapshot.state,
      title: active ? snapshot.title : '',
      media_type: active ? (snapshot.mediaType ?? '') : '',
      progress: progressOf(snapshot),
      minutes_left: minutesLeftOf(snapshot),
      volume: snapshot.volume ?? 0,
      muted: snapshot.muted === true,
    };
  },
};
