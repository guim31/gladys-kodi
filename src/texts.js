// -----------------------------------------------------------------------------
// Every text the container produces, in the four languages of the Gladys
// interface. German says "du", Spanish "usted" (test/i18n.test.js).
// A device integration never receives the user's language: the `language`
// field of the configuration picks one (default: French).
// -----------------------------------------------------------------------------

/** Feature names, frozen when the device is added to Gladys. */
export const NAMES = {
  en: {
    state: 'Playback',
    title: 'Now playing',
    media_type: 'Media type',
    progress: 'Progress',
    time_left: 'Time left',
    volume: 'Volume',
    mute: 'Mute',
    play: 'Play',
    pause: 'Pause',
    stop: 'Stop',
    previous: 'Previous',
    next: 'Next',
  },
  fr: {
    state: 'Lecture',
    title: 'En cours',
    media_type: 'Type de média',
    progress: 'Progression',
    time_left: 'Temps restant',
    volume: 'Volume',
    mute: 'Sourdine',
    play: 'Lire',
    pause: 'Pause',
    stop: 'Stop',
    previous: 'Précédent',
    next: 'Suivant',
  },
  de: {
    state: 'Wiedergabe',
    title: 'Läuft gerade',
    media_type: 'Medientyp',
    progress: 'Fortschritt',
    time_left: 'Restzeit',
    volume: 'Lautstärke',
    mute: 'Stumm',
    play: 'Abspielen',
    pause: 'Pause',
    stop: 'Stopp',
    previous: 'Zurück',
    next: 'Weiter',
  },
  es: {
    state: 'Reproducción',
    title: 'En reproducción',
    media_type: 'Tipo de medio',
    progress: 'Progreso',
    time_left: 'Tiempo restante',
    volume: 'Volumen',
    mute: 'Silencio',
    play: 'Reproducir',
    pause: 'Pausa',
    stop: 'Detener',
    previous: 'Anterior',
    next: 'Siguiente',
  },
};

/** The `state` feature (text), one label per state of src/kodi/model.js. */
export const STATE_LABELS = {
  en: { off: 'Off or unreachable', stopped: 'Stopped', playing: 'Playing', paused: 'Paused' },
  fr: {
    off: 'Éteint ou injoignable',
    stopped: 'Arrêté',
    playing: 'En lecture',
    paused: 'En pause',
  },
  de: {
    off: 'Aus oder nicht erreichbar',
    stopped: 'Gestoppt',
    playing: 'Wiedergabe',
    paused: 'Pausiert',
  },
  es: {
    off: 'Apagado o inaccesible',
    stopped: 'Detenido',
    playing: 'Reproduciendo',
    paused: 'En pausa',
  },
};

/** The `media_type` feature (text), one label per MEDIA_TYPES, plus none. */
export const MEDIA_LABELS = {
  en: {
    movie: 'Movie',
    episode: 'TV episode',
    music: 'Music',
    tv: 'TV channel',
    video: 'Video',
    none: 'None',
  },
  fr: {
    movie: 'Film',
    episode: 'Épisode',
    music: 'Musique',
    tv: 'Chaîne TV',
    video: 'Vidéo',
    none: 'Aucun',
  },
  de: {
    movie: 'Film',
    episode: 'Serienfolge',
    music: 'Musik',
    tv: 'TV-Sender',
    video: 'Video',
    none: 'Keiner',
  },
  es: {
    movie: 'Película',
    episode: 'Episodio',
    music: 'Música',
    tv: 'Canal de TV',
    video: 'Vídeo',
    none: 'Ninguno',
  },
};

/** The `title` feature when nothing plays (a text state is never empty). */
export const NOTHING_PLAYING = {
  en: 'Nothing playing',
  fr: 'Rien en lecture',
  de: 'Keine Wiedergabe',
  es: 'Nada en reproducción',
};

