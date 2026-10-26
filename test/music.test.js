// -----------------------------------------------------------------------------
// The Gladys 5.3 music player: the device model, publishNowPlaying, the
// commands of the music box, and the catalog panel (browse, search, play,
// queue, artworks), against the SDK's fake Gladys and a fake Kodi holding the
// library recorded on the bench Kodi 21.2 (test/fixtures/kodi/k21-*.json).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEVICE_FEATURE_CATEGORIES as CAT,
  validateMediaItems,
} from '@gladysassistant/integration-sdk';
import { buildDevice, nowPlayingOf } from '../src/devices.js';
import { parseId } from '../src/catalog.js';
import { describeItem, emptySnapshot, readSnapshot } from '../src/kodi/model.js';
import { COVER, FakeKodi, HA_ITEMS, result, settle, until } from './helpers/fakeKodi.js';
import { configFor, createWorld, created, deviceId, featureId } from './helpers/world.js';

const state = (gladys, key) => gladys.fake.lastState(featureId(key));

async function withPlayer(options = {}) {
  const world = await createWorld(options);
  await until(() => world.hub.instances.get(1)?.kodi.known, 2000, 'first read');
  const device = created(world.gladys);
  await world.gladys.fake.deviceCreated(device);
  await settle();
  const feature = (key) => device.features.find((f) => f.external_id === featureId(key));
  return { ...world, device, feature };
}

const COVER_ART = 'image://%2fmedia%2fmusic%2fAlpha%20Band%2fFirst%20Light%2fcover.png/';

// --- Device model -------------------------------------------------------------

test('the player keeps its 1.0 keys and gains the music features', () => {
  const gladys = {
    externalIds: (type, id) => ({
      device: `ext:x:${type}:${id}`,
      feature: (k) => `ext:x:${type}:${id}:${k}`,
    }),
  };
  const device = buildDevice(gladys, { slot: 1, httpUrl: 'http://192.0.2.20:8080' }, 'en');
  const byKey = Object.fromEntries(
    device.features.map((f) => [f.external_id.split(':').at(-1), f]),
  );
  // Converted in place by "Update" (same ids): the music box finds them.
  for (const key of ['play', 'pause', 'previous', 'next', 'volume', 'mute']) {
    assert.equal(byKey[key].category, CAT.MUSIC, key);
  }
  assert.equal(byKey.stop.category, CAT.TELEVISION, 'no stop type in music');
  assert.equal(byKey.title.category, CAT.TEXT, 'the 1.0 "now playing" text stays');
  assert.equal(byKey.music_title.type, 'title');
  assert.deepEqual(
    [byKey.playback_state.min, byKey.playback_state.max, byKey.playback_state.read_only],
    [0, 2, false],
  );
  for (const key of ['playback_state', 'position', 'shuffle', 'repeat', 'mute', 'volume']) {
    assert.equal(byKey[key].has_feedback, true, `${key}: Kodi confirms every write`);
    assert.equal(byKey[key].read_only, false, key);
  }
  for (const key of ['music_title', 'artist', 'album', 'artwork', 'duration']) {
    assert.equal(byKey[key].read_only, true, key);
  }
  assert.equal(byKey.repeat.max, 2);
  assert.equal(byKey.position.unit, 'seconds');
});

test('describeItem: song, episode, movie, channel, file', () => {
  assert.deepEqual(describeItem(result('k21-item-song-cover.json').item), {
    title: 'Morning Run',
    artist: 'Alpha Band',
    album: 'First Light',
    season: null,
  });
  const episode = describeItem(HA_ITEMS.episode);
  assert.equal(episode.title, HA_ITEMS.episode.title);
  assert.equal(episode.artist, HA_ITEMS.episode.showtitle);
  assert.equal(episode.season, HA_ITEMS.episode.season);
  const movie = describeItem(HA_ITEMS.movie);
  assert.deepEqual([movie.artist, movie.album], ['', '']);
  assert.equal(describeItem(result('k21-item-video-file.json').item).title, 'Bench.Clip.2024');
});

