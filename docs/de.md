# Kodi

Verfolge und steuere [Kodi](https://kodi.tv), das freie Mediacenter (LibreELEC, OSMC, CoreELEC,
Kodi auf einem PC, einer Android-TV-Box oder einem NVIDIA Shield), aus Gladys: was läuft, den
Fortschritt, die Lautstärke, die Wiedergabetasten und Szenen, die reagieren, wenn ein Film
startet, pausiert oder stoppt.

Alles bleibt in deinem lokalen Netzwerk: Die Integration spricht direkt mit Kodi, über seine
JSON-RPC-Schnittstelle.

Getestet mit Kodi 20 und 21 in Docker, noch nicht auf LibreELEC, OSMC, CoreELEC oder einer
Android-Box: Rückmeldungen im Gladys-Forum sind willkommen.

## Voraussetzungen

- Gladys Assistant 5.3 oder neuer (Version 1.0 der Integration bleibt für Gladys 5.1 und 5.2 verfügbar).
- Kodi 19 oder neuer (getestet mit 20 und 21), im selben lokalen Netzwerk wie Gladys.
- In Kodi, **Einstellungen → Dienste → Steuerung**:
  - **Fernsteuerung via HTTP erlauben**: an. Merke dir den Port (standardmäßig 8080), den
    Benutzernamen (standardmäßig `kodi`) und das Passwort, falls du eines gesetzt hast.
  - **Fernsteuerung durch Anwendungen auf anderen Systemen erlauben**: an. Das öffnet Port 9090,
    über den Kodi Gladys in Echtzeit mitteilt, was passiert. Ohne ihn funktioniert die
    Integration trotzdem, liest Kodi aber alle 10 Sekunden ab.
- Damit Kodi automatisch gefunden wird: **Einstellungen → Dienste → Allgemein → Dienste anderen
  Systemen ankündigen** an (die Voreinstellung).
- Gib dem Gerät, auf dem Kodi läuft, eine feste IP-Adresse (DHCP-Reservierung im Router).

## Konfiguration

1. Installiere die Integration aus dem Gladys-Store und öffne ihren Reiter **Konfiguration**.
2. Klicke auf **Kodi im Netzwerk suchen**: Jedes gefundene Kodi belegt einen freien Platz
   (höchstens drei). Lade die Seite neu, um ihre Adressen zu sehen. Oder gib die Adresse selbst
   ein, z. B. `192.168.1.40`, oder `192.168.1.40:8081`, wenn der Webserver von Kodi nicht Port
   8080 nutzt.
3. Wenn Kodi ein Passwort verlangt, fülle **Benutzername** (leer bedeutet `kodi`) und
   **Passwort** des Platzes aus und speichere.
4. **Verbindung testen**: eine Zeile pro Kodi, mit Name, Version und dem, was es gerade tut.
5. Füge jedes Kodi im Reiter **Entdecken** zu Gladys hinzu.

Die Option **Sprache** wählt die Sprache der Funktionsnamen und der Texte, die die Integration
erzeugt (standardmäßig Französisch). Funktionsnamen werden beim Hinzufügen des Geräts
festgelegt.

Beim ersten Start ohne Adresse sucht die Integration einmal selbst im Netzwerk. Ein Scan im
Reiter Entdecken sucht erneut.

## Musik-Player von Gladys 5.3

Seit Gladys 5.3 ist die **Musik**-Box im Dashboard ein echter Player: Wähle dein Kodi, und sie
zeigt, was läuft (Cover, Titel, Interpret, Album; bei einer Episode: die Episode, die Serie und
die Staffel; bei einem Film: sein Titel), einen Fortschrittsbalken zum Spulen, Wiedergabe /
Pause, zurück / weiter, Zufallswiedergabe, Wiederholen, die Lautstärke und Stumm.

- **Musik-Panel**: Die Lupe der Box durchsucht die Musikbibliothek von Kodi (**Interpreten**,
  **Alben**, **Wiedergabelisten**, **Favoriten**, **Dateien** deiner Quellen); ein Tippen startet
  einen Titel, ein Album, einen Interpreten oder eine Wiedergabeliste, sofort, nach dem aktuellen
  Titel oder am Ende der Liste. Dieselbe Auswahl dient der Gladys-Szenenaktion **Musik auf einem
  Lautsprecher abspielen** (_um 7 Uhr die Liste „Morgen“ im Wohnzimmer starten_).
