// -----------------------------------------------------------------------------
// Dashboard widget (manifest `widgets`, Gladys 5.1+): `player`, "Kodi".
//
// What it adds to the device box: the artwork of what plays, its title, the
// position and the end time, and the four buttons that matter for this media
// — play/pause, stop (video) or next (music), volume down and up.
//
// Budget (8 components: 1 focal, 2 texts, 1 status, 4 buttons): artwork,
// heading, caption, status list, four buttons — exactly 8. Without artwork
// (a file played outside the library), the progress gauge takes the place.
// No button opens a form, so Gladys 5.1 is enough.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { deviceIds } from './devices.js';
import { CommandError, WIDGET_KEY } from './hub.js';
import { minutesLeftOf } from './kodi/model.js';
import {
  DONE_TEXT,
  MEDIA_LABELS,
  NOTHING_PLAYING,
  STATE_LABELS,
  UNKNOWN_TITLE,
  formatMinutes,
  formatPosition,
} from './texts.js';

export { WIDGET_KEY };

// One step of the volume buttons, in percent.
export const VOLUME_STEP = 5;

export const TEXT = {
  pick: {
    en: 'Choose a Kodi in the widget settings.',
    fr: 'Choisissez un Kodi dans les réglages du widget.',
    de: 'Wähle ein Kodi in den Widget-Einstellungen.',
    es: 'Elija un Kodi en los ajustes del widget.',
  },
  unknown: {
    en: 'This Kodi is not configured in the integration anymore.',
    fr: "Ce Kodi n'est plus configuré dans l'intégration.",
    de: 'Dieses Kodi ist in der Integration nicht mehr eingerichtet.',
    es: 'Este Kodi ya no está configurado en la integración.',
  },
  state: { en: 'State', fr: 'État', de: 'Status', es: 'Estado' },
  position: { en: 'Position', fr: 'Position', de: 'Position', es: 'Posición' },
  ends: { en: 'Ends at', fr: 'Fin vers', de: 'Endet um', es: 'Termina a las' },
  left: { en: 'Time left', fr: 'Restant', de: 'Restzeit', es: 'Restante' },
  volume: { en: 'Volume', fr: 'Volume', de: 'Lautstärke', es: 'Volumen' },
  muted: { en: 'muted', fr: 'coupé', de: 'stumm', es: 'silenciado' },
  progress: { en: 'Progress', fr: 'Progression', de: 'Fortschritt', es: 'Progreso' },
  play: { en: 'Play', fr: 'Lire', de: 'Abspielen', es: 'Reproducir' },
  pause: { en: 'Pause', fr: 'Pause', de: 'Pause', es: 'Pausa' },
  stop: { en: 'Stop', fr: 'Stop', de: 'Stopp', es: 'Detener' },
  next: { en: 'Next', fr: 'Suivant', de: 'Weiter', es: 'Siguiente' },
  volume_down: { en: 'Volume −', fr: 'Volume −', de: 'Leiser', es: 'Volumen −' },
  volume_up: { en: 'Volume +', fr: 'Volume +', de: 'Lauter', es: 'Volumen +' },
  cover: { en: 'Artwork', fr: 'Pochette', de: 'Cover', es: 'Carátula' },
};

export const WIDGET_ACTIONS = ['play_pause', 'stop', 'next', 'volume_down', 'volume_up'];

const STATE_COLORS = {
  off: WIDGET_COLORS.NEUTRAL,
  stopped: WIDGET_COLORS.NEUTRAL,
  playing: WIDGET_COLORS.SUCCESS,
  paused: WIDGET_COLORS.WARNING,
};

const pick = (table, language) => table[language] ?? table.en;
const textOnly = (text, ttl = 60) => ({
  ttl_seconds: ttl,
  components: [{ type: 'text', variant: 'body', text }],
});

function clockTime(date, language) {
  try {
    return date.toLocaleTimeString(language, { hour: '2-digit', minute: '2-digit' });
  } catch {
    return date.toISOString().slice(11, 16);
  }
}

function button(language, key, icon, label = key) {
  return { type: 'button', label: pick(TEXT[label], language), icon, action: { key } };
}

/**
 * The widget content for a Kodi.
 * @param {object} hub
 * @param {{ settings?: object, language?: string }} request
 */
