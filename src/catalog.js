// -----------------------------------------------------------------------------
// The catalog of the Gladys 5.3 music panel (manifest `music`): browse,
// search, play, the queue, and the bytes of the artworks. Read on demand from
// Kodi's JSON-RPC, never stored. Everything comes back as MediaItems whose
// `id` is ours (opaque to Gladys, carried back by a play command and by the
// `music.play-media` scene action):
//
//   kodi:<root>           a root folder (artists, albums, playlists, ...)
//   artist:<id>:<name>    a library artist (albums inside, plays all its songs)
//   album:<id>:<artist>:<title>   a library album (songs inside)
//   file:<path>           a song or a file (library or not), played by path
//   song:<id>             a library song whose path is too long for an id
//   playlist:<path>       a playlist file (.m3u, smart playlist...)
//   dir:<path>            a folder of a source (browsable, never playable)
//
// The names in artist and album ids keep a scene working after the library
// was rebuilt (new ids): the id is used while it still names the same item,
// else the item is found again by its name (checked on Kodi 21.2: an unknown
// albumid is "Invalid params", Player.Open of it too).
//
// What Kodi gives (checked on Kodi 21.2, test/fixtures/kodi/k21-*.json):
//   - library lists are paged by Kodi (`limits` -> `limits.total`), so are
//     source folders (Files.GetDirectory);
//   - a playlist file lists its items through Files.GetDirectory, and
//     Playlist.Add `{ directory }` expands it (`{ file }` adds it as one
//     unplayable item, Player.Open `{ file }` opens nothing usable);
//   - the music playlist (id 0) follows the shuffled order: "after the
//     current item" is its position + 1 in both modes;
//   - search is Kodi's `contains` filter: case-insensitive, not
//     accent-insensitive ("cafe" does not find "Café").
// -----------------------------------------------------------------------------

import { MUSIC_MEDIA_TYPES, MUSIC_PLAY_MODES } from '@gladysassistant/integration-sdk';
import { ART_WIDTH, CommandError } from './hub.js';
import { artCandidates, choosePlayer, formatTitle } from './kodi/model.js';
import { CATALOG_TEXT } from './texts.js';

// Bounds of the core (capabilities/music.md, section 4.2).
const MAX_ID = 512;
const MAX_TEXT = 200;

export const AUDIO_PLAYLIST = 0;
const VIDEO_PLAYLIST = 1;

export const ROOTS = ['artists', 'albums', 'playlists', 'favourites', 'files'];

const PLAYLIST_FILE = /\.(m3u8?|pls|xsp|strm|cue|wpl|asx|ram|b4s)\/?$/i;

const ITEM_FIELDS = ['title', 'artist', 'album', 'duration', 'art', 'file'];
const QUEUE_FIELDS = [...ITEM_FIELDS, 'showtitle', 'season', 'episode'];

const clean = (value) => (typeof value === 'string' ? value.trim() : '');
const clip = (value) => clean(value).slice(0, MAX_TEXT);
const names = (value) =>
  (Array.isArray(value) ? value : [value]).map(clean).filter(Boolean).join(', ').slice(0, MAX_TEXT);
const pick = (table, language) => table[language] ?? table.en;
const seconds = (value) => (Number.isFinite(value) && value > 0 ? Math.round(value) : null);
const fold = (text) => clean(text).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** `album:12:Alpha%20Band:First%20Light` -> parts; null when not ours. */
export function parseId(id) {
  if (typeof id !== 'string') {
    return null;
  }
  const colon = id.indexOf(':');
  if (colon <= 0) {
    return null;
  }
  const kind = id.slice(0, colon);
  const rest = id.slice(colon + 1);
  switch (kind) {
    case 'kodi':
      return ROOTS.includes(rest) ? { kind, root: rest } : null;
    case 'file':
    case 'playlist':
    case 'dir':
      return rest ? { kind, path: rest } : null;
    case 'song': {
      const songid = Number(rest);
      return Number.isInteger(songid) && songid >= 0 ? { kind, songid } : null;
    }
    case 'artist':
    case 'album': {
      const [number, ...encoded] = rest.split(':');
      const libraryId = Number(number);
      if (!Number.isInteger(libraryId) || libraryId < 0) {
        return null;
      }
      let decoded;
      try {
        decoded = encoded.map((part) => decodeURIComponent(part));
      } catch {
        decoded = [];
      }
      return kind === 'artist'
        ? { kind, libraryId, name: decoded[0] ?? '' }
        : { kind, libraryId, artist: decoded[0] ?? '', title: decoded[1] ?? '' };
    }
    default:
      return null;
  }
}

