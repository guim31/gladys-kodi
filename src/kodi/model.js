// -----------------------------------------------------------------------------
// Reading Kodi's answers into a snapshot, and the playback transitions that
// make the scene events. Pure functions, tested on answers recorded on Kodi
// 20.1 and 21.3 (test/fixtures/kodi/).
// -----------------------------------------------------------------------------

/** Every state of the snapshot, the `state` feature has one label each. */
export const STATES = ['off', 'stopped', 'playing', 'paused'];
export const ACTIVE_STATES = new Set(['playing', 'paused']);

/** What is playing, as the scene filters and variables name it. */
export const MEDIA_TYPES = ['movie', 'episode', 'music', 'tv', 'video'];

export const PLAYER_PROPERTIES = ['speed', 'time', 'totaltime', 'percentage', 'live'];
export const ITEM_PROPERTIES = [
  'title',
  'year',
  'showtitle',
  'season',
  'episode',
  'artist',
  'album',
  'channel',
  'channeltype',
  'file',
  'art',
];
export const APPLICATION_PROPERTIES = ['volume', 'muted', 'name', 'version'];

// The art types worth showing, best first. Kodi caches posters and thumbs at
// 720 px (`imageres`) and fanart at 1080 px: the small ones come first.
const ART_ORDER = {
  video: ['poster', 'thumb', 'tvshow.poster', 'season.poster', 'fanart', 'tvshow.fanart', 'icon'],
  audio: ['thumb', 'album.thumb', 'artist.thumb', 'fanart', 'artist.fanart', 'icon'],
};

const MEDIA_EXTENSION =
  /\.(mkv|mp4|m4v|avi|mov|wmv|mpg|mpeg|ts|m2ts|webm|iso|flv|ogv|mp3|flac|m4a|aac|ogg|opus|wav|wma|ape|alac)$/i;

/** `{ hours, minutes, seconds, milliseconds }` -> seconds (null when absent). */
export function toSeconds(time) {
  if (!time || typeof time !== 'object') {
    return null;
  }
  const { hours = 0, minutes = 0, seconds = 0, milliseconds = 0 } = time;
  const total = hours * 3600 + minutes * 60 + seconds + milliseconds / 1000;
  return Number.isFinite(total) ? total : null;
}

/**
 * The player to follow among `Player.GetActivePlayers`: video first (a music
 * playlist may go on behind a slideshow), then audio. Pictures are ignored.
 * @returns {{ playerid: number, type: 'video' | 'audio' } | null}
 */
export function choosePlayer(players) {
  const list = Array.isArray(players) ? players : [];
  for (const type of ['video', 'audio']) {
    const player = list.find((p) => p?.type === type && Number.isInteger(p.playerid));
    if (player) {
      return { playerid: player.playerid, type };
    }
  }
  return null;
}

/** Kodi item type + player type -> one of MEDIA_TYPES. */
export function mediaTypeOf(item, playerType) {
  switch (item?.type) {
    case 'movie':
      return 'movie';
    case 'episode':
      return 'episode';
    case 'song':
      return 'music';
    case 'channel':
      return item.channeltype === 'radio' ? 'music' : 'tv';
    default:
      // Music videos, files played outside the library, streams, add-ons.
      return playerType === 'audio' ? 'music' : 'video';
  }
}

const clean = (value) => (typeof value === 'string' ? value.trim() : '');
const pad = (number) => String(number).padStart(2, '0');

/** A file name shown as a title: no folder, no media extension. */
function fileTitle(text) {
  const base = text.split(/[\\/]/).filter(Boolean).at(-1) ?? text;
  let decoded = base;
  try {
    decoded = decodeURIComponent(base);
  } catch {
    // keep it as it is
  }
  return decoded.replace(MEDIA_EXTENSION, '');
}

/**
 * The title shown for an item: a movie "Title (2024)", an episode "Show
 * S01E02 – Title", a song "Artist – Title", a TV channel "Channel – Programme".
 * Empty when Kodi says nothing usable.
 */
export function formatTitle(item) {
  if (!item || typeof item !== 'object') {
    return '';
  }
  const title = clean(item.title);
  const label = clean(item.label);
  switch (item.type) {
    case 'movie': {
      const name = title || label;
      return name && item.year > 0 ? `${name} (${item.year})` : name;
    }
    case 'episode': {
      const show = clean(item.showtitle);
      const name = title || label;
      const number =
        item.season >= 0 && item.episode >= 0 ? `S${pad(item.season)}E${pad(item.episode)}` : '';
      const head = [show, number].filter(Boolean).join(' ');
      return head && name ? `${head} – ${name}` : head || name;
    }
    case 'song':
    case 'musicvideo': {
      const artists = Array.isArray(item.artist) ? item.artist.map(clean).filter(Boolean) : [];
      const name = title || label;
      return artists.length > 0 && name ? `${artists.join(', ')} – ${name}` : name;
    }
    case 'channel': {
      const channel = clean(item.channel) || label;
      return channel && title && title !== channel ? `${channel} – ${title}` : channel || title;
    }
    default: {
      if (title) {
        return title;
      }
      if (label) {
        return MEDIA_EXTENSION.test(label) ? fileTitle(label) : label;
      }
      const file = clean(item.file);
      return file ? fileTitle(file) : '';
    }
  }
}

/**
 * What tells one item from the next: the library id (movie, episode, song,
 * channel), else the file. Not the title: a radio stream changes its title
 * with every song, a TV channel with every programme.
 */
