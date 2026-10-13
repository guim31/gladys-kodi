// -----------------------------------------------------------------------------
// Finding Kodi on the network. The container sees no multicast: the Gladys
// core browses mDNS for us (manifest `network_discovery`). Kodi announces its
// web server as `_xbmc-jsonrpc-h._tcp` (the service Home Assistant watches)
// and its JSON-RPC port as `_xbmc-jsonrpc._tcp`, both with a `uuid` TXT entry,
// when "Announce services to other systems" is on (the default).
//
// What is found fills the free address slots of the configuration: the slot
// stays the identity of the device, typed or found.
// -----------------------------------------------------------------------------

import { lookup } from 'node:dns/promises';
import { parseMdnsTxt } from '@gladysassistant/integration-sdk';
import { DEFAULT_HTTP_PORT, freeSlots, hostKey, normalizeAddress } from './config.js';

export const MDNS_SERVICES = ['_xbmc-jsonrpc-h._tcp', '_xbmc-jsonrpc._tcp'];

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/**
 * The Kodi instances of a raw mDNS scan, one per uuid (or address).
 * @param {Array<{ name?: string, host?: string, addresses?: string[], port?: number, txt?: string[] }>} entries
 * @returns {Array<{ id: string, name: string, address: string, httpPort: number|null }>}
 */
export function parseKodiEntries(entries) {
  const found = new Map();
  for (const entry of Array.isArray(entries) ? entries : []) {
    const match =
      typeof entry?.name === 'string' && entry.name.match(/^(.*)\._xbmc-jsonrpc(-h)?\._tcp\b/i);
    if (!match) {
      continue;
    }
    // A `.local` name does not resolve in the container: IPv4 only.
    const address = (entry.addresses ?? []).find((value) => IPV4.test(value));
    if (!address) {
      continue;
    }
    const txt = parseMdnsTxt(Array.isArray(entry.txt) ? entry.txt : []);
    const id = typeof txt.uuid === 'string' && txt.uuid !== '' ? txt.uuid : address;
    const current = found.get(id) ?? { id, name: '', address, httpPort: null };
    current.name ||= match[1].replace(/\\(.)/g, '$1').trim().slice(0, 60);
    if (match[2] && Number.isInteger(entry.port) && entry.port > 0) {
      current.httpPort = entry.port;
      current.address = address;
    }
    found.set(id, current);
  }
  return [...found.values()];
}

/** What to type in an address field for a found Kodi. */
export function addressOf(kodi) {
  const port = kodi.httpPort ?? DEFAULT_HTTP_PORT;
  return port === DEFAULT_HTTP_PORT ? kodi.address : `${kodi.address}:${port}`;
}

/** The hosts typed in the address fields (a name or an IP address). */
export function typedHosts(rawConfig) {
  const hosts = [];
  for (const [key, value] of Object.entries(rawConfig ?? {})) {
    if (/^host_\d+$/.test(key)) {
      const address = normalizeAddress(value);
      if (address) {
        hosts.push(address.host);
      }
    }
  }
  return hosts;
}

/**
 * The IPv4 addresses of the typed host names, so that a Kodi typed as
 * `salon.lan` is recognized when mDNS finds it as 192.0.2.20. A name that
 * does not resolve is left out.
 * @param {string[]} hosts
 * @param {(host: string) => Promise<string[]>} [resolve]
 */
export async function resolveHosts(hosts, resolve = lookupIpv4) {
  const addresses = [];
  for (const host of hosts) {
    if (IPV4.test(host)) {
      continue;
    }
    try {
      addresses.push(...(await resolve(host)));
    } catch {
      // unknown name: compared as typed only
    }
  }
  return addresses;
}

async function lookupIpv4(host) {
  const results = await Promise.race([
    lookup(host, { all: true, family: 4 }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000).unref?.()),
  ]);
  return results.map((result) => result.address);
}

/**
 * Put the Kodi instances found in the free slots of the configuration. A
 * Kodi is known by its host: an address typed with another port or scheme,
 * or a name resolving to it (`aliases`), is the same Kodi.
 * @param {object} rawConfig the configuration as Gladys stores it
 * @param {Array} found parseKodiEntries()
 * @param {string[]} [aliases] resolveHosts() of the typed names
 * @returns {{ updates: Record<string, string>, added: object[], known: object[], full: object[] }}
 */
export function planSlots(rawConfig, found, aliases = []) {
  const taken = new Set([...typedHosts(rawConfig), ...aliases].map((host) => host.toLowerCase()));
  const free = freeSlots(rawConfig);
  const updates = {};
  const added = [];
  const known = [];
  const full = [];
  for (const kodi of found) {
    if (taken.has(kodi.address)) {
      known.push(kodi);
      continue;
    }
    const slot = free.shift();
    if (slot === undefined) {
      full.push(kodi);
      continue;
    }
    updates[hostKey(slot)] = addressOf(kodi);
    taken.add(kodi.address);
    added.push({ ...kodi, slot });
  }
  return { updates, added, known, full };
}