/** An id with its names when they fit, without them otherwise. */
function namedId(kind, libraryId, ...parts) {
  const full = [`${kind}:${libraryId}`, ...parts.map((part) => encodeURIComponent(part))].join(':');
  return full.length <= MAX_ID ? full : `${kind}:${libraryId}`;
}

/** The file id of a path, or the library id when the path is too long. */
function fileId(path, songid) {
  const id = `file:${path}`;
  if (id.length <= MAX_ID) {
    return id;
  }
  return Number.isInteger(songid) ? `song:${songid}` : null;
}

/**
 * The catalog of the hub's Kodi instances. Every operation goes through
 * `hub.run` (Kodi's refusals become coded, translated errors).
 */
export class Catalog {
  constructor(hub) {
    this.hub = hub;
  }

  get language() {
    return this.hub.language;
  }

  /** The artwork key of the first useful art of an item (64 px thumbnails). */
  #artworkKey(entry, item, playerType = 'audio') {
    const [art] = artCandidates(item, playerType);
    if (!art) {
      return undefined;
    }
    return this.hub.gladys.artworkKey(this.hub.artworkSource(entry, art, ART_WIDTH.list));
  }

  #withArt(entry, item, raw, playerType) {
    const key = this.#artworkKey(entry, raw, playerType);
    return key ? { ...item, artwork_key: key } : item;
  }

  #folder(id, title) {
    return { id, type: MUSIC_MEDIA_TYPES.FOLDER, title, browsable: true, playable: false };
  }

  #artistItem(entry, artist) {
    const name = clip(artist?.artist) || clip(artist?.label);
    if (!Number.isInteger(artist?.artistid) || !name) {
      return this.#neutral(artist?.label);
    }
    return this.#withArt(
      entry,
      {
        id: namedId('artist', artist.artistid, name),
        type: MUSIC_MEDIA_TYPES.ARTIST,
        title: name,
        browsable: true,
        playable: true,
      },
      artist,
    );
  }

  #albumItem(entry, album) {
    const title = clip(album?.title) || clip(album?.label);
    if (!Number.isInteger(album?.albumid) || !title) {
      return this.#neutral(album?.label);
    }
    const artist = names(album.artist);
    const item = {
      id: namedId('album', album.albumid, artist, title),
      type: MUSIC_MEDIA_TYPES.ALBUM,
      title,
      browsable: true,
      playable: true,
    };
    if (artist) {
      item.subtitle = artist;
    }
    return this.#withArt(entry, item, album);
  }

  /** A song or a file of a folder. Null when Kodi gave no usable path. */
  #trackItem(entry, raw, playerType = 'audio') {
    const id = fileId(clean(raw?.file), raw?.songid ?? (raw?.type === 'song' ? raw.id : undefined));
    if (!id) {
      return null;
    }
    const item = {
      id,
      type: MUSIC_MEDIA_TYPES.TRACK,
      title: clip(raw.title) || clip(formatTitle({ ...raw, type: 'unknown' })) || this.#unknown(),
      duration: seconds(raw.duration),
      browsable: false,
      playable: true,
    };
    const artist = names(raw.artist) || clip(raw.showtitle);
    if (artist) {
      item.subtitle = artist;
    }
    return this.#withArt(entry, item, raw, playerType);
  }

  /** An entry of Files.GetDirectory: a folder, a playlist file or a file. */
  #fileEntry(entry, raw) {
    const path = clean(raw?.file);
    const title = clip(raw?.label) || clip(raw?.title) || this.#unknown();
    if (raw?.filetype === 'directory') {
      const playlist = PLAYLIST_FILE.test(path);
      const id = `${playlist ? 'playlist' : 'dir'}:${path}`;
      if (!path || id.length > MAX_ID) {
        return this.#neutral(title);
      }
      return playlist
        ? { id, type: MUSIC_MEDIA_TYPES.PLAYLIST, title, browsable: true, playable: true }
        : this.#folder(id, title);
    }
    return this.#trackItem(entry, raw) ?? this.#neutral(title);
  }

  /**
   * A row that is neither browsable nor playable: a page never loses a line
   * (the panel asks for the next page at `offset = rows received`).
   */
  #neutral(label) {
    return {
      id: `none:${clip(label) || '?'}`.slice(0, MAX_ID),
      type: MUSIC_MEDIA_TYPES.TRACK,
      title: clip(label) || this.#unknown(),
      browsable: false,
      playable: false,
    };
  }

  #unknown() {
    return pick(CATALOG_TEXT, this.language).unknown;
  }

  // --- Browse ---------------------------------------------------------------

  /**
   * onMusicBrowse.
   * @returns {Promise<{ items: object[], total: number }>}
   */
  async browse(device, { parentId = null, offset = 0, limit = 50 } = {}) {
    const entry = this.hub.entryOf(device?.external_id);
    if (parentId === null || parentId === undefined) {
      const text = pick(CATALOG_TEXT, this.language);
      const items = ROOTS.map((root) => this.#folder(`kodi:${root}`, text[root]));
      return { items: items.slice(offset, offset + limit), total: items.length };
    }
    const parsed = parseId(parentId);
    if (!parsed || parsed.kind === 'file' || parsed.kind === 'song') {
      throw new CommandError('not_found', this.language);
    }
    const limits = { start: offset, end: offset + limit };
    return this.hub.run(device.external_id, async (kodi) => {
      const list = async (method, params, key, map) => {
        const answer = await kodi.call(method, { ...params, limits });
        const rows = Array.isArray(answer?.[key]) ? answer[key] : [];
        return {
          items: rows.map((row) => map(row) ?? this.#neutral(row?.label)),
          total: answer?.limits?.total ?? rows.length + offset,
        };
      };
      switch (parsed.kind) {
        case 'kodi':
          return this.#browseRoot(entry, kodi, parsed.root, { offset, limit, list });
        case 'artist': {
          const artistid = await this.#resolveArtist(kodi, parsed);
          return list(
            'AudioLibrary.GetAlbums',
            {
              filter: { artistid },
              properties: ['title', 'artist', 'year', 'art'],
              sort: { method: 'year' },
            },
            'albums',
            (album) => this.#albumItem(entry, album),
          );
        }
        case 'album': {
          const albumid = await this.#resolveAlbum(kodi, parsed);
          return list(
            'AudioLibrary.GetSongs',
            { filter: { albumid }, properties: ITEM_FIELDS, sort: { method: 'track' } },
            'songs',
            (song) => this.#trackItem(entry, song),
          );
        }
        case 'playlist':
          // In the order of the playlist (no sort).
          return list(
            'Files.GetDirectory',
            { directory: parsed.path, media: 'music', properties: ITEM_FIELDS },
            'files',
            (file) => this.#fileEntry(entry, file),
          );
        default:
          return list(
            'Files.GetDirectory',
            {
              directory: parsed.path,
              media: 'music',
              properties: ITEM_FIELDS,
              sort: { method: 'label', ignorearticle: true },
            },
            'files',
            (file) => this.#fileEntry(entry, file),
          );
      }
    });
  }

  async #browseRoot(entry, kodi, root, { offset, limit, list }) {
    switch (root) {
      case 'artists':
        return list(
          'AudioLibrary.GetArtists',
          { properties: ['art'], sort: { method: 'artist', ignorearticle: true } },
          'artists',
          (artist) => this.#artistItem(entry, artist),
        );
      case 'albums':
        return list(
          'AudioLibrary.GetAlbums',
          {
            properties: ['title', 'artist', 'year', 'art'],
            sort: { method: 'album', ignorearticle: true },
          },
          'albums',
          (album) => this.#albumItem(entry, album),
        );
      case 'playlists':
        return list(
          'Files.GetDirectory',
          {
            directory: 'special://musicplaylists/',
            media: 'music',
            sort: { method: 'label', ignorearticle: true },
          },
          'files',
          (file) => this.#fileEntry(entry, file),
        );
      case 'files': {
        const answer = await kodi.call('Files.GetSources', { media: 'music' });
        const sources = Array.isArray(answer?.sources) ? answer.sources : [];
        const items = sources.map((source) => {
          const id = `dir:${clean(source?.file)}`;
          const title = clip(source?.label) || this.#unknown();
          return source?.file && id.length <= MAX_ID
            ? this.#folder(id, title)
            : this.#neutral(title);
        });
        return { items: items.slice(offset, offset + limit), total: items.length };
      }
      default: {
        // Favourites: media ones play, folder ones open; the others (a window,
        // an add-on, a script) are neutral rows.
        const answer = await kodi.call('Favourites.GetFavourites', {
          properties: ['path', 'window', 'windowparameter', 'thumbnail'],
        });
        const favourites = Array.isArray(answer?.favourites) ? answer.favourites : [];
        const items = favourites.map((favourite) => this.#favouriteItem(entry, favourite));
        return { items: items.slice(offset, offset + limit), total: items.length };
      }
    }
  }

  #favouriteItem(entry, favourite) {
    const title = clip(favourite?.title) || this.#unknown();
    const thumb = clean(favourite?.thumbnail);
    const art = thumb.startsWith('image://') ? { thumb } : {};
    if (favourite?.type === 'media' && clean(favourite.path)) {
      const path = clean(favourite.path);
      const playlist = PLAYLIST_FILE.test(path);
      const id = `${playlist ? 'playlist' : 'file'}:${path}`;
      if (id.length <= MAX_ID) {
        return this.#withArt(
          entry,
          {
            id,
            type: playlist ? MUSIC_MEDIA_TYPES.PLAYLIST : MUSIC_MEDIA_TYPES.TRACK,
            title,
            browsable: playlist,
            playable: true,
          },
          { art },
        );
      }
    }
    const folder = clean(favourite?.windowparameter);
    if (favourite?.type === 'window' && /^(\/|[a-z]+:\/\/|[A-Z]:\\)/.test(folder)) {
      const id = `${PLAYLIST_FILE.test(folder) ? 'playlist' : 'dir'}:${folder}`;
      if (id.length <= MAX_ID) {
        return id.startsWith('playlist:')
          ? { id, type: MUSIC_MEDIA_TYPES.PLAYLIST, title, browsable: true, playable: true }
          : this.#folder(id, title);
      }
    }
    return this.#neutral(title);
  }

  /** The library id of an artist id, found again by name when it changed. */
  async #resolveArtist(kodi, { libraryId, name }) {
    const details = await kodi
      .call('AudioLibrary.GetArtistDetails', { artistid: libraryId, properties: [] })
      .catch(() => null);
    const label = clean(details?.artistdetails?.label ?? details?.artistdetails?.artist);
    if (details?.artistdetails && (!name || fold(label) === fold(name))) {
      return libraryId;
    }
    if (name) {
      const found = await kodi.call('AudioLibrary.GetArtists', {
        filter: { field: 'artist', operator: 'is', value: name },
        limits: { start: 0, end: 1 },
      });
      const artist = found?.artists?.[0];
      if (Number.isInteger(artist?.artistid)) {
        return artist.artistid;
      }
    }
    throw new CommandError('not_found', this.language);
  }

  /** The library id of an album id, found again by title (and artist). */
  async #resolveAlbum(kodi, { libraryId, artist, title }) {
    const details = await kodi
      .call('AudioLibrary.GetAlbumDetails', { albumid: libraryId, properties: ['title', 'artist'] })
      .catch(() => null);
    const album = details?.albumdetails;
    if (album && (!title || fold(album.title || album.label) === fold(title))) {
      return libraryId;
    }
    if (title) {
      const rules = [{ field: 'album', operator: 'is', value: title }];
      if (artist) {
        rules.push({ field: 'artist', operator: 'is', value: artist.split(', ')[0] });
      }
      const found = await kodi.call('AudioLibrary.GetAlbums', {
        filter: rules.length > 1 ? { and: rules } : rules[0],
        limits: { start: 0, end: 1 },
      });
      const match = found?.albums?.[0];
      if (Number.isInteger(match?.albumid)) {
        return match.albumid;
      }
    }
    throw new CommandError('not_found', this.language);
  }

  // --- Search ---------------------------------------------------------------

  /**
   * onMusicSearch: artists, albums and songs of the library, and the music
   * playlists by name.
   * @returns {Promise<{ items: object[] }>}
   */
  async search(device, { query, type = null, limit = 20 } = {}) {
    const entry = this.hub.entryOf(device?.external_id);
    const text = clean(String(query ?? ''));
    if (!text) {
      return { items: [] };
    }
    const wants = (kind) => type === null || type === undefined || type === kind;
    return this.hub.run(device.external_id, async (kodi) => {
      const limits = { start: 0, end: limit };
      const contains = (field) => ({ field, operator: 'contains', value: text });
      const [artists, albums, songs, playlists] = await Promise.all([
        wants(MUSIC_MEDIA_TYPES.ARTIST)
          ? kodi.call('AudioLibrary.GetArtists', {
              filter: contains('artist'),
              properties: ['art'],
              sort: { method: 'artist', ignorearticle: true },
              limits,
            })
          : null,
        wants(MUSIC_MEDIA_TYPES.ALBUM)
          ? kodi.call('AudioLibrary.GetAlbums', {
              filter: contains('album'),
              properties: ['title', 'artist', 'year', 'art'],
              sort: { method: 'album', ignorearticle: true },
              limits,
            })
          : null,
        wants(MUSIC_MEDIA_TYPES.TRACK)
          ? kodi.call('AudioLibrary.GetSongs', {
              filter: contains('title'),
              properties: ITEM_FIELDS,
              sort: { method: 'title', ignorearticle: true },
              limits,
            })
          : null,
        wants(MUSIC_MEDIA_TYPES.PLAYLIST)
          ? kodi.call('Files.GetDirectory', {
              directory: 'special://musicplaylists/',
              media: 'music',
            })
          : null,
      ]);
      const groups = {
        playlist: (playlists?.files ?? [])
          .filter((file) => fold(file?.label).includes(fold(text)))
          .map((file) => this.#fileEntry(entry, file))
          .filter((item) => item.playable),
        artist: (artists?.artists ?? []).map((artist) => this.#artistItem(entry, artist)),
        album: (albums?.albums ?? []).map((album) => this.#albumItem(entry, album)),
        track: (songs?.songs ?? []).map((song) => this.#trackItem(entry, song)),
      };
      for (const key of Object.keys(groups)) {
        groups[key] = groups[key].filter((item) => item && item.playable !== false);
      }
      return { items: mixResults(groups, limit) };
    });
  }

  // --- Play -------------------------------------------------------------------

  /** The Playlist.Item of a playable id. */
  async #playlistItem(kodi, parsed) {
    switch (parsed?.kind) {
      case 'file':
        return { file: parsed.path };
      case 'song':
        return { songid: parsed.songid };
      case 'playlist':
        return { directory: parsed.path };
      case 'album':
        return { albumid: await this.#resolveAlbum(kodi, parsed) };
      case 'artist':
        return { artistid: await this.#resolveArtist(kodi, parsed) };
      default:
        throw new CommandError('not_playable', this.language);
    }
  }

  /**
   * onMusicPlay (and the `music.play-media` scene action). Replace: the
   * music playlist is emptied, filled, checked and started at its start.
   * Next: inserted after the item playing in the music playlist (at its end
   * when something else plays). Append: added at its end. Nothing starts on
   * next / append.
   */
  async play(device, media, mode = MUSIC_PLAY_MODES.REPLACE) {
    this.hub.entryOf(device?.external_id);
    const parsed = parseId(media?.id);
    if (!parsed || parsed.kind === 'kodi' || parsed.kind === 'dir') {
      throw new CommandError('not_playable', this.language);
    }
    await this.hub.run(device.external_id, async (kodi) => {
      const item = await this.#playlistItem(kodi, parsed);
      const size = async () =>
        (
          await kodi.call('Playlist.GetItems', {
            playlistid: AUDIO_PLAYLIST,
            limits: { start: 0, end: 1 },
          })
        )?.limits?.total ?? 0;
      if (mode === MUSIC_PLAY_MODES.REPLACE) {
        await kodi.call('Playlist.Clear', { playlistid: AUDIO_PLAYLIST });
        await kodi.call('Playlist.Add', { playlistid: AUDIO_PLAYLIST, item });
        if ((await size()) === 0) {
          throw new CommandError('nothing_added', this.language);
        }
        await kodi.call('Player.Open', { item: { playlistid: AUDIO_PLAYLIST, position: 0 } });
        await kodi.afterCommand();
        return;
      }
      const before = await size();
      let position = null;
      if (mode === MUSIC_PLAY_MODES.NEXT) {
        const player = choosePlayer(await kodi.call('Player.GetActivePlayers'));
        if (player?.type === 'audio') {
          const props = await kodi.call('Player.GetProperties', {
            playerid: player.playerid,
            properties: ['playlistid', 'position'],
          });
          if (props?.playlistid === AUDIO_PLAYLIST && props.position >= 0) {
            position = props.position + 1;
          }
        }
      }
      if (position === null) {
        await kodi.call('Playlist.Add', { playlistid: AUDIO_PLAYLIST, item });
      } else {
        await kodi.call('Playlist.Insert', { playlistid: AUDIO_PLAYLIST, position, item });
      }
      if ((await size()) <= before) {
        throw new CommandError('nothing_added', this.language);
      }
    });
  }

  // --- Queue ------------------------------------------------------------------

  /** The playlist the queue shows, and the player playing it if any. */
  async #queueOf(kodi) {
    const player = choosePlayer(await kodi.call('Player.GetActivePlayers'));
    if (player) {
      const props = await kodi.call('Player.GetProperties', {
        playerid: player.playerid,
        properties: ['playlistid', 'position'],
      });
      if (Number.isInteger(props?.playlistid) && props.playlistid >= 0) {
        return {
          playlistid: props.playlistid,
          player,
          position: props.position >= 0 ? props.position : null,
        };
      }
    }
    const last = kodi.lastPlaylistId;
    return {
      playlistid: last === VIDEO_PLAYLIST ? VIDEO_PLAYLIST : AUDIO_PLAYLIST,
      player: null,
      position: null,
    };
  }

  /**
   * onMusicQueueGet: a page of the playlist Kodi plays (music or video), or of
   * the last one played once Kodi stopped (it keeps it; nothing is current).
   * @returns {Promise<{ items: object[], currentIndex: number|null, total: number }>}
   */
  async queueGet(device, { offset = 0, limit = 50 } = {}) {
    const entry = this.hub.entryOf(device?.external_id);
    return this.hub.run(device.external_id, async (kodi) => {
      const queue = await this.#queueOf(kodi);
      const answer = await kodi.call('Playlist.GetItems', {
        playlistid: queue.playlistid,
        properties: QUEUE_FIELDS,
        limits: { start: offset, end: offset + limit },
      });
      const rows = Array.isArray(answer?.items) ? answer.items : [];
      const playerType = queue.playlistid === VIDEO_PLAYLIST ? 'video' : 'audio';
      // No row dropped: the panel highlights `current_index - offset`.
      const items = rows.map((row, index) => {
        const item = this.#trackItem(entry, row, playerType);
        if (item) {
          return item;
        }
        return this.#withArt(
          entry,
          {
            id: `queue:${offset + index}`,
            type: MUSIC_MEDIA_TYPES.TRACK,
            title: clip(formatTitle(row)) || clip(row?.label) || this.#unknown(),
            duration: seconds(row?.duration),
            browsable: false,
            playable: true,
          },
          row,
          playerType,
        );
      });
      return {
        items,
        currentIndex: queue.position,
        total: answer?.limits?.total ?? rows.length,
      };
    });
  }

  /** onMusicQueuePlay: jump to an item of the playlist the queue shows. */
  async queuePlay(device, index) {
    this.hub.entryOf(device?.external_id);
    if (!Number.isInteger(index) || index < 0) {
      throw new CommandError('not_in_queue', this.language);
    }
    await this.hub.run(device.external_id, async (kodi) => {
      const queue = await this.#queueOf(kodi);
      const answer = await kodi.call('Playlist.GetItems', {
        playlistid: queue.playlistid,
        limits: { start: 0, end: 1 },
      });
      if (index >= (answer?.limits?.total ?? 0)) {
        throw new CommandError('not_in_queue', this.language);
      }
      if (queue.player) {
        await kodi.call('Player.GoTo', { playerid: queue.player.playerid, to: index });
      } else {
        await kodi.call('Player.Open', { item: { playlistid: queue.playlistid, position: index } });
      }
      await kodi.afterCommand();
    });
  }
}

/**
 * Search results of every type in one list of `limit`: the playlists, the
 * artists and the albums first (a quarter of the list each at most), the
 * songs after, then what is left of the others.
 */
export function mixResults(groups, limit) {
  const share = Math.max(1, Math.floor(limit / 4));
  const heads = ['playlist', 'artist', 'album'];
  const first = heads.flatMap((type) => (groups[type] ?? []).slice(0, share));
  const rest = heads.flatMap((type) => (groups[type] ?? []).slice(share));
  return [...first, ...(groups.track ?? []), ...rest].slice(0, limit);
}