- **Warteschlange**: Das Listen-Symbol zeigt die Wiedergabeliste von Kodi (die Musikliste, oder
  die Videoliste, während ein Video läuft), das aktuelle Element hervorgehoben; ein Tippen springt
  dorthin. Kodi behält seine Liste nach einem Stopp: **Wiedergabe** startet sie von vorn.
- „Sofort“ ersetzt die Musik-Wiedergabeliste von Kodi und startet sie; „als Nächstes“ und „am
  Ende“ verlängern sie, ohne etwas zu unterbrechen.
- Die Cover verkleinert Kodi selbst (300 px für den Player, 64 px für Listen), die Integration
  liefert sie aus: Der Browser kontaktiert Kodi nie.
- Die Text-Funktion „Läuft gerade“ (`Interpret – Titel`, „Keine Wiedergabe“) bleibt für deine
  Szenen; die Musik-Box nutzt die neue Funktion „Titel“.

**Kodi vor Version 1.1 hinzugefügt**: Öffne den Tab **Entdecken** und klicke beim Kodi-Gerät auf
**Aktualisieren**, um die neuen Funktionen zu erhalten. Die Tasten Abspielen, Pause, Zurück,
Weiter, die Lautstärke und Stumm behalten ihre Kennung: Deine Szenen und Dashboards funktionieren
weiter. Bis zu dieser Aktualisierung bleibt Stumm eine Taste, die umschaltet; danach wird es gesetzt (1 schaltet stumm, 0 wieder an): Eine Szene, die Stumm „drückte“, schaltet jetzt stumm statt umzuschalten.

## Das Kodi-Gerät

Ein Gerät pro Kodi, benannt so, wie Kodi sich selbst nennt (Einstellungen → Dienste → Allgemein
→ Gerätename). Die Nummer des Platzes ist seine Identität: Ein Kodi, das seine Adresse wechselt,
behält Gerät und Verlauf.

| Funktion                       | Typ          | Inhalt                                                      |
| ------------------------------ | ------------ | ----------------------------------------------------------- |
| Wiedergabe                     | Text         | Wiedergabe, Pausiert, Gestoppt, Aus oder nicht erreichbar   |
| Läuft gerade                   | Text         | `Film (2024)`, `Serie S01E02 – Titel`, `Künstler – Lied`... |
| Medientyp                      | Text         | Film, Serienfolge, Musik, TV-Sender, Video, Keiner          |
| Fortschritt                    | Prozent      | Position im Medium, 0 bei einem Livestream                  |
| Restzeit                       | Minuten      | Bis zum Ende des Mediums, 0 bei einem Livestream            |
| Lautstärke                     | Regler 0–100 | Die Lautstärke von Kodi, folgt der Fernbedienung            |
| Abspielen, Pause               | Tasten       | Fortsetzen, pausieren                                       |
| Stopp                          | Taste        | Stoppt die Wiedergabe                                       |
| Zurück, Weiter                 | Tasten       | Vorheriger oder nächster Titel der Wiedergabeliste          |
| Stumm                          | Schalter     | Schaltet den Ton stumm oder wieder an                       |
| Wiedergabestatus               | Player       | Pausiert, läuft, gestoppt; steuerbar                        |
| Titel, Interpret, Album        | Player       | Was läuft, für die Musik-Box (leer im Stopp)                |
| Cover                          | Player       | Das Cover der Bibliothek, von der Integration geliefert     |
| Dauer, Position                | Player       | In Sekunden; die Position schreiben spult dorthin           |
| Zufallswiedergabe, Wiederholen | Player       | Modi der Wiedergabeliste von Kodi; steuerbar                |

„Video“ ist das, was Kodi außerhalb seiner Mediathek abspielt: eine aus einem Ordner geöffnete
Datei, ein Stream, ein Add-on. Filme und Folgen der Mediathek sind „Film“ und „Serienfolge“.