test('nowPlayingOf: an episode says its show and season, nothing playing clears', () => {
  const snapshot = readSnapshot({
    player: { playerid: 1, type: 'video' },
    properties: result('properties-video-playing.json'),
    item: HA_ITEMS.episode,
    application: { volume: 40, muted: false },
  });
  const now = nowPlayingOf(snapshot, 'fr', null);
  assert.equal(now.title, HA_ITEMS.episode.title);
  assert.equal(now.artist, HA_ITEMS.episode.showtitle);
  assert.equal(now.album, `Saison ${HA_ITEMS.episode.season}`);
  assert.equal(now.playback_state, 1);
  assert.equal(now.volume, 40);
  assert.equal(now.mute, false);
  assert.equal(nowPlayingOf(snapshot, 'en', undefined).artwork_url, undefined, 'pending');
  assert.deepEqual(nowPlayingOf(emptySnapshot('stopped'), 'fr', 'x'), {
    playback_state: 2,
    title: '',
    artist: '',
    album: '',
    artwork_url: null,
    duration: 0,
    position: 0,
  });
  const live = nowPlayingOf({ ...snapshot, live: true }, 'en', null);
  assert.equal(live.duration, 0, 'a live stream shows "Live"');
});

test('ids: our kinds parse back, anything else is refused', () => {
  assert.deepEqual(parseId('album:12:Alpha%20Band:First%20Light'), {
    kind: 'album',
    libraryId: 12,
    artist: 'Alpha Band',
    title: 'First Light',
  });
  assert.deepEqual(parseId('artist:2:Alpha%20Band'), {
    kind: 'artist',
    libraryId: 2,
    name: 'Alpha Band',
  });
  assert.deepEqual(parseId('file:/a/b:c.mp3'), { kind: 'file', path: '/a/b:c.mp3' });
  assert.equal(parseId('kodi:nope'), null);
  assert.equal(parseId('none:Settings'), null);
  assert.equal(parseId('album:x'), null);
  assert.equal(parseId(42), null);
});

// --- Now playing ----------------------------------------------------------------

test('a library song: now playing, artwork asked at 300 px, legacy texts kept', async (t) => {
  const kodi = new FakeKodi();
  kodi.images.set(COVER_ART, COVER);
  const w = await withPlayer({ kodis: [kodi] });
  t.after(() => w.app.stop());
  assert.equal(state(w.gladys, 'playback_state'), 2, 'idle at start');
  assert.equal(state(w.gladys, 'music_title'), '');

  kodi.playlists[0] = structuredClone(kodi.library.songs.slice(0, 3));
  kodi.playFromPlaylist(0, 1);
  await until(() => state(w.gladys, 'music_title') === 'Morning Run', 2000, 'title');
  assert.equal(state(w.gladys, 'artist'), 'Alpha Band');
  assert.equal(state(w.gladys, 'album'), 'First Light');
  assert.equal(state(w.gladys, 'playback_state'), 1);
  assert.equal(state(w.gladys, 'duration'), 40);
  assert.equal(state(w.gladys, 'shuffle'), 0);
  assert.equal(state(w.gladys, 'repeat'), 0);
  assert.equal(state(w.gladys, 'volume'), 100);
  assert.equal(state(w.gladys, 'mute'), 0);
  assert.equal(state(w.gladys, 'title'), 'Alpha Band – Morning Run', '1.0 text unchanged');
  await until(() => /^art-[0-9a-f]{12}$/.test(state(w.gladys, 'artwork') ?? ''), 2000, 'artwork');
  assert.deepEqual(
    kodi.imageRequests.map((r) => r.width),
    [300],
    'the 300 px variant, once',
  );
  const art = await w.gladys.fake.musicGetArtwork(state(w.gladys, 'artwork'));
  assert.equal(art.success, true);
  assert.ok(Buffer.from(art.data.image, 'base64').equals(COVER));
  assert.equal(kodi.imageRequests.length, 1, 'served from memory');

  kodi.pause();
  await until(() => state(w.gladys, 'playback_state') === 0, 2000, 'paused');
  kodi.stop();
  await until(() => state(w.gladys, 'playback_state') === 2, 2000, 'stopped');
  assert.equal(state(w.gladys, 'music_title'), '');
  assert.equal(state(w.gladys, 'artist'), '');
  assert.equal(state(w.gladys, 'artwork'), '');
  assert.equal(state(w.gladys, 'title'), 'Rien en lecture');
});

test('no artwork served: the artwork is cleared, not left on the previous one', async (t) => {
  const w = await withPlayer();
  t.after(() => w.app.stop());
  w.kodi.playSong();
  await until(() => state(w.gladys, 'playback_state') === 1, 2000, 'playing');
  await until(() => state(w.gladys, 'artwork') === '', 2000, 'artwork cleared');
});

test('"Update" in Discover republishes everything (the new features were empty)', async (t) => {
  const w = await withPlayer();
  t.after(() => w.app.stop());
  w.kodi.playSong();
  await until(() => state(w.gladys, 'playback_state') === 1, 2000, 'playing');
  const before = w.gladys.fake.states?.length ?? 0;
  await w.gladys.fake.deviceUpdated(w.device);
  await settle(50);
  const after = w.gladys.fake.states?.length ?? 0;
  if (w.gladys.fake.states) {
    assert.ok(after > before, 'states sent again');
  }
  assert.equal(state(w.gladys, 'playback_state'), 1);
});