export function buildContent(hub, { settings = {}, language = 'en' }) {
  const lang = STATE_LABELS[language] ? language : 'en';
  if (typeof settings.device !== 'string' || settings.device === '') {
    return textOnly(pick(TEXT.pick, lang), 300);
  }
  const entry = [...hub.instances.values()].find(
    (candidate) => deviceIds(hub.gladys, candidate.slot).device === settings.device,
  );
  if (!entry) {
    return textOnly(pick(TEXT.unknown, lang), 300);
  }
  const { snapshot } = entry.kodi;
  const active = snapshot.state === 'playing' || snapshot.state === 'paused';
  const components = [];

  const artwork = active ? hub.artworkKey(entry) : null;
  if (artwork) {
    components.push({ type: 'image', key: artwork, alt: pick(TEXT.cover, lang), fit: 'contain' });
  } else if (active && snapshot.total !== null && hub.isCreated(entry.slot)) {
    components.push({
      type: 'gauge',
      label: pick(TEXT.progress, lang),
      device_feature: deviceIds(hub.gladys, entry.slot).feature('progress'),
      color: WIDGET_COLORS.PRIMARY,
    });
  }

  const title = active ? snapshot.title || pick(UNKNOWN_TITLE, lang) : pick(NOTHING_PLAYING, lang);
  components.push({ type: 'text', variant: 'heading', text: title.slice(0, 40) });
  const caption = [hub.deviceName(entry)];
  if (active && snapshot.mediaType) {
    caption.unshift(pick(MEDIA_LABELS, lang)[snapshot.mediaType]);
  }
  if (title.length > 40) {
    // The heading is cut at 40 characters: the caption gives the end.
    caption.unshift(title);
  }
  components.push({ type: 'text', variant: 'caption', text: caption.join(' · ').slice(0, 80) });

  const items = [
    {
      label: pick(TEXT.state, lang),
      value: pick(STATE_LABELS, lang)[snapshot.state].slice(0, 40),
      color: STATE_COLORS[snapshot.state],
    },
  ];
  if (active && snapshot.time !== null) {
    const position =
      snapshot.total !== null
        ? `${formatPosition(snapshot.time)} / ${formatPosition(snapshot.total)}`
        : formatPosition(snapshot.time);
    items.push({ label: pick(TEXT.position, lang), value: position, icon: 'clock' });
    if (snapshot.total !== null) {
      const minutes = minutesLeftOf(snapshot);
      items.push(
        snapshot.state === 'playing'
          ? {
              label: pick(TEXT.ends, lang),
              value: clockTime(new Date(hub.now() + (snapshot.total - snapshot.time) * 1000), lang),
              icon: 'flag',
            }
          : { label: pick(TEXT.left, lang), value: formatMinutes(minutes, lang), icon: 'flag' },
      );
    }
  }
  if (snapshot.volume !== null && snapshot.state !== 'off') {
    items.push({
      label: pick(TEXT.volume, lang),
      value: snapshot.muted
        ? `${snapshot.volume} % (${pick(TEXT.muted, lang)})`
        : `${snapshot.volume} %`,
      icon: snapshot.muted ? 'volume-x' : 'volume-2',
    });
  }
  components.push({ type: 'status', items });

  if (active) {
    components.push(
      snapshot.state === 'playing'
        ? button(lang, 'play_pause', 'pause', 'pause')
        : button(lang, 'play_pause', 'play', 'play'),
      snapshot.mediaType === 'music'
        ? button(lang, 'next', 'skip-forward')
        : button(lang, 'stop', 'square'),
    );
  }
  if (snapshot.state !== 'off' && snapshot.volume !== null) {
    components.push(button(lang, 'volume_down', 'volume-1'), button(lang, 'volume_up', 'volume-2'));
  }

  // The position moves: re-read every 15 s while playing.
  return { ttl_seconds: snapshot.state === 'playing' ? 15 : 120, components };
}

export const WIDGETS = {
  [WIDGET_KEY]: {
    get(hub, request) {
      return buildContent(hub, request ?? {});
    },

    /** Resolves the toast (the widget action receives no language: all four). */
    async action(hub, { actionKey, settings = {} }) {
      const device = settings.device;
      try {
        switch (actionKey) {
          case 'play_pause':
          case 'stop':
          case 'next':
            await hub.run(device, (kodi) => kodi.playback(actionKey));
            break;
          case 'volume_down':
          case 'volume_up':
            await hub.run(device, async (kodi) => {
              const current = kodi.snapshot.volume ?? 50;
              const step = actionKey === 'volume_up' ? VOLUME_STEP : -VOLUME_STEP;
              await kodi.setVolume(current + step);
            });
            break;
          default:
            throw new Error(`Unknown widget action ${actionKey}`);
        }
      } catch (err) {
        if (err instanceof CommandError) {
          return err.messages;
        }
        throw err;
      }
      return DONE_TEXT[actionKey];
    },
  },
};
