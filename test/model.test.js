// -----------------------------------------------------------------------------
// Reading Kodi's answers (recorded on Kodi 20.1, and the items of the Home
// Assistant tests) and the playback transitions behind the scene events.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  artCandidates,
  choosePlayer,
  emptySnapshot,
  formatTitle,
  identityOf,
  mediaTypeOf,
  minutesLeftOf,
  playbackEvents,
  progressOf,
  readSnapshot,
  toSeconds,
} from '../src/kodi/model.js';
import { HA_ITEMS, result } from './helpers/fakeKodi.js';

test('titles: movie, episode, song, TV channel, file outside the library', () => {
  assert.equal(formatTitle(HA_ITEMS.movie), 'Movie title (2026)');
  assert.equal(formatTitle(HA_ITEMS.episode), 'Show title S03E07 – Episode title');
  assert.equal(formatTitle(HA_ITEMS.song), 'Artist, Featured artist – Song title');
  assert.equal(formatTitle(HA_ITEMS.channel), 'Channel name – Current programme');
  assert.equal(formatTitle(result('item-video-file.json').item), 'Big Test Movie (2024)');
  assert.equal(formatTitle(result('item-song-library.json').item), 'Test Artist – Test Song');
  // What Kodi answers once nothing plays any more.
  assert.equal(formatTitle({ label: '', title: '', file: '', type: 'unknown' }), '');
  assert.equal(formatTitle({ type: 'unknown', label: 'Radio FIP' }), 'Radio FIP');
  assert.equal(
    formatTitle({ type: 'unknown', file: 'smb://nas/films/Le%20Film.mkv', label: '' }),
    'Le Film',
  );
  assert.equal(formatTitle({ ...HA_ITEMS.movie, year: 0 }), 'Movie title');
  assert.equal(
    formatTitle({ ...HA_ITEMS.episode, season: -1, episode: -1 }),
    'Show title – Episode title',
  );
  assert.equal(formatTitle(null), '');
});

test('media types: library types, radio, and what the player says for the rest', () => {
  assert.equal(mediaTypeOf(HA_ITEMS.movie, 'video'), 'movie');
  assert.equal(mediaTypeOf(HA_ITEMS.episode, 'video'), 'episode');
  assert.equal(mediaTypeOf(HA_ITEMS.song, 'audio'), 'music');
  assert.equal(mediaTypeOf(HA_ITEMS.channel, 'video'), 'tv');
  assert.equal(mediaTypeOf({ ...HA_ITEMS.channel, channeltype: 'radio' }, 'audio'), 'music');
  assert.equal(mediaTypeOf(result('item-video-file.json').item, 'video'), 'video');
  assert.equal(mediaTypeOf({ type: 'unknown' }, 'audio'), 'music');
  assert.equal(mediaTypeOf({ type: 'musicvideo' }, 'video'), 'video');
});

test('identity: library id, else the file; never the title of a stream', () => {
  assert.equal(identityOf(HA_ITEMS.movie), 'movie:1');
  assert.equal(identityOf(HA_ITEMS.channel), 'channel:4');
  assert.equal(
    identityOf(result('item-video-file.json').item),
    'file:/media/Big Test Movie (2024).mp4',
  );
  assert.equal(
    identityOf({ type: 'unknown', file: 'http://radio.example/stream', title: 'Song A' }),
    identityOf({ type: 'unknown', file: 'http://radio.example/stream', title: 'Song B' }),
  );
  assert.equal(identityOf({ type: 'unknown', label: '', file: '' }), '');
});

test('art: small images first, Kodi placeholders left out', () => {
  assert.deepEqual(artCandidates(HA_ITEMS.movie, 'video'), [
    HA_ITEMS.movie.art.poster,
    HA_ITEMS.movie.art.fanart,
  ]);
  assert.deepEqual(artCandidates(result('item-song-library.json').item, 'audio'), [
    'image://%2fmedia%2fmusic%2fTest%20Artist%2fTest%20Album%2ffolder.jpg/',
  ]);
  assert.deepEqual(artCandidates(result('item-video-file.json').item, 'video'), []);
});

test('players: video before audio, pictures ignored', () => {
  assert.deepEqual(choosePlayer(result('active-players-video.json')), {
    playerid: 1,
    type: 'video',
  });
  assert.deepEqual(choosePlayer(result('active-players-audio.json')), {
    playerid: 0,
    type: 'audio',
  });
  assert.equal(choosePlayer(result('active-players-none.json')), null);
  assert.equal(choosePlayer([{ playerid: 2, type: 'picture' }]), null);
  assert.deepEqual(
    choosePlayer([
      { playerid: 0, type: 'audio' },
      { playerid: 2, type: 'picture' },
      { playerid: 1, type: 'video' },
    ]),
    { playerid: 1, type: 'video' },
  );
});