export function identityOf(item) {
  if (!item || typeof item !== 'object') {
    return '';
  }
  if (typeof item.id === 'number' && item.id >= 0 && item.type) {
    return `${item.type}:${item.id}`;
  }
  const file = clean(item.file);
  if (file) {
    return `file:${file}`;
  }
  const label = clean(item.label) || clean(item.title);
  return label ? `label:${label}` : '';
}

/** The art URLs of an item worth asking Kodi for, best first. */
export function artCandidates(item, playerType) {
  const art = item?.art && typeof item.art === 'object' ? item.art : {};
  const order = ART_ORDER[playerType] ?? ART_ORDER.video;
  const urls = [];
  for (const key of order) {
    const url = art[key];
    // Kodi's own placeholder icons (DefaultVideo.png...) say nothing.
    if (typeof url === 'string' && url.startsWith('image://') && !/^image:\/\/Default/i.test(url)) {
      if (!urls.includes(url)) {
        urls.push(url);
      }
    }
  }
  return urls;
}

export function emptySnapshot(state = 'off') {
  return {
    state,
    playerId: null,
    playerType: null,
    mediaType: null,
    title: '',
    identity: '',
    art: [],
    time: null,
    total: null,
    percentage: null,
    live: false,
    volume: null,
    muted: null,
  };
}

/**
 * A snapshot from the answers of one refresh.
 * @param {{ player: object|null, properties?: object, item?: object, application?: object }} answers
 * @param {object} [previous] the volume is kept when the application was not read
 */
export function readSnapshot({ player, properties, item, application }, previous) {
  const snapshot = emptySnapshot('stopped');
  if (application && typeof application === 'object') {
    snapshot.volume = Number.isFinite(application.volume) ? Math.round(application.volume) : null;
    snapshot.muted = typeof application.muted === 'boolean' ? application.muted : null;
  } else if (previous) {
    snapshot.volume = previous.volume;
    snapshot.muted = previous.muted;
  }
  if (!player) {
    return snapshot;
  }
  const props = properties ?? {};
  snapshot.state = props.speed === 0 ? 'paused' : 'playing';
  snapshot.playerId = player.playerid;
  snapshot.playerType = player.type;
  snapshot.mediaType = mediaTypeOf(item, player.type);
  snapshot.title = formatTitle(item);
  snapshot.identity = identityOf(item);
  snapshot.art = artCandidates(item, player.type);
  snapshot.time = toSeconds(props.time);
  const total = toSeconds(props.totaltime);
  snapshot.total = total && total > 0 ? total : null;
  snapshot.percentage = Number.isFinite(props.percentage) ? props.percentage : null;
  snapshot.live = props.live === true;
  return snapshot;
}

/** Progress in whole percent, 0 when nothing (or a live stream) plays. */
export function progressOf(snapshot) {
  if (!ACTIVE_STATES.has(snapshot.state) || snapshot.total === null) {
    return 0;
  }
  const percent =
    snapshot.percentage ?? (snapshot.time === null ? 0 : (snapshot.time / snapshot.total) * 100);
  return Math.min(100, Math.max(0, Math.floor(percent)));
}

/** Remaining whole minutes, 0 when nothing (or a live stream) plays. */
export function minutesLeftOf(snapshot) {
  if (!ACTIVE_STATES.has(snapshot.state) || snapshot.total === null || snapshot.time === null) {
    return 0;
  }
  return Math.ceil(Math.max(0, snapshot.total - snapshot.time) / 60);
}

/**
 * The scene events of a change of snapshot.
 * - started: something starts after nothing played, or another item follows
 *   (next episode, next song);
 * - paused / resumed: the same item;
 * - stopped: playback ended (`ended`: it reached its end) and nothing follows.
 * Nothing on the first snapshot (what happened before is unknown), nor when
 * Kodi disappears (turned off, network) or comes back with the same item.
 *
 * @param {object|null} previous
 * @param {object} next
 * @param {{ lastIdentity?: string, ended?: boolean }} [context] `lastIdentity`:
 *   the item playing before Kodi went off; `ended`: Kodi's Player.OnStop said so
 * @returns {Array<{ type: string, snapshot: object, ended?: boolean }>}
 */
export function playbackEvents(previous, next, context = {}) {
  if (!previous || next.state === 'off') {
    return [];
  }
  const wasActive = ACTIVE_STATES.has(previous.state);
  const isActive = ACTIVE_STATES.has(next.state);
  if (!wasActive && isActive) {
    if (previous.state === 'off' && next.identity && next.identity === context.lastIdentity) {
      return [];
    }
    return [{ type: 'started', snapshot: next }];
  }
  if (wasActive && isActive) {
    if (previous.identity && next.identity && previous.identity !== next.identity) {
      return [{ type: 'started', snapshot: next }];
    }
    if (previous.state === 'playing' && next.state === 'paused') {
      return [{ type: 'paused', snapshot: next }];
    }
    if (previous.state === 'paused' && next.state === 'playing') {
      return [{ type: 'resumed', snapshot: next }];
    }
    return [];
  }
  if (wasActive && next.state === 'stopped') {
    const ended =
      typeof context.ended === 'boolean'
        ? context.ended
        : previous.total !== null && progressOf(previous) >= 95;
    return [{ type: 'stopped', snapshot: previous, ended }];
  }
  return [];
}
