// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys (a real GladysIntegration on an
// in-memory transport), the integration wired on it by registerHandlers, and
// fake Kodi instances on a fake network. Store under a temporary folder.
// -----------------------------------------------------------------------------

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { Store } from '../../src/store.js';
import { FakeKodi, network, settle } from './fakeKodi.js';

export const FAST_TIMINGS = {
  pollInterval: 40,
  progressInterval: 40,
  offlineInterval: 40,
  notificationDelay: 5,
  stopGrace: 40,
  commandSettle: 5,
};
export const FAST_SOCKET = {
  callTimeout: 300,
  pingInterval: 60_000,
  connectTimeout: 300,
  reconnectMin: 10,
  reconnectMax: 40,
};

/** The configuration of the given fake Kodi instances, slot by slot. */
export function configFor(kodis, extra = {}) {
  return {
    ...Object.fromEntries(
      kodis.flatMap((kodi, index) => [
        [`host_${index + 1}`, kodi.address],
        [`password_${index + 1}`, kodi.password ?? ''],
      ]),
    ),
    ...extra,
  };
}

/**
 * @param {object} [options]
 * @param {FakeKodi[]} [options.kodis] fake instances (default: one)
 * @param {object} [options.config] integration config (default: slot 1 on the first instance)
 */
export async function createWorld({
  kodis,
  config,
  devices = [],
  connect = true,
  dataDir = mkdtempSync(join(tmpdir(), 'kodi-test-')),
  timings = FAST_TIMINGS,
  scanResults,
  now,
} = {}) {
  const servers = kodis ?? [new FakeKodi()];
  const net = network(...servers);
  const gladys = createFakeGladys({
    config: config ?? configFor(servers),
    devices,
    scanResults,
  });
  const app = registerHandlers(gladys, {
    store: new Store(dataDir),
    fetch: net.fetch,
    createSocket: net.createSocket,
    timings,
    socketTimings: FAST_SOCKET,
    // Tests never touch the network: host names resolve here.
    resolve: async (host) => (host === 'salon.lan' ? ['192.0.2.20'] : []),
    now,
  });
  if (connect) {
    await gladys.connect();
    await settle(30);
  }
  return { gladys, app, hub: app.hub, kodis: servers, kodi: servers[0], dataDir };
}

export const deviceId = (slot = 1) => `ext:test-integration:kodi:${slot}`;
export const featureId = (key, slot = 1) => `${deviceId(slot)}:${key}`;

/** The device as Gladys stores it once the user added it (with its features). */
export function created(gladys, slot = 1) {
  const device = gladys.fake.discoveredDevices.find((d) => d.external_id === deviceId(slot));
  return { ...device, features: device.features.map((f) => ({ ...f })) };
}