/** The `title` feature when Kodi gives no title at all. */
export const UNKNOWN_TITLE = {
  en: 'Unknown media',
  fr: 'Média inconnu',
  de: 'Unbekanntes Medium',
  es: 'Medio desconocido',
};

/** Connection status: why a Kodi needs attention (`slot` = its number). */
export const STATUS_TEXT = {
  en: {
    none: 'No Kodi configured yet: enter its address, or use "Find Kodi on the network".',
    invalid: (slot) => `Kodi ${slot}: the address is not valid.`,
    unreachable: (slot) => `Kodi ${slot}: no answer (turned off, or remote control disabled).`,
    unauthorized: (slot) => `Kodi ${slot}: user name or password refused.`,
    artwork: (slot) => `Kodi ${slot}: password refused by the web server, no artwork.`,
  },
  fr: {
    none: 'Aucun Kodi configuré : saisissez son adresse, ou utilisez « Chercher Kodi sur le réseau ».',
    invalid: (slot) => `Kodi ${slot} : l'adresse n'est pas valide.`,
    unreachable: (slot) =>
      `Kodi ${slot} : pas de réponse (éteint, ou contrôle à distance désactivé).`,
    unauthorized: (slot) => `Kodi ${slot} : nom d'utilisateur ou mot de passe refusé.`,
    artwork: (slot) => `Kodi ${slot} : mot de passe refusé par le serveur web, pas de pochettes.`,
  },
  de: {
    none: 'Noch kein Kodi eingerichtet: gib seine Adresse ein oder nutze „Kodi im Netzwerk suchen“.',
    invalid: (slot) => `Kodi ${slot}: Die Adresse ist ungültig.`,
    unreachable: (slot) =>
      `Kodi ${slot}: keine Antwort (ausgeschaltet oder Fernsteuerung deaktiviert).`,
    unauthorized: (slot) => `Kodi ${slot}: Benutzername oder Passwort abgelehnt.`,
    artwork: (slot) => `Kodi ${slot}: Passwort vom Webserver abgelehnt, keine Cover.`,
  },
  es: {
    none: 'Ningún Kodi configurado: introduzca su dirección o use «Buscar Kodi en la red».',
    invalid: (slot) => `Kodi ${slot}: la dirección no es válida.`,
    unreachable: (slot) => `Kodi ${slot}: sin respuesta (apagado o control remoto desactivado).`,
    unauthorized: (slot) => `Kodi ${slot}: usuario o contraseña rechazados.`,
    artwork: (slot) => `Kodi ${slot}: contraseña rechazada por el servidor web, sin carátulas.`,
  },
};

/** "Test the connection" action, one line per Kodi. */
export const TEST_TEXT = {
  en: {
    none: 'No Kodi configured.',
    ok: (slot, name, version, state) => `Kodi ${slot} (${name}, Kodi ${version}): ${state}.`,
    failed: (slot) => `Kodi ${slot}: no answer.`,
    unauthorized: (slot) => `Kodi ${slot}: user name or password refused.`,
    noSocket: (slot) => `Kodi ${slot}: no live updates (port 9090 closed), reading every 10 s.`,
  },
  fr: {
    none: 'Aucun Kodi configuré.',
    ok: (slot, name, version, state) => `Kodi ${slot} (${name}, Kodi ${version}) : ${state}.`,
    failed: (slot) => `Kodi ${slot} : pas de réponse.`,
    unauthorized: (slot) => `Kodi ${slot} : nom d'utilisateur ou mot de passe refusé.`,
    noSocket: (slot) =>
      `Kodi ${slot} : pas de suivi en direct (port 9090 fermé), lecture toutes les 10 s.`,
  },
  de: {
    none: 'Kein Kodi eingerichtet.',
    ok: (slot, name, version, state) => `Kodi ${slot} (${name}, Kodi ${version}): ${state}.`,
    failed: (slot) => `Kodi ${slot}: keine Antwort.`,
    unauthorized: (slot) => `Kodi ${slot}: Benutzername oder Passwort abgelehnt.`,
    noSocket: (slot) =>
      `Kodi ${slot}: keine Live-Updates (Port 9090 geschlossen), Abfrage alle 10 s.`,
  },
  es: {
    none: 'Ningún Kodi configurado.',
    ok: (slot, name, version, state) => `Kodi ${slot} (${name}, Kodi ${version}): ${state}.`,
    failed: (slot) => `Kodi ${slot}: sin respuesta.`,
    unauthorized: (slot) => `Kodi ${slot}: usuario o contraseña rechazados.`,
    noSocket: (slot) =>
      `Kodi ${slot}: sin seguimiento en directo (puerto 9090 cerrado), lectura cada 10 s.`,
  },
};

