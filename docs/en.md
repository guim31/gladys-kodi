# Kodi

Follow and control [Kodi](https://kodi.tv), the free media center (LibreELEC, OSMC, CoreELEC,
Kodi on a PC, an Android TV box or an NVIDIA Shield), from Gladys: what plays, its progress, the
volume, the playback buttons, and scenes that react when a movie starts, pauses or stops.

Everything stays on your local network: the integration talks to Kodi directly, through its
JSON-RPC interface.

Tested against Kodi 20 and 21 running in Docker, not yet on LibreELEC, OSMC, CoreELEC or an
Android box: feedback welcome on the Gladys forum.

## Requirements

- Gladys Assistant 5.3 or later (version 1.0 of the integration stays available for Gladys 5.1 and 5.2).
- Kodi 19 or later (tested on 20 and 21), on the same local network as Gladys.
- In Kodi, **Settings → Services → Control**:
  - **Allow remote control via HTTP**: on. Note the port (8080 by default), the user name
    (`kodi` by default) and the password, if you set one.
  - **Allow remote control from applications on other systems**: on. It opens port 9090, through
    which Kodi tells Gladys in real time what happens. Without it, the integration still works but
    reads Kodi every 10 seconds.
- To be found automatically: **Settings → Services → General → Announce services to other
  systems** on (the default).
- Give the device running Kodi a fixed IP address (a DHCP reservation in your router).

## Configuration

1. Install the integration from the Gladys store, then open its **Configuration** tab.
2. Click **Find Kodi on the network**: each Kodi found takes a free slot (three at most). Reload
   the page to see their addresses. Or type the address yourself, e.g. `192.168.1.40`, or
   `192.168.1.40:8081` if the web server of Kodi does not use port 8080.
3. If Kodi asks for a password, fill in the **User name** (empty means `kodi`) and the
   **Password** of the slot, then save.
4. **Test the connection**: one line per Kodi, with its name, its version and what it does.
5. In the **Discovery** tab, add each Kodi to Gladys.

The **Language** option picks the language of the feature names and of the texts the integration
creates (French by default). Feature names are set when the device is added.

On its first start without any address, the integration searches the network once by itself.
A scan from the Discovery tab searches again.

## Gladys 5.3 music player

Since Gladys 5.3, the dashboard **Music** box is a real player: pick your Kodi and it shows what
plays (artwork, title, artist, album; for an episode: the episode, the show and the season; for a
movie: its title), a progress bar you drag to seek, play / pause, previous / next, shuffle,
repeat, the volume and mute.

- **Music panel**: the box's magnifier browses Kodi's music library (**Artists**, **Albums**,
  **Playlists**, **Favourites**, **Files** of your sources) and searches it; a tap starts a song,
  an album, an artist or a playlist, right now, after the current song or at the end of the list.
  The same picker serves the Gladys scene action **Play music on a speaker** (_at 7 am, start the
  "Morning" playlist in the living room_).
- **Queue**: the list icon shows Kodi's playlist (the music one, or the video one while a video
  plays), the current item highlighted; a tap jumps to it. Kodi keeps its playlist after a stop:
  **Play** starts it again from the top.
- "Right now" replaces Kodi's music playlist and starts it; "next" and "at the end" extend it
  without interrupting anything.
- The artwork is resized by Kodi itself (300 px for the player, 64 px for lists) and served by the
  integration: the browser never contacts Kodi.
- The "Now playing" text feature (`Artist – Song`, "Nothing playing") stays for your scenes; the
  Music box uses the new "Title" feature.

**Kodi added before version 1.1**: open the **Discover** tab and click **Update** on the Kodi
device to get the new features. The Play, Pause, Previous, Next buttons, the volume and mute keep
their identifier: your scenes and dashboards keep working. Until that update, mute stays a button that toggles; then it is set (1 mutes, 0 unmutes): a scene that "pressed" Mute now mutes instead of toggling.

## The Kodi device

One device per Kodi, named as Kodi names itself (Settings → Services → General → Device name).
The slot number is its identity: a Kodi that changes address keeps its device and its history.

| Feature              | Type         | Content                                                   |
| -------------------- | ------------ | --------------------------------------------------------- |
| Playback             | text         | Playing, Paused, Stopped, Off or unreachable              |
| Now playing          | text         | `Movie (2024)`, `Show S01E02 – Title`, `Artist – Song`... |
| Media type           | text         | Movie, TV episode, Music, TV channel, Video, None         |
| Progress             | percentage   | Position in the media, 0 for a live stream                |
| Time left            | minutes      | Until the end of the media, 0 for a live stream           |
| Volume               | slider 0–100 | Kodi's volume, follows the remote                         |
| Play, Pause          | buttons      | Resume, pause                                             |
| Stop                 | button       | Stops playback                                            |
| Previous/Next        | buttons      | Previous or next item of the playlist                     |
| Mute                 | switch       | Mutes or unmutes                                          |
| Playback state       | player       | Paused, playing, stopped; controllable                    |
| Title, Artist, Album | player       | What plays, for the Music box (empty when stopped)        |
| Artwork              | player       | The library artwork, served by the integration            |
| Duration, Position   | player       | In seconds; writing the position seeks                    |
| Shuffle, Repeat      | player       | Modes of Kodi's playlist; controllable                    |

