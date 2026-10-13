# Kodi

Verfolge und steuere [Kodi](https://kodi.tv), das freie Mediacenter (LibreELEC, OSMC, CoreELEC,
Kodi auf einem PC, einer Android-TV-Box oder einem NVIDIA Shield), aus Gladys: was läuft, den
Fortschritt, die Lautstärke, die Wiedergabetasten und Szenen, die reagieren, wenn ein Film
startet, pausiert oder stoppt.

Alles bleibt in deinem lokalen Netzwerk: Die Integration spricht direkt mit Kodi, über seine
JSON-RPC-Schnittstelle.

Getestet mit Kodi 20, 21 und 22 in Docker, noch nicht auf LibreELEC, OSMC, CoreELEC oder einer
Android-Box: Rückmeldungen im Gladys-Forum sind willkommen.

## Voraussetzungen

- Gladys Assistant 5.1 oder neuer.
- Kodi 19 oder neuer (getestet mit 20, 21 und 22), im selben lokalen Netzwerk wie Gladys.
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

## Das Kodi-Gerät

Ein Gerät pro Kodi, benannt so, wie Kodi sich selbst nennt (Einstellungen → Dienste → Allgemein
→ Gerätename). Die Nummer des Platzes ist seine Identität: Ein Kodi, das seine Adresse wechselt,
behält Gerät und Verlauf.

| Funktion         | Typ          | Inhalt                                                      |
| ---------------- | ------------ | ----------------------------------------------------------- |
| Wiedergabe       | Text         | Wiedergabe, Pausiert, Gestoppt, Aus oder nicht erreichbar   |
| Läuft gerade     | Text         | `Film (2024)`, `Serie S01E02 – Titel`, `Künstler – Lied`... |
| Medientyp        | Text         | Film, Serienfolge, Musik, TV-Sender, Video, Keiner          |
| Fortschritt      | Prozent      | Position im Medium, 0 bei einem Livestream                  |
| Restzeit         | Minuten      | Bis zum Ende des Mediums, 0 bei einem Livestream            |
| Lautstärke       | Regler 0–100 | Die Lautstärke von Kodi, folgt der Fernbedienung            |
| Abspielen, Pause | Tasten       | Fortsetzen, pausieren                                       |
| Stopp            | Taste        | Stoppt die Wiedergabe                                       |
| Zurück, Weiter   | Tasten       | Vorheriger oder nächster Titel der Wiedergabeliste          |
| Stumm            | Taste        | Schaltet den Ton stumm oder wieder an                       |

„Video“ ist das, was Kodi außerhalb seiner Mediathek abspielt: eine aus einem Ordner geöffnete
Datei, ein Stream, ein Add-on. Filme und Folgen der Mediathek sind „Film“ und „Serienfolge“.

Kodi meldet seine Änderungen in Echtzeit (Port 9090); während der Wiedergabe wird der Fortschritt
alle 10 Sekunden gelesen. Ist Port 9090 geschlossen, wird alles alle 10 Sekunden über HTTP
gelesen.

## Dashboard-Widget

Das Widget **Kodi** (wähle das Kodi in seinen Einstellungen) zeigt das Cover dessen, was läuft
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
- **Kein Cover im Widget**: Kodi liefert nur die Cover seiner Mediathek; eine aus einem Ordner
  geöffnete Datei hat keines. Ein Bild über 300 KB wird ebenfalls nicht angezeigt.
- **„Mediathek aktualisieren“ tut nichts**: Kodi durchsucht nur Quellen, deren Inhaltstyp
  festgelegt ist (Videos → Dateien → die Quelle → Inhalt festlegen).

## Grenzen

- Höchstens drei Kodi.
- Der WebSocket-Port ist 9090 (Kodis Standard, nur in `advancedsettings.xml` änderbar).
- Kein Ein- und Ausschalten: Kodi lässt sich über seine Schnittstelle nicht aufwecken. Ein
  ausgeschaltetes Kodi zeigt „Aus oder nicht erreichbar“ und löst nichts aus.
- Bilder (Diashows) werden ignoriert; läuft Musik hinter einem Video, gewinnt das Video.
- Das Cover wird angezeigt, wenn Kodi es unter 300 KB liefert (Kodi speichert Poster mit 720 px
  im Cache).
- Nicht mit der Kodi Foundation (XBMC Foundation), Inhaberin der Marke Kodi, verbunden.
