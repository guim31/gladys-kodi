# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [1.0.2] - 2026-10-22

### Security

- Rebuilt on Node.js 24.22.1, the October 2026 security release (remote code
  execution in the Brotli decoder, CVE-2026-111497; TLS hostname and DNS
  fixes).

## [1.0.1] - 2026-10-13

### Changed

- Quieter logs: playback events are only written at the debug level, and a Kodi
  that stays off, or a Gladys that refuses the states, writes one line when the
  problem starts and one when it ends, instead of one per attempt.

## [1.0.0] - 2026-10-13

### Added

- One Gladys device per Kodi, up to three: playback state, what is playing
  (movie with its year, episode with its number, artist and song, TV channel
  and programme), media type, progress, time left, a volume slider, and play,
  pause, stop, previous, next and mute buttons.
- Real-time updates through Kodi's WebSocket (port 9090), with a fallback that
  reads Kodi every 10 seconds over HTTP when that port is closed.
- **Find Kodi on the network** (mDNS, through Gladys): the Kodi found fill the
  free address slots. Once by itself on the first start, and on every scan
  from the Discovery tab.
- "Kodi" dashboard widget: artwork from Kodi's library, title, media type,
  state, position, end time, volume, and play/pause, stop or next, volume
  down and up buttons.
- Scene triggers: playback started, paused, resumed and stopped, filtered by
  Kodi and media type, with the title and the media type; the stop says
  whether the media reached its end. The next item of a playlist is a start,
  not a stop then a start.
- Scene actions: control the playback, set the volume, mute or unmute, show a
  notification on Kodi, play a media by path or URL, update the video or music
  library, read what Kodi plays.
- "Test the connection" action, and a connection status that says which Kodi
  needs attention (no answer, password refused, artwork unavailable).
- English, French, German and Spanish texts and documentation.

[Unreleased]: https://github.com/guim31/gladys-kodi/compare/v1.0.2...HEAD
[1.0.2]: https://github.com/guim31/gladys-kodi/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/guim31/gladys-kodi/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/guim31/gladys-kodi/releases/tag/v1.0.0