"Video" is what Kodi plays outside its library: a file opened from a folder, a stream, an
add-on. Movies and episodes of the library are "Movie" and "TV episode".

Kodi reports its changes in real time (port 9090); while something plays, the progress is read
every 10 seconds. With port 9090 closed, everything is read every 10 seconds over HTTP.

## Dashboard widget

For music, the Gladys **Music** box (above) comes first. The **Kodi** widget (choose the Kodi in its settings) shows the artwork of what plays (when it
comes from the library), the title, the media type, the state, the position, the end time and the
volume. Its buttons follow the media: play/pause, then stop (video) or next (music), and volume
down / up by 5 %.

Without artwork, a progress gauge takes its place once the device is added to Gladys.

## Scene triggers

| Trigger          | When                                                                |
| ---------------- | ------------------------------------------------------------------- |
| Playback started | Kodi starts a media after nothing played, or the next one of a list |
| Playback paused  | Kodi pauses                                                         |
| Playback resumed | Kodi resumes after a pause                                          |
| Playback stopped | Playback stops or reaches its end, and nothing follows              |

Each trigger can be limited to one Kodi and to some media types (movie, TV episode, music, TV
channel, other video). Variables for the next steps: **Title**, **Media type**, **Kodi name**,
and for a stop, **Reached the end**.

Between two episodes of a playlist, Kodi stops then starts again within a tenth of a second: the
integration waits 1.5 seconds before saying "stopped", so the next episode is a "started" and
the lights do not flash.

The triggers follow what Kodi really does, whatever started it: the remote, the widget or a
scene action. Nothing fires for what was already playing when the integration started, nor when
Kodi is turned off.

## Scene actions

| Action                      | What it does                                                      |
| --------------------------- | ----------------------------------------------------------------- |
| Control the playback        | Play, pause, play/pause, stop, next, previous                     |
| Set the volume              | Volume from 0 to 100                                              |
| Mute or unmute              | Mute, unmute or toggle                                            |
| Show a notification on Kodi | A message with a title in the corner of the screen                |
| Play a media                | A file, a folder or a stream, by its path or URL as Kodi knows it |
| Update the library          | Kodi scans its video or music sources for new media               |
| Read what Kodi plays        | State, title, media type, progress, minutes left, volume          |

"Control the playback" returns **Applied**: false when nothing was playing, without failing the
scene. "Read what Kodi plays" gives the next steps what they need for an "only continue if"
condition: state (`off`, `stopped`, `playing`, `paused`), media type (`movie`, `episode`, `music`,
`tv`, `video`)...

## Scene examples

- **Movie night**: trigger "Playback started" on the living room Kodi, media type Movie and Other
  video → dim the living room lights to 10 %. Trigger "Playback paused" → lights to 50 %.
  Trigger "Playback resumed" → back to 10 %. Trigger "Playback stopped" → lights to 100 %.
- **Doorbell**: when the doorbell rings → "Show a notification on Kodi" ("Someone at the door")
  and "Control the playback: pause".
- **Bedtime**: at 11:30 pm → "Read what Kodi plays", only continue if the state is `stopped` →
  turn off the TV plug.
- **New downloads**: when your download box says it finished → "Update the library" (videos).

Do not start a playback from a "Playback started" scene: it would start itself again and again.

## Troubleshooting

- **"no answer (turned off, or remote control disabled)"**: Kodi is off, or "Allow remote control
  via HTTP" is off, or the address or port is wrong. Open `http://<address>:8080` in a browser:
  Kodi's web interface (or its login prompt) must appear.
- **"user name or password refused"**: check the user name and password of Settings → Services →
  Control. An empty user name means `kodi`.
- **"password refused by the web server, no artwork"**: everything works through port 9090, but
  the artwork comes through the web server: fix the password.
- **"Test the connection" says "no live updates"**: turn on "Allow remote control from
  applications on other systems". Kodi's port 9090 cannot be changed from its menus.
- **Nothing found on the network**: turn on "Announce services to other systems", or type the
  address. The search needs Gladys on the same network as Kodi (Docker in host network mode,
  the usual setup).
- **No artwork**: Kodi only serves the artwork of its library; a file opened from a folder has
  none. The integration asks Kodi for a 300 px version (checked on Kodi 21); an image served above
  300 KB is not shown.
- **The Music box has no title nor artwork**: Kodi added before version 1.1? Click **Update** in
  the Discover tab.
- **"Update the library" does nothing**: Kodi only scans the sources whose content type is set
  (Videos → Files → the source → Set content).

## Limits

- Three Kodi at most.
- The WebSocket port is 9090 (Kodi's default, only changed in `advancedsettings.xml`).
- No power on/off: Kodi cannot be woken up through its interface. A Kodi turned off shows "Off or
  unreachable" and fires no trigger.
- Pictures (slideshows) are ignored; when music plays behind a video, the video wins.
- The artwork is shown when Kodi serves it under 300 KB: the integration asks for the 300 px
  version (checked on Kodi 21.2), which Kodi keeps in its thumbnail cache as well.
- The Music panel search is Kodi's: case-insensitive, but not accent-insensitive ("cafe" does
  not find "Café"). It covers music (artists, albums, songs, playlists), not videos nor Live TV
  radio channels.
- Shuffle and repeat only exist while something plays (Kodi ties them to the player).
- Not affiliated with the Kodi Foundation (XBMC Foundation), owner of the Kodi trademark.
