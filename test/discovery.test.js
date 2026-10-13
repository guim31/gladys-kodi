// -----------------------------------------------------------------------------
// Finding Kodi on the network: the raw mDNS answers relayed by the core (the
// format of networkDiscovery.scanMdns in Gladys 5.1+), and the free slots
// they fill.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addressOf, parseKodiEntries, planSlots } from '../src/discovery.js';
import { FakeKodi, settle, until } from './helpers/fakeKodi.js';
import { createWorld, deviceId } from './helpers/world.js';

// Kodi announces both services, with the same uuid (Home Assistant's
// zeroconf tests use the same shape).
const UUID = '11111111-2222-3333-4444-555555555555';
const livingRoom = [
  {
    name: 'Kodi (salon)._xbmc-jsonrpc-h._tcp.local',
    host: 'salon.local',
    addresses: ['192.0.2.20', 'fe80::1'],
    port: 8080,
    txt: [`uuid=${UUID}`, 'txtvers=1'],
  },
  {
    name: 'Kodi (salon)._xbmc-jsonrpc._tcp.local',
    host: 'salon.local',
    addresses: ['192.0.2.20'],
    port: 9090,
    txt: [`uuid=${UUID}`, 'txtvers=1'],
  },
];
const bedroom = {
  name: 'LibreELEC._xbmc-jsonrpc-h._tcp.local',
  host: 'libreelec.local',
  addresses: ['192.0.2.21'],
  port: 8081,
  txt: ['uuid=66666666-7777-8888-9999-000000000000'],
};

test('mDNS entries: one Kodi per uuid, its web server port, IPv4 only', () => {
  assert.deepEqual(parseKodiEntries([...livingRoom, bedroom]), [
    { id: UUID, name: 'Kodi (salon)', address: '192.0.2.20', httpPort: 8080 },
    {
      id: '66666666-7777-8888-9999-000000000000',
      name: 'LibreELEC',
      address: '192.0.2.21',
      httpPort: 8081,
    },
  ]);
  // Only the JSON-RPC service seen: the default web server port.
  assert.equal(addressOf(parseKodiEntries([livingRoom[1]])[0]), '192.0.2.20');
  assert.equal(addressOf(parseKodiEntries([bedroom])[0]), '192.0.2.21:8081');
  // Other services, no IPv4, garbage: ignored.
  assert.deepEqual(
    parseKodiEntries([
      { name: 'NAS._smb._tcp.local', addresses: ['192.0.2.5'], port: 445, txt: [] },
      { ...bedroom, addresses: ['fe80::2'] },
      null,
      'nope',
    ]),
    [],
  );
  assert.deepEqual(parseKodiEntries(undefined), []);
});

test('the free slots are filled, known and extra Kodi are reported', () => {
  const found = parseKodiEntries([...livingRoom, bedroom]);
  const plan = planSlots({ host_1: '192.0.2.20', host_2: '', host_3: '' }, found);
  assert.deepEqual(plan.updates, { host_2: '192.0.2.21:8081' });
  assert.deepEqual(
    plan.known.map((k) => k.address),
    ['192.0.2.20'],
  );
  const full = planSlots(
    { host_1: '192.0.2.30', host_2: '192.0.2.31', host_3: '192.0.2.32' },
    found,
  );
  assert.deepEqual(full.updates, {});
  assert.equal(full.full.length, 2);
});

test('"Find Kodi on the network" fills the configuration and publishes the device', async (t) => {
  const kodi = new FakeKodi({ host: '192.0.2.20', password: null });
  const world = await createWorld({
    kodis: [kodi],
    config: { host_1: '' },
    scanResults: { mdns: livingRoom },
  });
  t.after(() => world.app.stop());
  const { gladys } = world;
  // First start without any address: the integration searched by itself.
  await until(() => gladys.fake.discoveredDevices.length === 1, 2000, 'device');
  assert.equal(gladys.fake.config.host_1, '192.0.2.20');
  assert.equal(gladys.fake.discoveredDevices[0].external_id, deviceId(1));
  assert.deepEqual(gladys.fake.scans.at(-1)?.type ?? 'mdns', 'mdns');

  // Clicking the action again: already configured.
  const ack = await gladys.fake.action('find_kodi', {});
  assert.equal(ack.success, true);
  assert.match(
    ack.data.message?.en ?? ack.data.en,
    /Already configured: Kodi \(salon\) \(192\.0\.2\.20\)/,
  );
});

test('the automatic search runs once, and says when nothing is found', async (t) => {
  const world = await createWorld({ config: {}, scanResults: { mdns: [] } });
  t.after(() => world.app.stop());
  await settle();
  const ack = await world.gladys.fake.action('find_kodi', {});
  assert.match(JSON.stringify(ack.data), /No Kodi found on the network/);
  const scans = world.gladys.fake.requests.filter((r) => r.path.includes('scan'));
  assert.equal(scans.length, 2, 'once at the first start, once for the click');

  // The next start (same /data) does not search by itself any more.
  const again = await createWorld({
    config: {},
    scanResults: { mdns: [] },
    dataDir: world.dataDir,
  });
  t.after(() => again.app.stop());
  await settle();
  assert.equal(again.gladys.fake.requests.filter((r) => r.path.includes('scan')).length, 0);
});

test('a scan from the Discovery tab also searches the network', async (t) => {
  const kodi = new FakeKodi({ host: '192.0.2.21', port: 8081 });
  const world = await createWorld({
    kodis: [kodi],
    config: { host_2: '', password_1: kodi.password },
    scanResults: { mdns: [bedroom] },
  });
  t.after(() => world.app.stop());
  await settle();
  await world.gladys.fake.scanRequest();
  assert.equal(world.gladys.fake.config.host_1, '192.0.2.21:8081');
  assert.equal(world.gladys.fake.discoveredDevices.length, 1);
});

test('a Kodi typed by name, port or scheme is not added a second time', () => {
  const found = parseKodiEntries(livingRoom);
  assert.deepEqual(planSlots({ host_1: 'salon.lan' }, found, ['192.0.2.20']).updates, {});
  assert.deepEqual(planSlots({ host_1: 'https://192.0.2.20' }, found).updates, {});
  assert.deepEqual(planSlots({ host_1: '192.0.2.20:8081' }, found).updates, {});
  assert.deepEqual(planSlots({ host_1: 'salon.lan' }, found).updates, { host_2: '192.0.2.20' });
});

test('the search resolves the typed names before comparing', async (t) => {
  const world = await createWorld({
    kodis: [new FakeKodi({ host: '192.0.2.20' })],
    config: { host_1: 'salon.lan' },
    scanResults: { mdns: livingRoom },
  });
  t.after(() => world.app.stop());
  const ack = await world.gladys.fake.action('find_kodi', {});
  assert.match(JSON.stringify(ack.data), /Already configured/);
  assert.equal(world.gladys.fake.config.host_2, undefined);
});
