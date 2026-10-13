// -----------------------------------------------------------------------------
// Kodi instance -> Gladys device, and snapshot -> feature states.
//
// Couples chosen among those the Gladys front knows (test/gladys-rules.test.js):
// - state, title, media_type: text/text (three of them: the dashboard then
//   shows their names);
// - progress: level-sensor/liquid-level-percent, the only read-only percent
//   couple with a label (precedent of gladys-ipp and gladys-octoprint);
// - time_left: duration/integer in minutes (duration/decimal is a slider);
// - volume: television/volume, the slider of the Gladys TV integrations;
// - mute, play, pause, stop, previous, next: television push buttons, shown
//   as remote-control keys (an icon per row, value 1). Not the music
//   category: its play/pause/next types have no row component in the
//   "devices in room" box and would show as numbers.
//
// The structure does not depend on what Kodi plays nor on its version: the
// device is published as soon as an address is configured, even while Kodi is
// off. Feature keys are forever.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as CAT,
  DEVICE_FEATURE_TYPES as TYPE,
  DEVICE_FEATURE_UNITS as UNIT,
} from '@gladysassistant/integration-sdk';
import { minutesLeftOf, progressOf } from './kodi/model.js';
import { MEDIA_LABELS, NAMES, NOTHING_PLAYING, STATE_LABELS, UNKNOWN_TITLE } from './texts.js';

export const DEVICE_TYPE = 'kodi';

// The remote-control keys, in the order of the device box.
export const BUTTONS = {
  play: TYPE.TELEVISION.PLAY,
  pause: TYPE.TELEVISION.PAUSE,
  stop: TYPE.TELEVISION.STOP,
  previous: TYPE.TELEVISION.PREVIOUS,
  next: TYPE.TELEVISION.NEXT,
  mute: TYPE.TELEVISION.VOLUME_MUTE,
};

const MAX_MINUTES = 6_000; // 100 hours: a live stream has no end, it shows 0
const MAX_TEXT = 200;

export function deviceIds(gladys, slot) {
  return gladys.externalIds(DEVICE_TYPE, String(slot));
}

export function defaultName(slot, friendlyName) {
  if (friendlyName) {
    return friendlyName.slice(0, 60);
  }
  return slot === 1 ? 'Kodi' : `Kodi ${slot}`;
}

/**
 * @param {object} gladys
 * @param {{ slot: number, httpUrl: string, friendlyName?: string|null }} instance
 * @param {string} language
 */
export function buildDevice(gladys, { slot, httpUrl, friendlyName }, language) {
  const names = NAMES[language] ?? NAMES.en;
  const ids = deviceIds(gladys, slot);
  const feature = (key, fields) => ({
    name: names[key],
    external_id: ids.feature(key),
    read_only: true,
    has_feedback: false,
    ...fields,
  });
  const text = { category: CAT.TEXT, type: TYPE.TEXT.TEXT, min: 0, max: 0 };

  const features = [
    feature('state', text),
    feature('title', text),
    feature('media_type', text),
    feature('progress', {
      category: CAT.LEVEL_SENSOR,
      type: TYPE.LEVEL_SENSOR.LIQUID_LEVEL_PERCENT,
      unit: UNIT.PERCENT,
      min: 0,
      max: 100,
    }),
    feature('time_left', {
      category: CAT.DURATION,
      type: TYPE.DURATION.INTEGER,
      unit: UNIT.MINUTES,
      min: 0,
      max: MAX_MINUTES,
    }),
    feature('volume', {
      category: CAT.TELEVISION,
      type: TYPE.TELEVISION.VOLUME,
      unit: UNIT.PERCENT,
      min: 0,
      max: 100,
      read_only: false,
      // Kodi reports every volume change (Application.OnVolumeChanged).
      has_feedback: true,
    }),
  ];
  for (const [key, type] of Object.entries(BUTTONS)) {
    features.push(
      feature(key, { category: CAT.TELEVISION, type, min: 0, max: 1, read_only: false }),
    );
  }

  return {
    name: defaultName(slot, friendlyName),
    external_id: ids.device,
    model: 'Kodi',
    should_poll: false,
    features,
    params: [{ name: 'KODI_URL', value: httpUrl }],
  };
}

const pick = (table, language) => table[language] ?? table.en;

/** The `title` state of a snapshot. */
export function titleText(snapshot, language) {
  if (snapshot.state === 'playing' || snapshot.state === 'paused') {
    return (snapshot.title || pick(UNKNOWN_TITLE, language)).slice(0, MAX_TEXT);
  }
  return pick(NOTHING_PLAYING, language);
}

/** The `media_type` state of a snapshot. */
export function mediaText(snapshot, language) {
  const labels = pick(MEDIA_LABELS, language);
  const active = snapshot.state === 'playing' || snapshot.state === 'paused';
  return active && snapshot.mediaType ? labels[snapshot.mediaType] : labels.none;
}

/**
 * Feature states of a snapshot, in the publishStates format. Progress in
 * whole percent and time left in whole minutes: they change a few times a
 * minute at most (Gladys takes 300 states a minute for the whole
 * integration). An unknown volume is left out (Gladys keeps the last one).
 */
export function buildStates(gladys, slot, snapshot, language) {
  const ids = deviceIds(gladys, slot);
  const states = [];
  const add = (key, value) => {
    if (value !== null && value !== undefined) {
      states.push({ device_feature_external_id: ids.feature(key), state: value });
    }
  };
  const addText = (key, value) => {
    states.push({ device_feature_external_id: ids.feature(key), text: value });
  };
  addText('state', pick(STATE_LABELS, language)[snapshot.state]);
  addText('title', titleText(snapshot, language));
  addText('media_type', mediaText(snapshot, language));
  add('progress', progressOf(snapshot));
  add('time_left', Math.min(MAX_MINUTES, minutesLeftOf(snapshot)));
  add('volume', snapshot.volume);
  return states;
}

/** `ext:...:kodi:2` -> 2, or null when the id is not one of ours. */
export function slotOf(gladys, externalId) {
  const prefix = gladys.externalId(`${DEVICE_TYPE}:`);
  if (typeof externalId !== 'string' || !externalId.startsWith(prefix)) {
    return null;
  }
  const slot = Number(externalId.slice(prefix.length).split(':')[0]);
  return Number.isInteger(slot) ? slot : null;
}

/** The feature key of a feature external id (`...:kodi:1:volume` -> `volume`). */
export function featureKeyOf(externalId) {
  return typeof externalId === 'string' ? externalId.split(':').at(-1) : '';
}
