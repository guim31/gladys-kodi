// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with strings, blanks or `undefined`.
//
// Up to three Kodi instances, one "slot" each (`host_1`, `username_1`,
// `password_1`...). The slot number is the identity of the Gladys device: a
// Kodi that changes address (new DHCP lease) keeps its device and history.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

export const SLOTS = [1, 2, 3];

// Kodi's defaults: web server on 8080, JSON-RPC over WebSocket on 9090 (the
// latter only changes through advancedsettings.xml), web user "kodi".
export const DEFAULT_HTTP_PORT = 8080;
export const DEFAULT_WS_PORT = 9090;
export const DEFAULT_USERNAME = 'kodi';

export const DEFAULT_CONFIG = {
  host_1: '',
  username_1: '',
  password_1: '',
  host_2: '',
  username_2: '',
  password_2: '',
  host_3: '',
  username_3: '',
  password_3: '',
  language: 'fr',
};

export const hostKey = (slot) => `host_${slot}`;
export const usernameKey = (slot) => `username_${slot}`;
export const passwordKey = (slot) => `password_${slot}`;

/**
 * Turn what the user typed into the addresses of a Kodi: `192.0.2.20`,
 * `192.0.2.20:8081`, `livingroom.lan` or a full `http(s)://` URL. Returns null
 * when it is not usable.
 * @param {unknown} raw
 * @returns {{ httpUrl: string, wsUrl: string, host: string } | null}
 */
export function normalizeAddress(raw) {
  if (typeof raw !== 'string') {
    return null;
  }
  const text = raw.trim();
  if (text === '') {
    return null;
  }
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `http://${text}`;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.hostname === '') {
    return null;
  }
  if (url.username || url.password) {
    // Credentials in the address would end up in logs and error messages.
    return null;
  }
  if (url.pathname !== '/' || url.search || url.hash) {
    // Kodi serves /jsonrpc and /image at the root of its web server.
    return null;
  }
  const port = url.port || (url.protocol === 'https:' ? '' : String(DEFAULT_HTTP_PORT));
  const host = url.hostname;
  return {
    host,
    httpUrl: `${url.protocol}//${host}${port ? `:${port}` : ''}`,
    // The JSON-RPC WebSocket has no TLS in Kodi, whatever the web server does.
    wsUrl: `ws://${host}:${DEFAULT_WS_PORT}/jsonrpc`,
  };
}

const text = (value) => (typeof value === 'string' ? value.trim() : '');

/**
 * @param {Record<string, unknown>} raw the configuration returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const instances = [];
  const invalidSlots = [];
  for (const slot of SLOTS) {
    const typed = text(source[hostKey(slot)]);
    if (typed === '') {
      continue;
    }
    const address = normalizeAddress(typed);
    if (!address) {
      invalidSlots.push(slot);
      continue;
    }
    instances.push({
      slot,
      ...address,
      username: text(source[usernameKey(slot)]) || DEFAULT_USERNAME,
      // Not trimmed: a password may start or end with a space.
      password: typeof source[passwordKey(slot)] === 'string' ? source[passwordKey(slot)] : '',
    });
  }
  return {
    instances,
    invalidSlots,
    language: LANGUAGES.includes(source.language) ? source.language : DEFAULT_CONFIG.language,
  };
}

/** Slots with nothing typed in their address field. */
export function freeSlots(raw = {}) {
  return SLOTS.filter((slot) => text(raw?.[hostKey(slot)]) === '');
}
