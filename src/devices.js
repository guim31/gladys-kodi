// -----------------------------------------------------------------------------
// Kodi instance -> Gladys device, and snapshot -> feature states.
//
// Before Gladys 5.3 (1.0.x), couples chosen among those the Gladys front knew
// (test/gladys-rules.test.js):
// - state, title, media_type: text/text (three of them: the dashboard then
//   shows their names);
// - progress: level-sensor/liquid-level-percent, the only read-only percent
//   couple with a label (precedent of gladys-ipp and gladys-octoprint);
// - time_left: duration/integer in minutes (duration/decimal is a slider);
// - stop: a television push button (the music category has no stop).
//
// Gladys 5.3 music player (capabilities/music.md, 1.1): the device is a
// player of the dashboard "Music" box. Same keys, so scenes and dashboards
// keep working once the user clicks "Update" in Discover:
// - play, pause, previous, next, volume, mute: television/* before, now
//   music/* (Gladys converts a feature found by its external id in place);
//   until the update, mute stays the 1.0 push button (a toggle, hub.js);
// - new: playback_state (writable: 0 pause, 1 play, 2 stop), artist, album,
//   artwork, duration, position (writable: a seek), shuffle, repeat, under the
//   SDK's `${device}:${type}` ids; the music title is `music_title` (the 1.0
//   `title` text, "Artist – Title" or "Nothing playing", stays as it is).
// The music features are published by publishNowPlaying (nowPlayingOf), the
// 1.0 texts and sensors by publishChangedStates (buildStates): one channel
// per feature.
//
// The structure does not depend on what Kodi plays nor on its version: the
// device is published as soon as an address is configured, even while Kodi is
// off. Feature keys are forever.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as CAT,
  DEVICE_FEATURE_TYPES as TYPE,
  DEVICE_FEATURE_UNITS as UNIT,
  MUSIC_PLAYBACK_STATE,
} from '@gladysassistant/integration-sdk';
import { ACTIVE_STATES, REPEAT_MODES, minutesLeftOf, progressOf } from './kodi/model.js';
import {
  MEDIA_LABELS,
  NAMES,
  NOTHING_PLAYING,
  SEASON,
  STATE_LABELS,
  UNKNOWN_TITLE,
} from './texts.js';

export const DEVICE_TYPE = 'kodi';

// The transport keys (push buttons), in the order of the device box.
export const BUTTONS = {
  play: { category: CAT.MUSIC, type: TYPE.MUSIC.PLAY },
  pause: { category: CAT.MUSIC, type: TYPE.MUSIC.PAUSE },
  stop: { category: CAT.TELEVISION, type: TYPE.TELEVISION.STOP },
  previous: { category: CAT.MUSIC, type: TYPE.MUSIC.PREVIOUS },
  next: { category: CAT.MUSIC, type: TYPE.MUSIC.NEXT },
};

// Feature key of each now-playing type whose key is not the type itself.
export const MUSIC_TITLE_KEY = 'music_title';

const MAX_MINUTES = 6_000; // 100 hours: a live stream has no end, it shows 0
const MAX_SECONDS = 86_400; // display bound of duration and position
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

  const music = (key, type, fields = {}) =>
    feature(key, { category: CAT.MUSIC, type, min: 0, max: 0, ...fields });
  const control = (key, type, max, fields = {}) =>
    music(key, type, { max, read_only: false, has_feedback: true, ...fields });

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
    // Kodi reports every volume change (Application.OnVolumeChanged).
    control('volume', TYPE.MUSIC.VOLUME, 100, { unit: UNIT.PERCENT }),
  ];
  for (const [key, { category, type }] of Object.entries(BUTTONS)) {
    features.push(feature(key, { category, type, min: 0, max: 1, read_only: false }));
  }
  features.push(
    control('mute', TYPE.MUSIC.MUTE, 1),
    control('playback_state', TYPE.MUSIC.PLAYBACK_STATE, MUSIC_PLAYBACK_STATE.IDLE),
    music(MUSIC_TITLE_KEY, TYPE.MUSIC.TITLE),
    music('artist', TYPE.MUSIC.ARTIST),
    music('album', TYPE.MUSIC.ALBUM),
    music('artwork', TYPE.MUSIC.ARTWORK),
    music('duration', TYPE.MUSIC.DURATION, { unit: UNIT.SECONDS, max: MAX_SECONDS }),
    control('position', TYPE.MUSIC.POSITION, MAX_SECONDS, { unit: UNIT.SECONDS }),
    control('shuffle', TYPE.MUSIC.SHUFFLE, 1),
    control('repeat', TYPE.MUSIC.REPEAT, 2),
  );

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
  return states;
}

/** `featureExternalIds` of publishNowPlaying: the music title is not `title`. */
export function nowPlayingFeatureIds(gladys, slot) {
  return { title: deviceIds(gladys, slot).feature(MUSIC_TITLE_KEY) };
}

/**
 * The publishNowPlaying snapshot of a Kodi snapshot (Gladys 5.3). Nothing
 * playing (stopped, off): IDLE and the texts cleared explicitly (an absent key
 * means "unchanged"). `artworkUrl`: the source of the cover, `null` when there
 * is none, `undefined` while it is being fetched (the previous one stays a
 * moment rather than a placeholder flash). Shuffle and repeat only exist while
 * a player runs: left unchanged otherwise. An unknown volume is left out.
 */
export function nowPlayingOf(snapshot, language, artworkUrl) {
  const nowPlaying = {};
  if (snapshot.volume !== null && snapshot.volume !== undefined) {
    nowPlaying.volume = Math.min(100, Math.max(0, snapshot.volume));
  }
  if (typeof snapshot.muted === 'boolean') {
    nowPlaying.mute = snapshot.muted;
  }
  if (!ACTIVE_STATES.has(snapshot.state)) {
    return {
      ...nowPlaying,
      playback_state: MUSIC_PLAYBACK_STATE.IDLE,
      title: '',
      artist: '',
      album: '',
      artwork_url: null,
      duration: 0,
      position: 0,
    };
  }
  const { music } = snapshot;
  let album = music.album;
  if (!album && music.season !== null) {
    album = pick(SEASON, language)(music.season);
  }
  Object.assign(nowPlaying, {
    playback_state:
      snapshot.state === 'paused' ? MUSIC_PLAYBACK_STATE.PAUSED : MUSIC_PLAYBACK_STATE.PLAYING,
    title: (music.title || snapshot.title || pick(UNKNOWN_TITLE, language)).slice(0, MAX_TEXT),
    artist: music.artist.slice(0, MAX_TEXT),
    album: album.slice(0, MAX_TEXT),
    // 0 for a live stream or a TV channel: the music box shows "Live".
    duration: snapshot.live || snapshot.total === null ? 0 : snapshot.total,
    position: snapshot.time ?? 0,
  });
  if (artworkUrl !== undefined) {
    nowPlaying.artwork_url = artworkUrl;
  }
  if (typeof snapshot.shuffled === 'boolean') {
    nowPlaying.shuffle = snapshot.shuffled;
  }
  if (snapshot.repeat !== null && snapshot.repeat !== undefined) {
    nowPlaying.repeat = REPEAT_MODES[snapshot.repeat];
  }
  return nowPlaying;
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