/** "Find Kodi on the network" action. */
export const DISCOVERY_TEXT = {
  en: {
    unavailable: 'The network search is not available (Gladys 5.1 or later, local network).',
    none: 'No Kodi found on the network. Check that "Announce services to other systems" is on in Kodi, or type its address.',
    added: (list) => `Added: ${list}. Reload this page to see the addresses.`,
    known: (list) => `Already configured: ${list}.`,
    full: (list) => `No free slot left for: ${list}.`,
  },
  fr: {
    unavailable: "La recherche réseau n'est pas disponible (Gladys 5.1 ou plus, réseau local).",
    none: 'Aucun Kodi trouvé sur le réseau. Vérifiez « Annoncer les services aux autres systèmes » dans Kodi, ou saisissez son adresse.',
    added: (list) => `Ajouté : ${list}. Rechargez la page pour voir les adresses.`,
    known: (list) => `Déjà configuré : ${list}.`,
    full: (list) => `Plus d'emplacement libre pour : ${list}.`,
  },
  de: {
    unavailable: 'Die Netzwerksuche ist nicht verfügbar (Gladys 5.1 oder neuer, lokales Netzwerk).',
    none: 'Kein Kodi im Netzwerk gefunden. Prüfe „Dienste anderen Systemen ankündigen“ in Kodi oder gib seine Adresse ein.',
    added: (list) => `Hinzugefügt: ${list}. Lade die Seite neu, um die Adressen zu sehen.`,
    known: (list) => `Bereits eingerichtet: ${list}.`,
    full: (list) => `Kein freier Platz mehr für: ${list}.`,
  },
  es: {
    unavailable: 'La búsqueda en la red no está disponible (Gladys 5.1 o posterior, red local).',
    none: 'No se encontró ningún Kodi en la red. Compruebe «Anunciar servicios a otros sistemas» en Kodi, o introduzca su dirección.',
    added: (list) => `Añadido: ${list}. Recargue la página para ver las direcciones.`,
    known: (list) => `Ya configurado: ${list}.`,
    full: (list) => `No queda ningún espacio libre para: ${list}.`,
  },
};