test('a snapshot from recorded answers: playing, paused, progress, time left', () => {
  const application = result('application-properties.json');
  const player = choosePlayer(result('active-players-video.json'));
  const item = result('item-video-file.json').item;
  const playing = readSnapshot({
    player,
    properties: result('properties-video-playing.json'),
    item,
    application,
  });
  assert.equal(playing.state, 'playing');
  assert.equal(playing.total, 600);
  assert.equal(Math.round(playing.time), 2);
  assert.equal(progressOf(playing), 0);
  assert.equal(minutesLeftOf(playing), 10);
  assert.equal(playing.volume, 100);
  assert.equal(playing.muted, false);

  const paused = readSnapshot({
    player,
    properties: result('properties-video-paused.json'),
    item,
    application,
  });
  assert.equal(paused.state, 'paused');

  const stopped = readSnapshot({ player: null }, playing);
  assert.equal(stopped.state, 'stopped');
  assert.equal(stopped.volume, 100, 'the volume is kept when the application was not read');
  assert.equal(progressOf(stopped), 0);
  assert.equal(minutesLeftOf(stopped), 0);
});

test('a live stream has no progress nor time left', () => {
  const live = {
    ...emptySnapshot('playing'),
    time: 1200,
    total: null,
    live: true,
  };
  assert.equal(progressOf(live), 0);
  assert.equal(minutesLeftOf(live), 0);
  assert.equal(toSeconds({ hours: 1, minutes: 2, seconds: 3, milliseconds: 500 }), 3723.5);
  assert.equal(toSeconds(null), null);
  assert.equal(toSeconds({ hours: 0, minutes: 0, seconds: 0, milliseconds: -480 }), 0);
});

const snap = (state, identity = 'movie:1', extra = {}) => ({
  ...emptySnapshot(state),
  identity,
  ...extra,
});

test('transitions: start, pause, resume, stop, next item', () => {
  const types = (previous, next, context) =>
    playbackEvents(previous, next, context).map((event) => event.type);
  assert.deepEqual(types(snap('stopped', ''), snap('playing')), ['started']);
  assert.deepEqual(types(snap('playing'), snap('paused')), ['paused']);
  assert.deepEqual(types(snap('paused'), snap('playing')), ['resumed']);
  assert.deepEqual(types(snap('playing'), snap('stopped', '')), ['stopped']);
  assert.deepEqual(types(snap('paused'), snap('stopped', '')), ['stopped']);
  assert.deepEqual(types(snap('playing'), snap('playing', 'movie:2')), ['started']);
  assert.deepEqual(types(snap('paused'), snap('playing', 'movie:2')), ['started']);
  assert.deepEqual(types(snap('playing'), snap('playing')), []);
  assert.deepEqual(types(snap('stopped', ''), snap('stopped', '')), []);
  // A title appearing on the same item (empty identity at first) is no new start.
  assert.deepEqual(types(snap('playing', ''), snap('playing', 'file:/a.mkv')), []);
});

test('transitions around Kodi going off and coming back', () => {
  const types = (previous, next, context) =>
    playbackEvents(previous, next, context).map((event) => event.type);
  assert.deepEqual(types(null, snap('playing')), [], 'first snapshot');
  assert.deepEqual(types(snap('playing'), snap('off', '')), [], 'turned off: no stop');
  assert.deepEqual(types(snap('off', ''), snap('playing'), { lastIdentity: 'movie:1' }), []);
  assert.deepEqual(types(snap('off', ''), snap('playing'), { lastIdentity: 'movie:9' }), [
    'started',
  ]);
  assert.deepEqual(types(snap('off', ''), snap('playing'), { lastIdentity: '' }), ['started']);
  assert.deepEqual(types(snap('off', ''), snap('stopped', '')), []);
});

test('a stop says whether playback reached its end', () => {
  const [byKodi] = playbackEvents(snap('playing'), snap('stopped', ''), { ended: true });
  assert.equal(byKodi.ended, true);
  assert.equal(byKodi.snapshot.identity, 'movie:1', 'the event describes what stopped');
  // Without Kodi's word (HTTP only): 95 % at least of a known length.
  const nearEnd = snap('playing', 'movie:1', { total: 600, time: 590, percentage: 98.3 });
  assert.equal(playbackEvents(nearEnd, snap('stopped', ''))[0].ended, true);
  const middle = snap('playing', 'movie:1', { total: 600, time: 300, percentage: 50 });
  assert.equal(playbackEvents(middle, snap('stopped', ''))[0].ended, false);
  const live = snap('playing', 'channel:4', { total: null, time: 300 });
  assert.equal(playbackEvents(live, snap('stopped', ''))[0].ended, false);
});