// --- Commands -------------------------------------------------------------------

test('playback state, seek, shuffle, repeat, mute from the music box', async (t) => {
  const w = await withPlayer();
  t.after(() => w.app.stop());
  const { gladys, kodi, device, feature } = w;
  const set = (key, value, f = feature(key)) => gladys.fake.setValue(device, f, value);
  const calls = (method) => kodi.calls.filter((c) => c.method === method).map((c) => c.params);

  // Nothing plays: "play" starts the playlist Kodi kept; empty, it says so.
  const empty = await set('playback_state', 1);
  assert.equal(empty.success, false);
  assert.match(empty.error, /vide/);
  kodi.playlists[0] = structuredClone(kodi.library.songs.slice(0, 3));
  assert.equal((await set('playback_state', 1)).success, true);
  await until(() => state(gladys, 'music_title') === 'Dawn', 2000, 'started');
  assert.deepEqual(calls('Player.Open').at(-1), { item: { playlistid: 0, position: 0 } });

  await set('playback_state', 0);
  assert.deepEqual(calls('Player.PlayPause').at(-1), { playerid: 0, play: false });
  await until(() => state(gladys, 'playback_state') === 0, 2000, 'paused');
  await set('playback_state', 1);
  await until(() => state(gladys, 'playback_state') === 1, 2000, 'playing');

  await set('position', 75);
  assert.deepEqual(calls('Player.Seek').at(-1), {
    playerid: 0,
    value: { time: { hours: 0, minutes: 1, seconds: 15, milliseconds: 0 } },
  });

  await set('shuffle', 1);
  await until(() => state(gladys, 'shuffle') === 1, 2000, 'shuffle');
  await set('repeat', 2);
  await until(() => state(gladys, 'repeat') === 2, 2000, 'repeat one');
  assert.deepEqual(calls('Player.SetRepeat').at(-1), { playerid: 0, repeat: 'one' });
  await set('repeat', 1);
  assert.deepEqual(calls('Player.SetRepeat').at(-1), { playerid: 0, repeat: 'all' });

  await set('mute', 1);
  assert.deepEqual(calls('Application.SetMute').at(-1), { mute: true });
  await until(() => state(gladys, 'mute') === 1, 2000, 'muted');
  // Before "Update", the 1.0 television push button always sends 1: a toggle.
  await set('mute', 1, { ...feature('mute'), category: 'television', type: 'volume-mute' });
  assert.deepEqual(calls('Application.SetMute').at(-1), { mute: 'toggle' });
  await until(() => state(gladys, 'mute') === 0, 2000, 'unmuted');

  for (const [key, bad] of [
    ['playback_state', 3],
    ['repeat', 5],
    ['shuffle', 2],
    ['position', -4],
  ]) {
    const ack = await set(key, bad);
    assert.equal(ack.success, false, `${key} = ${bad}`);
  }

  await set('playback_state', 2);
  assert.ok(calls('Player.Stop').length > 0);
  await until(() => state(gladys, 'playback_state') === 2, 2000, 'stopped');
  // Shuffle needs a player: refused with Kodi's message, not a crash.
  const refused = await set('shuffle', 0);
  assert.equal(refused.success, false);
  assert.match(refused.error, /Rien/);
});

// --- Catalog --------------------------------------------------------------------

