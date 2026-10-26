# Kodi fixtures

Answers recorded on a real Kodi 20.1 (Debian bookworm package, X11 on Xvfb,
PulseAudio null sink) in Docker, playing a generated test video outside the
library and a generated song from the music library, password `test-password`
on the web server:

- `application-properties.json`, `infolabels.json`, `active-players-*.json`,
  `item-*.json`, `properties-*.json`, `error-invalid-params.json`: JSON-RPC over
  HTTP (`POST /jsonrpc`);
- `http-401.json`: the same without the password;
- `notifications.json`: every WebSocket frame (port 9090) during the session:
  play a file, pause, resume, volume, mute, seek, stop, play a library song,
  seek to its end (`Player.OnStop` with `end: true`);
- `notifications-playlist.json`: two videos in a playlist, the first one played
  to its end: `Player.OnStop` (`end: true`) then `Player.OnPlay` 0.1 s later;
- `cover.jpg`: a small generated JPEG standing for an artwork served by
  `/image/`.

`items-home-assistant.json`: the `Player.GetItem` items of a movie, an episode,
a TV channel and a song from the Kodi tests of Home Assistant
(`tests/components/kodi/fixtures`, Apache License 2.0), with `art` and `year`
added in the shape Kodi uses.

`k21-*.json`: answers recorded on a real Kodi 21.2 (Debian trixie package, X11
on Xvfb, PulseAudio null sink) in Docker, with a generated library (two
artists, three albums of 40 s songs, one with a `cover.png`, an `Evening.m3u`
playlist, three favourites) and a generated video outside the library: the
music catalog (artists, albums, songs, playlists, sources, favourites, a
search), a song playing from the playlist (item, properties with shuffle,
repeat and position, the queue) and the video file.