/** Errors of a command (device buttons, widget, scene actions). */
export const COMMAND_ERRORS = {
  en: {
    unknown_device: 'This Kodi is not configured in the integration anymore.',
    unreachable: 'Kodi does not answer.',
    unauthorized: 'Kodi refused the user name or password.',
    nothing_playing: 'Nothing is playing on Kodi.',
    refused: 'Kodi refused the command.',
    out_of_range: 'The volume goes from 0 to 100.',
    empty_message: 'The notification has no text.',
    empty_target: 'Give the path or the URL of the media to play.',
  },
  fr: {
    unknown_device: "Ce Kodi n'est plus configuré dans l'intégration.",
    unreachable: 'Kodi ne répond pas.',
    unauthorized: "Kodi a refusé le nom d'utilisateur ou le mot de passe.",
    nothing_playing: "Rien n'est en lecture sur Kodi.",
    refused: 'Kodi a refusé la commande.',
    out_of_range: 'Le volume va de 0 à 100.',
    empty_message: "La notification n'a pas de texte.",
    empty_target: "Indiquez le chemin ou l'URL du média à lire.",
  },
  de: {
    unknown_device: 'Dieses Kodi ist in der Integration nicht mehr eingerichtet.',
    unreachable: 'Kodi antwortet nicht.',
    unauthorized: 'Kodi hat Benutzername oder Passwort abgelehnt.',
    nothing_playing: 'Auf Kodi läuft gerade nichts.',
    refused: 'Kodi hat den Befehl abgelehnt.',
    out_of_range: 'Die Lautstärke geht von 0 bis 100.',
    empty_message: 'Die Benachrichtigung hat keinen Text.',
    empty_target: 'Gib den Pfad oder die URL des Mediums an.',
  },
  es: {
    unknown_device: 'Este Kodi ya no está configurado en la integración.',
    unreachable: 'Kodi no responde.',
    unauthorized: 'Kodi rechazó el usuario o la contraseña.',
    nothing_playing: 'No se está reproduciendo nada en Kodi.',
    refused: 'Kodi rechazó el comando.',
    out_of_range: 'El volumen va de 0 a 100.',
    empty_message: 'La notificación no tiene texto.',
    empty_target: 'Indique la ruta o la URL del medio que desea reproducir.',
  },
};

/** A coded error, in every language. */
export function commandMessage(code) {
  return Object.fromEntries(
    Object.entries(COMMAND_ERRORS).map(([language, table]) => [
      language,
      table[code] ?? table.refused,
    ]),
  );
}

/** Toasts of the widget buttons. */
export const DONE_TEXT = {
  play_pause: { en: 'Done', fr: 'C’est fait', de: 'Erledigt', es: 'Hecho' },
  stop: {
    en: 'Playback stopped',
    fr: 'Lecture arrêtée',
    de: 'Wiedergabe gestoppt',
    es: 'Reproducción detenida',
  },
  next: { en: 'Next item', fr: 'Élément suivant', de: 'Nächster Titel', es: 'Elemento siguiente' },
  previous: {
    en: 'Previous item',
    fr: 'Élément précédent',
    de: 'Vorheriger Titel',
    es: 'Elemento anterior',
  },
  volume_down: { en: 'Volume down', fr: 'Volume baissé', de: 'Leiser', es: 'Volumen bajado' },
  volume_up: { en: 'Volume up', fr: 'Volume monté', de: 'Lauter', es: 'Volumen subido' },
};

export const INIT_FAILED = {
  en: 'The integration could not start: see its logs.',
  fr: "L'intégration n'a pas pu démarrer : voir ses journaux.",
  de: 'Die Integration konnte nicht starten: siehe ihre Protokolle.',
  es: 'La integración no pudo iniciarse: consulte sus registros.',
};

/** `5025` s -> `1 h 23 min` (minutes under an hour: `23 min`). */
export const DURATION = {
  en: { hours: (h, m) => `${h} h ${m} min`, minutes: (m) => `${m} min` },
  fr: { hours: (h, m) => `${h} h ${m} min`, minutes: (m) => `${m} min` },
  de: { hours: (h, m) => `${h} Std. ${m} Min.`, minutes: (m) => `${m} Min.` },
  es: { hours: (h, m) => `${h} h ${m} min`, minutes: (m) => `${m} min` },
};

/** `5025` -> `1:23:45`, `225` -> `3:45` (a clock-like position). */
export function formatPosition(seconds) {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) {
    return '';
  }
  const whole = Math.floor(seconds);
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** Whole minutes as `1 h 05 min` / `25 min`, in a language. */
export function formatMinutes(minutes, language) {
  if (typeof minutes !== 'number' || !Number.isFinite(minutes) || minutes < 0) {
    return '';
  }
  const table = DURATION[language] ?? DURATION.en;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h > 0 ? table.hours(h, String(m).padStart(2, '0')) : table.minutes(m);
}