test('browse: root folders, artists, albums, songs, playlists, files, favourites', async (t) => {
  const kodi = new FakeKodi();
  const w = await withPlayer({ kodis: [kodi], config: configFor([kodi], { language: 'en' }) });
  t.after(() => w.app.stop());
  const browse = async (parentId, extra = {}) => {
    const ack = await w.gladys.fake.musicBrowse(w.device, { parentId, ...extra });
    assert.equal(ack.success, true, `${parentId}: ${ack.error}`);
    assert.deepEqual(validateMediaItems(ack.data.items), [], parentId);
    return ack.data;
  };
  const root = await browse(null);
  assert.deepEqual(
    root.items.map((i) => [i.id, i.title, i.browsable, i.playable]),
    [
      ['kodi:artists', 'Artists', true, false],
      ['kodi:albums', 'Albums', true, false],
      ['kodi:playlists', 'Playlists', true, false],
      ['kodi:favourites', 'Favourites', true, false],
      ['kodi:files', 'Files', true, false],
    ],
  );
  const artists = await browse('kodi:artists');
  assert.equal(artists.total, 2);
  assert.equal(artists.items[0].id, 'artist:2:Alpha%20Band');
  const albums = await browse(artists.items[0].id);
  assert.deepEqual(
    albums.items.map((i) => [i.title, i.subtitle, i.type]),
    [
      ['First Light', 'Alpha Band', 'album'],
      ['Second Wind', 'Alpha Band', 'album'],
    ],
  );
  assert.ok(
    albums.items.every((item) => /^art-/.test(item.artwork_key)),
    'covers (cover.png too)',
  );
  const songs = await browse(albums.items[0].id);
  assert.deepEqual(
    songs.items.map((i) => [i.title, i.duration, i.playable]),
    [
      ['Dawn', 40, true],
      ['Morning Run', 40, true],
      ['Noon', 40, true],
    ],
  );
  assert.equal(songs.items[0].id, 'file:/media/music/Alpha Band/First Light/01 - Dawn.mp3');
  // The thumbnails are the 64 px variant, read with the Kodi credentials.
  kodi.images.set(COVER_ART, COVER);
  const thumb = await w.gladys.fake.musicGetArtwork(songs.items[0].artwork_key);
  assert.equal(thumb.success, true);
  assert.equal(kodi.imageRequests.at(-1).width, 64);

  const paged = await browse('kodi:albums', { offset: 1, limit: 1 });
  assert.deepEqual([paged.total, paged.items.length], [3, 1]);

  const playlists = await browse('kodi:playlists');
  assert.deepEqual(
    playlists.items.map((i) => [i.id, i.type, i.browsable, i.playable]),
    [['playlist:special://profile/playlists/music/Evening.m3u', 'playlist', true, true]],
  );
  const evening = await browse(playlists.items[0].id);
  assert.deepEqual(
    evening.items.map((i) => i.title),
    ['Silence', 'Breathe'],
  );

  const files = await browse('kodi:files');
  assert.deepEqual(
    files.items.map((i) => [i.id, i.type]),
    [['dir:/media/music/', 'folder']],
  );
  const folder = await browse('dir:/media/music/');
  assert.deepEqual(
    folder.items.map((i) => [i.type, i.playable]),
    [
      ['folder', false],
      ['playlist', true],
      ['folder', false],
    ],
  );

  const favourites = await browse('kodi:favourites');
  assert.deepEqual(
    favourites.items.map((i) => [i.type, i.browsable, i.playable]),
    [
      ['track', false, true],
      ['folder', true, false],
      ['track', false, false],
    ],
    'a song, a folder, and a neutral row for a settings window (no line lost)',
  );

  const unknown = await w.gladys.fake.musicBrowse(w.device, { parentId: 'nope' });
  assert.equal(unknown.success, false);
});

test('search: playlists, artists, albums first, songs after; a type filters', async (t) => {
  const w = await withPlayer();
  t.after(() => w.app.stop());
  const search = async (query, type) => {
    const ack = await w.gladys.fake.musicSearch(w.device, { query, type });
    assert.equal(ack.success, true, ack.error);
    assert.deepEqual(validateMediaItems(ack.data.items), []);
    return ack.data.items;
  };
  assert.deepEqual(
    (await search('e')).map((i) => `${i.type}:${i.title}`),
    [
      'playlist:Evening.m3u',
      'artist:Beta Solo',
      'album:Quiet Room',
      'album:Second Wind',
      'track:Café Crème',
    ],
  );
  assert.deepEqual(
    (await search('wind', 'album')).map((i) => i.title),
    ['Second Wind'],
  );
  assert.deepEqual(
    (await search('café', 'track')).map((i) => i.title),
    ['Café Crème'],
  );
  assert.deepEqual(await search('   '), []);
});