Kodi meldet seine Änderungen in Echtzeit (Port 9090); während der Wiedergabe wird der Fortschritt
alle 10 Sekunden gelesen. Ist Port 9090 geschlossen, wird alles alle 10 Sekunden über HTTP
gelesen.

## Dashboard-Widget

Für Musik ist die **Musik**-Box von Gladys (oben) die erste Wahl. Das Widget **Kodi** (wähle das Kodi in seinen Einstellungen) zeigt das Cover dessen, was läuft
(wenn es aus der Mediathek kommt), den Titel, den Medientyp, den Status, die Position, die Endzeit
und die Lautstärke. Seine Tasten richten sich nach dem Medium: Abspielen/Pause, dann Stopp
(Video) oder Weiter (Musik), und leiser / lauter in Schritten von 5 %.

Ohne Cover nimmt eine Fortschrittsanzeige seinen Platz ein, sobald das Gerät in Gladys
hinzugefügt ist.

## Szenen-Auslöser

| Auslöser               | Wann                                                                       |
| ---------------------- | -------------------------------------------------------------------------- |
| Wiedergabe gestartet   | Kodi startet ein Medium, nachdem nichts lief, oder das nächste einer Liste |
| Wiedergabe pausiert    | Kodi pausiert                                                              |
| Wiedergabe fortgesetzt | Kodi setzt nach einer Pause fort                                           |
| Wiedergabe gestoppt    | Die Wiedergabe stoppt oder endet, und nichts folgt                         |

Jeder Auslöser lässt sich auf ein Kodi und auf bestimmte Medientypen beschränken (Film,
Serienfolge, Musik, TV-Sender, anderes Video). Variablen für die nächsten Schritte: **Titel**,
**Medientyp**, **Kodi-Name** und bei einem Stopp **Bis zum Ende**.

Zwischen zwei Folgen einer Wiedergabeliste stoppt Kodi und startet innerhalb einer
Zehntelsekunde neu: Die Integration wartet 1,5 Sekunden, bevor sie „gestoppt“ meldet, sodass die
nächste Folge ein „gestartet“ ist und das Licht nicht flackert.

Die Auslöser folgen dem, was Kodi wirklich tut, egal woher es kommt: Fernbedienung, Widget oder
Szenenaktion. Für das, was beim Start der Integration schon lief, und wenn Kodi ausgeschaltet
wird, wird nichts ausgelöst.

## Szenenaktionen

| Aktion                             | Was sie tut                                                                    |
| ---------------------------------- | ------------------------------------------------------------------------------ |
| Wiedergabe steuern                 | Abspielen, Pause, Abspielen/Pause, Stoppen, Weiter, Zurück                     |
| Lautstärke einstellen              | Lautstärke von 0 bis 100                                                       |
| Stumm schalten oder aufheben       | Stumm, Ton an oder umschalten                                                  |
| Benachrichtigung auf Kodi anzeigen | Eine Nachricht mit Titel in der Bildschirmecke                                 |
| Medium abspielen                   | Eine Datei, ein Ordner oder ein Stream, über Pfad oder URL, wie Kodi sie kennt |
| Mediathek aktualisieren            | Kodi sucht in seinen Video- oder Musikquellen nach neuen Medien                |
| Kodi-Status lesen                  | Status, Titel, Medientyp, Fortschritt, Restminuten, Lautstärke                 |

„Wiedergabe steuern“ gibt **Ausgeführt** zurück: falsch, wenn nichts lief, ohne dass die Szene
fehlschlägt. „Kodi-Status lesen“ gibt den nächsten Schritten, was sie für eine Bedingung „nur
fortfahren, wenn“ brauchen: Status (`off`, `stopped`, `playing`, `paused`), Medientyp (`movie`,
`episode`, `music`, `tv`, `video`)...

## Szenenbeispiele

- **Filmabend**: Auslöser „Wiedergabe gestartet“ auf dem Wohnzimmer-Kodi, Medientypen Film und
  anderes Video → Wohnzimmerlicht auf 10 % dimmen. Auslöser „Wiedergabe pausiert“ → Licht auf
  50 %. Auslöser „Wiedergabe fortgesetzt“ → zurück auf 10 %. Auslöser „Wiedergabe gestoppt“ →
  Licht auf 100 %.
