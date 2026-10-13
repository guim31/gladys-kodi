# Kodi for Gladys Assistant

An external integration for [Gladys Assistant](https://gladysassistant.com) that
follows and controls [Kodi](https://kodi.tv) media centers (LibreELEC, OSMC,
CoreELEC, Kodi on a PC, an Android TV box or an NVIDIA Shield) over the local
network, through Kodi's JSON-RPC interface: its WebSocket for real-time
notifications, its web server for the rest. No cloud, no account.

> **Tested against a real Kodi, not yet on LibreELEC, OSMC, CoreELEC or an
> Android box: feedback welcome.** Playback was exercised on Kodi 20.1 (Debian
> package, in Docker with a virtual display and a silent sound card): a video
> file, a song of the music library, pause, resume, volume, mute, seek, stop, the
> end of a media and of a playlist, the web server password, the artwork. The
> calls and the WebSocket were also checked on Kodi 21.3 (a headless
> image, which cannot play). Please report what works and what does not in the
> [issues](https://github.com/guim31/gladys-kodi/issues).

## Features

- **One device per Kodi** (up to three): playback state, what is playing
  (`Movie (2024)`, `Show S01E02 – Title`, `Artist – Song`), media type,
  progress, time left, a volume slider, and play / pause / stop / previous /
  next / mute buttons.
- **Real time** through Kodi's WebSocket (port 9090), with an HTTP polling
  fallback every 10 seconds when that port is closed.
- **Find Kodi on the network**: the Gladys core browses mDNS
  (`_xbmc-jsonrpc-h._tcp`, `_xbmc-jsonrpc._tcp`) for the integration, and the
  Kodi found fill the free address slots. The address can also be typed.
- **Dashboard widget "Kodi"**: artwork, title, media type, state, position,
  end time, volume, and the buttons that fit the media (play/pause, stop or
  next, volume down and up).
- **Scene triggers**: playback started, paused, resumed, stopped — filtered by
  Kodi and media type (movie, TV episode, music, TV channel, other video), with
  the title and the media type as variables. The next item of a playlist is a
  "started", not a "stopped" then a "started".
- **Scene actions**: control the playback, set the volume, mute, show a
  notification on Kodi, play a media by path or URL, update the library, and
  read what Kodi plays (for an "only continue if" condition).
- Texts in English, French, German and Spanish.

## Requirements

- Gladys Assistant 5.1 or later.
- Kodi 19 or later, with **Settings → Services → Control → Allow remote control
  via HTTP** and **Allow remote control from applications on other systems**
  turned on.

## Installation

1. In Gladys, open **Integrations → Install from GitHub** and enter
   `https://github.com/guim31/gladys-kodi` (or find **Kodi** in the catalog).
2. In **Configuration**, click **Find Kodi on the network** (or type the
   address of Kodi), and fill in the password if Kodi asks for one.
3. Add each Kodi from the **Discover** tab.

The user guide is in [`docs/en.md`](docs/en.md) (also in
[French](docs/fr.md), [German](docs/de.md) and [Spanish](docs/es.md)); Gladys
links it from the Configuration screen.

## How it works

- Each configured Kodi gets a WebSocket to `ws://<host>:9090/jsonrpc` (no
  authentication on that port) for the calls and the notifications
  (`Player.OnPlay`, `OnPause`, `OnResume`, `OnStop`,
  `Application.OnVolumeChanged`...). A notification triggers a read of
  `Player.GetActivePlayers`, `Player.GetProperties`, `Player.GetItem` and
  `Application.GetProperties`; Kodi pushes no position, so the progress is
  read every 10 seconds while something plays. A ping every 30 seconds tells
  a dead link from a quiet one.
- When the WebSocket is closed, the same reads go over HTTP
  (`POST /jsonrpc`, Basic authentication) every 10 seconds, and the
  transitions are found by comparing two reads. A Kodi that does not answer
  is tried every 30 seconds.
- Between two items of a playlist Kodi sends `Player.OnStop` (`end: true`)
  then `Player.OnPlay` a tenth of a second later: the read after a stop waits
  1.5 seconds, so scenes see one start and no stop.
- The artwork comes from Kodi's texture cache (`GET /image/<image://...>`,
  only the art of the library), at most 300 KB, served to the widget by key.
- `/data/kodi-state.json` keeps the name each Kodi gives itself and whether the
  first automatic search ran. No secret there.

## Limitations

- Three Kodi at most; the WebSocket port is 9090 (Kodi's default).
- No power on or off. A Kodi turned off shows "Off or unreachable" and fires no
  trigger; coming back with the same media fires none either.
- Pictures (slideshows) are ignored.
- Only the artwork of Kodi's library is shown, and only under 300 KB.

## Development

Node.js 22+, ESM, no build step. The only runtime dependency is
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js).

```bash
npm install
npm test              # node --test: unit tests + simulated Kodi instances
npm run lint
npm run format:check
npx github:GladysAssistant/integration-store .   # store validator
```

```
index.js                SDK wiring (src/app.js registers the handlers)
src/hub.js              instances, devices, states, connection status, scene events, artwork, search
src/instance.js         one Kodi: WebSocket + HTTP fallback, reads, transitions, commands
src/devices.js          Kodi -> Gladys device, snapshot -> states
src/discovery.js        mDNS answers -> Kodi found -> free slots
src/kodi/http.js        JSON-RPC over HTTP, images, error kinds, no redirect
src/kodi/socket.js      JSON-RPC over WebSocket, notifications, reconnection, ping
src/kodi/model.js       reading Kodi's answers, titles, media types, transitions
src/widgets.js          "Kodi" dashboard widget
src/scenes.js           scene actions
src/texts.js            every text, in four languages
test/                   node --test; the SDK's fake Gladys, simulated Kodi
test/fixtures/kodi/     real Kodi 20.1 answers
```

`test/gladys-rules.test.js` checks every discovered device against the
category/type table extracted from the Gladys core.

To run it outside Gladys:

```bash
GLADYS_HOST_API_URL="http://localhost:1443" \
GLADYS_INTEGRATION_TOKEN="<token>" \
GLADYS_INTEGRATION_SELECTOR="kodi" \
KODI_DATA_DIR=./data \
npm start
```

Releases are made by the **Release** workflow (Actions → Release); never edit
the versions by hand. A hand-pushed `vX.Y.Z` tag also builds the image and the
GitHub Release, but then `version` in `package.json` and in the manifest (with
the `docker_image` tag) must be bumped and committed before tagging. See
[`CLAUDE.md`](CLAUDE.md) for the project rules.

## Credits

- Home Assistant's
  [`kodi`](https://github.com/home-assistant/core/tree/dev/homeassistant/components/kodi)
  integration (Apache-2.0): the mDNS services and their `uuid`, the WebSocket
  with an HTTP fallback, the device triggers. `test/fixtures/kodi/items-home-assistant.json`
  comes from its tests.
- [PyKodi](https://github.com/OnFreund/PyKodi) by On Freund (MIT): the
  JSON-RPC calls of each command and the `/image/` URL of the artwork.
- [Kodi](https://github.com/xbmc/xbmc) and its
  [JSON-RPC API documentation](https://kodi.wiki/view/JSON-RPC_API). The other
  fixtures were recorded on a real Kodi 20.1 in Docker. The cover uses the
  official Kodi logo by the XBMC Foundation, public domain, from
  [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Kodi-side-by-side.svg)
  (wordmark in white for the dark background).

## Disclaimer

This project is not affiliated with, endorsed or sponsored by the Kodi
Foundation (XBMC Foundation). "Kodi" is a trademark of the XBMC Foundation.

## License

Apache-2.0