test('play: replace, next after the current song, append; refusals', async (t) => {
  const w = await withPlayer();
  t.after(() => w.app.stop());
  const { gladys, kodi, device } = w;
  const play = (id, type, mode) => gladys.fake.musicPlay(device, { id, type }, mode);
  const titles = (playlistid = 0) => kodi.playlists[playlistid].map((i) => i.title || i.label);

  const album = 'album:1:Alpha%20Band:First%20Light';
  assert.equal((await play(album, 'album', 'replace')).success, true);
  assert.deepEqual(titles(), ['Dawn', 'Morning Run', 'Noon']);
  await until(() => state(gladys, 'music_title') === 'Dawn', 2000, 'started');

  const silence = 'file:/media/music/Beta Solo/Quiet Room/01 - Silence.mp3';
  assert.equal((await play(silence, 'track', 'next')).success, true);
  assert.equal(
    (await play('playlist:special://profile/playlists/music/Evening.m3u', 'playlist', 'append'))
      .success,
    true,
  );
  assert.deepEqual(titles(), [
    'Dawn',
    '01 - Silence.mp3',
    'Morning Run',
    'Noon',
    'Silence',
    'Breathe',
  ]);
  assert.equal(state(gladys, 'music_title'), 'Dawn', 'next / append do not start anything');

  // A library rebuilt since the scene was saved: found again by its name.
  assert.equal(
    (await play('album:77:Alpha%20Band:First%20Light', 'album', 'replace')).success,
    true,
  );
  assert.deepEqual(titles(), ['Dawn', 'Morning Run', 'Noon']);
  const gone = await play('album:77:Nobody:Nothing', 'album', 'replace');
  assert.equal(gone.success, false);
  assert.match(gone.error, /bibliothèque/);
  assert.equal((await play('artist:2:Alpha%20Band', 'artist', 'replace')).success, true);
  assert.deepEqual(titles(), ['Dawn', 'Morning Run', 'Noon', 'Café Crème']);

  for (const id of ['kodi:albums', 'dir:/media/music/', 'none:Settings', 'spotify:x']) {
    const refused = await play(id, 'folder', 'replace');
    assert.equal(refused.success, false, id);
  }
  // A playlist file Kodi cannot expand adds nothing: said, nothing started.
  const nothing = await play('playlist:/nowhere.m3u', 'playlist', 'replace');
  assert.equal(nothing.success, false);
  assert.match(nothing.error, /rien ajouté/);
});

test('queue: a page around the current item, jump, and the kept playlist once stopped', async (t) => {
  const w = await withPlayer();
  t.after(() => w.app.stop());
  const { gladys, kodi, device } = w;
  kodi.playlists[0] = structuredClone(kodi.library.songs);
  kodi.playFromPlaylist(0, 2);
  await until(() => state(gladys, 'music_title') === 'Noon', 2000, 'playing');

  const page = await gladys.fake.musicQueueGet(device, { offset: 1, limit: 2 });
  assert.equal(page.success, true, page.error);
  assert.equal(page.data.total, 4);
  assert.equal(page.data.current_index, 2);
  assert.deepEqual(
    page.data.items.map((i) => i.title),
    ['Morning Run', 'Noon'],
  );
  assert.deepEqual(validateMediaItems(page.data.items), []);

  assert.equal((await gladys.fake.musicQueuePlay(device, 3)).success, true);
  await until(() => state(gladys, 'music_title') === 'Café Crème', 2000, 'jumped');
  assert.deepEqual(kodi.calls.filter((c) => c.method === 'Player.GoTo').at(-1).params, {
    playerid: 0,
    to: 3,
  });
  assert.equal((await gladys.fake.musicQueuePlay(device, 9)).success, false);

  kodi.stop();
  await until(() => state(gladys, 'playback_state') === 2, 2000, 'stopped');
  const kept = await gladys.fake.musicQueueGet(device);
  assert.equal(kept.data.total, 4);
  assert.equal(kept.data.current_index, null);
  assert.equal((await gladys.fake.musicQueuePlay(device, 1)).success, true);
  assert.deepEqual(kodi.calls.filter((c) => c.method === 'Player.Open').at(-1).params, {
    item: { playlistid: 0, position: 1 },
  });
  await until(() => state(gladys, 'music_title') === 'Morning Run', 2000, 'started again');
});

test('artworks: unknown keys and keys of a Kodi removed from the config are refused', async (t) => {
  const w = await withPlayer();
  t.after(() => w.app.stop());
  assert.equal((await w.gladys.fake.musicGetArtwork('art-000000000000')).success, false);
  const key = w.gladys.artworkKey(`http://192.0.2.99:8080/image/${encodeURIComponent(COVER_ART)}`);
  const other = await w.gladys.fake.musicGetArtwork(key);
  assert.equal(other.success, false);
  assert.match(other.error, /not configured/);
  assert.equal(w.kodi.imageRequests.length, 0, 'nothing asked to the configured Kodi');
});

test('a device of another integration is refused by every music handler', async (t) => {
  const w = await withPlayer();
  t.after(() => w.app.stop());
  const stranger = { ...w.device, external_id: deviceId(3) };
  assert.equal((await w.gladys.fake.musicBrowse(stranger)).success, false);
  assert.equal((await w.gladys.fake.musicQueueGet(stranger)).success, false);
  assert.equal(
    (await w.gladys.fake.musicPlay(stranger, { id: 'file:/a.mp3', type: 'track' })).success,
    false,
  );
});