- **Türklingel**: Wenn es klingelt → „Benachrichtigung auf Kodi anzeigen“ („Jemand an der Tür“)
  und „Wiedergabe steuern: Pause“.
- **Schlafenszeit**: um 23:30 Uhr → „Kodi-Status lesen“, nur fortfahren, wenn der Status
  `stopped` ist → Steckdose des Fernsehers ausschalten.
- **Neue Downloads**: Wenn deine Download-Box fertig meldet → „Mediathek aktualisieren“ (Videos).

Starte keine Wiedergabe aus einer Szene, die von „Wiedergabe gestartet“ ausgelöst wird: Das
ergäbe eine Endlosschleife.

## Fehlerbehebung

- **„keine Antwort (ausgeschaltet oder Fernsteuerung deaktiviert)“**: Kodi ist aus, oder
  „Fernsteuerung via HTTP erlauben“ ist aus, oder Adresse oder Port stimmen nicht. Öffne
  `http://<adresse>:8080` im Browser: Die Weboberfläche von Kodi (oder seine Anmeldeabfrage) muss
  erscheinen.
- **„Benutzername oder Passwort abgelehnt“**: Prüfe Benutzername und Passwort unter Einstellungen
  → Dienste → Steuerung. Ein leerer Benutzername bedeutet `kodi`.
- **„Passwort vom Webserver abgelehnt, keine Cover“**: Alles funktioniert über Port 9090, aber
  die Cover kommen über den Webserver: Korrigiere das Passwort.
- **„Verbindung testen“ meldet „keine Live-Updates“**: Aktiviere „Fernsteuerung durch
  Anwendungen auf anderen Systemen erlauben“. Port 9090 von Kodi lässt sich nicht in seinen
  Menüs ändern.
- **Nichts im Netzwerk gefunden**: Aktiviere „Dienste anderen Systemen ankündigen“ oder gib die
  Adresse ein. Die Suche setzt voraus, dass Gladys im selben Netzwerk wie Kodi ist (Docker im
  Host-Netzwerkmodus, die übliche Installation).
- **Kein Cover**: Kodi liefert nur die Cover seiner Mediathek; eine aus einem Ordner geöffnete
  Datei hat keines. Die Integration fragt Kodi nach einer 300-px-Version (auf Kodi 21 geprüft);
  ein über 300 KB geliefertes Bild wird nicht angezeigt.
- **Die Musik-Box zeigt weder Titel noch Cover**: Kodi vor Version 1.1 hinzugefügt? Klicke im Tab
  Entdecken auf **Aktualisieren**.
- **„Mediathek aktualisieren“ tut nichts**: Kodi durchsucht nur Quellen, deren Inhaltstyp
  festgelegt ist (Videos → Dateien → die Quelle → Inhalt festlegen).

## Grenzen

- Höchstens drei Kodi.
- Der WebSocket-Port ist 9090 (Kodis Standard, nur in `advancedsettings.xml` änderbar).
- Kein Ein- und Ausschalten: Kodi lässt sich über seine Schnittstelle nicht aufwecken. Ein
  ausgeschaltetes Kodi zeigt „Aus oder nicht erreichbar“ und löst nichts aus.
- Bilder (Diashows) werden ignoriert; läuft Musik hinter einem Video, gewinnt das Video.
- Das Cover wird angezeigt, wenn Kodi es unter 300 KB liefert: Die Integration fragt nach der
  300-px-Version (auf Kodi 21.2 geprüft), die Kodi zusätzlich in seinem Miniaturbild-Cache behält.
- Die Suche im Musik-Panel ist die von Kodi: ohne Groß-/Kleinschreibung, aber mit Akzenten
  („cafe“ findet „Café“ nicht) und umfasst Musik (Interpreten, Alben, Titel, Wiedergabelisten),
  keine Videos und keine Radiosender des Live-TV.
- Zufallswiedergabe und Wiederholen gibt es nur während einer Wiedergabe (Kodi bindet sie an den
  Player).
- Nicht mit der Kodi Foundation (XBMC Foundation), Inhaberin der Marke Kodi, verbunden.
