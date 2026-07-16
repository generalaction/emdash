import { once } from 'node:events';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { get as httpGet } from 'node:http';
import type { NetworkInterfaceInfo } from 'node:os';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { DEFAULT_MAX_WIRE_FRAME_BYTES } from '@emdash/wire';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { MobileAccessSettings } from '@shared/core/mobile-access';
import { MobileAccessService } from './mobile-access-service';
import type { NetworkInterfaceMap } from './network-addresses';

type TestContext = {
  service: MobileAccessService;
  root: string;
  settings: MobileAccessSettings;
};

const contexts: TestContext[] = [];

function loopbackInterfaces(): NetworkInterfaceMap {
  const loopback: NetworkInterfaceInfo = {
    address: '127.0.0.1',
    netmask: '255.0.0.0',
    family: 'IPv4',
    mac: '00:00:00:00:00:00',
    internal: true,
    cidr: '127.0.0.1/8',
  };
  return { lo: [loopback] };
}

async function createTestContext(options: { now?: () => number } = {}): Promise<TestContext> {
  const root = await mkdtemp(join(tmpdir(), 'emdash-mobile-access-'));
  await writeFile(join(root, 'index.html'), '<!doctype html><h1>Mobile</h1>', 'utf8');
  await writeFile(join(root, 'app.js'), 'globalThis.mobile = true;', 'utf8');
  const settings: MobileAccessSettings = {
    enabled: true,
    bindAddress: '127.0.0.1',
    // The persisted schema forbids zero. Tests use it to request an ephemeral listener.
    port: 0,
  };
  const service = new MobileAccessService({
    getSettings: async () => settings,
    getSpaRoot: () => root,
    getNetworkInterfaces: loopbackInterfaces,
    now: options.now,
    logger: { info() {}, warn() {}, error() {} },
  });
  const context = { service, root, settings };
  contexts.push(context);
  await service.initialize();
  expect(service.getStatus().state).toBe('running');
  return context;
}

function runningUrl(service: MobileAccessService): string {
  const url = service.getStatus().url;
  if (!url) throw new Error('Expected mobile access to be running');
  return url;
}

function requestStatusWithHost(url: string, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const request = httpGet(url, { headers: { Host: host } }, (response) => {
      response.resume();
      response.on('end', () => resolve(response.statusCode ?? 0));
    });
    request.on('error', reject);
  });
}

function rejectedWebSocketStatus(url: string, cookie: string, origin: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const websocket = new WebSocket(url, { headers: { Cookie: cookie, Origin: origin } });
    websocket.once('open', () => {
      websocket.close();
      reject(new Error('WebSocket upgrade unexpectedly succeeded'));
    });
    websocket.once('unexpected-response', (request, response) => {
      const status = response.statusCode ?? 0;
      response.resume();
      request.destroy();
      resolve(status);
    });
    websocket.once('error', () => {});
  });
}

async function pair(
  service: MobileAccessService,
  deviceName = 'Test phone'
): Promise<{ cookie: string; clientId: string }> {
  const pairingCode = service.generatePairingCode();
  if (!pairingCode.success) throw new Error(pairingCode.error.message);
  const url = runningUrl(service);
  const response = await fetch(`${url}/api/pair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: url },
    body: JSON.stringify({ code: pairingCode.value.code, deviceName }),
  });
  expect(response.status).toBe(200);
  const payload = (await response.json()) as { client: { id: string } };
  const cookie = response.headers.get('set-cookie')?.split(';', 1)[0];
  if (!cookie) throw new Error('Pair response did not set a session cookie');
  return { cookie, clientId: payload.client.id };
}

afterEach(async () => {
  const cleanup = contexts.splice(0);
  await Promise.all(cleanup.map(({ service }) => service.dispose()));
  await Promise.all(cleanup.map(({ root }) => rm(root, { recursive: true, force: true })));
});

describe('MobileAccessService', () => {
  it('serves the SPA with hardened headers and rejects forged hosts', async () => {
    const { service } = await createTestContext();
    const url = runningUrl(service);

    const response = await fetch(`${url}/`);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('Mobile');
    expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(response.headers.get('x-frame-options')).toBe('DENY');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');

    await expect(requestStatusWithHost(`${url}/api/health`, 'attacker.example')).resolves.toBe(421);
  });

  it('does not follow static asset symlinks outside the bundled SPA', async () => {
    const { service, root } = await createTestContext();
    if (process.platform === 'win32') return;
    const outside = join(root, '..', `${basename(root)}-secret.txt`);
    await writeFile(outside, 'private', 'utf8');
    try {
      await symlink(outside, join(root, 'leak.txt'));
      const response = await fetch(`${runningUrl(service)}/leak.txt`);
      expect(response.status).toBe(404);
      expect(await response.text()).not.toContain('private');
    } finally {
      await rm(outside, { force: true });
    }
  });

  it('rejects cross-origin pairing and accepts a single-use code', async () => {
    const { service } = await createTestContext();
    const url = runningUrl(service);
    const pairingCode = service.generatePairingCode();
    if (!pairingCode.success) throw new Error('Expected a pairing code');

    const forged = await fetch(`${url}/api/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://attacker.example' },
      body: JSON.stringify({ code: pairingCode.value.code }),
    });
    expect(forged.status).toBe(403);

    const first = await fetch(`${url}/api/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: url },
      body: JSON.stringify({ code: pairingCode.value.code, deviceName: ' Phone\n ' }),
    });
    expect(first.status).toBe(200);
    expect(service.listClients()[0]?.name).toBe('Phone');

    const replay = await fetch(`${url}/api/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: url },
      body: JSON.stringify({ code: pairingCode.value.code }),
    });
    expect(replay.status).toBe(410);
  });

  it('expires pairing codes after five minutes', async () => {
    let now = 10_000;
    const { service } = await createTestContext({ now: () => now });
    const pairingCode = service.generatePairingCode();
    if (!pairingCode.success) throw new Error('Expected a pairing code');
    now = pairingCode.value.expiresAt;
    const url = runningUrl(service);

    const response = await fetch(`${url}/api/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: url },
      body: JSON.stringify({ code: pairingCode.value.code }),
    });
    expect(response.status).toBe(410);
  });

  it('invalidates a pairing code after five wrong attempts', async () => {
    const { service } = await createTestContext();
    const pairingCode = service.generatePairingCode();
    if (!pairingCode.success) throw new Error('Expected a pairing code');
    const url = runningUrl(service);

    for (let attempt = 1; attempt <= 5; attempt++) {
      const response = await fetch(`${url}/api/pair`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: url },
        body: JSON.stringify({ code: '00000000' }),
      });
      expect(response.status).toBe(attempt === 5 ? 429 : 401);
    }

    const response = await fetch(`${url}/api/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: url },
      body: JSON.stringify({ code: pairingCode.value.code }),
    });
    expect(response.status).toBe(410);
  });

  it('bounds pairing request bodies', async () => {
    const { service } = await createTestContext();
    const url = runningUrl(service);
    const response = await fetch(`${url}/api/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: url },
      body: JSON.stringify({ code: '00000000', padding: 'x'.repeat(2048) }),
    });
    expect(response.status).toBe(413);
  });

  it('authenticates sessions and invalidates every cookie on gateway restart', async () => {
    const { service } = await createTestContext();
    const { cookie } = await pair(service);
    let url = runningUrl(service);

    const authenticated = await fetch(`${url}/api/session`, { headers: { Cookie: cookie } });
    expect(authenticated.status).toBe(200);

    const restarted = await service.restart();
    expect(restarted.success).toBe(true);
    url = runningUrl(service);
    const staleSession = await fetch(`${url}/api/session`, { headers: { Cookie: cookie } });
    expect(staleSession.status).toBe(401);
    expect(service.listClients()).toEqual([]);
  });

  it('starts automatically when a configured private interface returns', async () => {
    const root = await mkdtemp(join(tmpdir(), 'emdash-mobile-access-'));
    await writeFile(join(root, 'index.html'), '<!doctype html><h1>Mobile</h1>', 'utf8');
    const settings: MobileAccessSettings = {
      enabled: true,
      bindAddress: '127.0.0.1',
      port: 0,
    };
    let interfaces: NetworkInterfaceMap = {};
    const service = new MobileAccessService({
      getSettings: async () => settings,
      getSpaRoot: () => root,
      getNetworkInterfaces: () => interfaces,
      interfaceCheckIntervalMs: 5,
      logger: { info() {}, warn() {}, error() {} },
    });
    contexts.push({ service, root, settings });

    await service.initialize();
    expect(service.getStatus().state).toBe('error');

    interfaces = loopbackInterfaces();
    await expect.poll(() => service.getStatus().state, { timeout: 1_000 }).toBe('running');
  });

  it('revokes a paired client and rejects its cookie', async () => {
    const { service } = await createTestContext();
    const { cookie, clientId } = await pair(service);
    const url = runningUrl(service);

    expect(service.revokeClient(clientId)).toEqual({ success: true });
    const response = await fetch(`${url}/api/session`, { headers: { Cookie: cookie } });
    expect(response.status).toBe(401);
  });

  it('hands authenticated WebSockets to the bounded connection seam', async () => {
    const { service } = await createTestContext();
    const { cookie } = await pair(service);
    const url = runningUrl(service);
    let resolveInbound: (value: string) => void = () => {};
    const inbound = new Promise<string>((resolve) => {
      resolveInbound = resolve;
    });
    service.setAuthenticatedConnectionHandler((connection) => {
      connection.onMessage(({ data }) => resolveInbound(Buffer.from(data).toString('utf8')));
      connection.send('connected');
    });

    const websocket = new WebSocket(`${url.replace('http:', 'ws:')}/api/ws`, {
      headers: { Cookie: cookie, Origin: url },
    });
    const serverMessage = new Promise<string>((resolve) => {
      websocket.once('message', (data) => resolve(data.toString()));
    });
    await once(websocket, 'open');
    expect(await serverMessage).toBe('connected');
    websocket.send('phone-message');
    await expect(inbound).resolves.toBe('phone-message');
    expect(service.getStatus().activeConnectionCount).toBe(1);

    websocket.close();
    await once(websocket, 'close');
    expect(service.getStatus().activeConnectionCount).toBe(0);
  });

  it('allows one full-size Wire frame in the outbound buffer', async () => {
    const { service } = await createTestContext();
    const { cookie } = await pair(service);
    const url = runningUrl(service);
    service.setAuthenticatedConnectionHandler((connection) => {
      connection.send(new Uint8Array(DEFAULT_MAX_WIRE_FRAME_BYTES));
    });

    const websocket = new WebSocket(`${url.replace('http:', 'ws:')}/api/ws`, {
      headers: { Cookie: cookie, Origin: url },
    });
    const receivedBytes = new Promise<number>((resolve) => {
      websocket.once('message', (data) =>
        resolve(
          Array.isArray(data)
            ? data.reduce((total, chunk) => total + chunk.byteLength, 0)
            : data.byteLength
        )
      );
    });
    await once(websocket, 'open');
    await expect(receivedBytes).resolves.toBe(DEFAULT_MAX_WIRE_FRAME_BYTES);

    websocket.close();
    await once(websocket, 'close');
  });

  it('requires the exact same origin for authenticated WebSocket upgrades', async () => {
    const { service } = await createTestContext();
    const { cookie } = await pair(service);
    const websocketUrl = `${runningUrl(service).replace('http:', 'ws:')}/api/ws`;

    await expect(
      rejectedWebSocketStatus(websocketUrl, cookie, 'http://attacker.example')
    ).resolves.toBe(403);
  });

  it('closes WebSockets that exceed the inbound frame limit', async () => {
    const { service } = await createTestContext();
    const { cookie } = await pair(service);
    const url = runningUrl(service);
    service.setAuthenticatedConnectionHandler(() => {});
    const websocket = new WebSocket(`${url.replace('http:', 'ws:')}/api/ws`, {
      headers: { Cookie: cookie, Origin: url },
    });
    await once(websocket, 'open');
    websocket.send(Buffer.alloc(128 * 1024 + 1));
    const [code] = (await once(websocket, 'close')) as [number, Buffer];
    expect(code).toBe(1009);
  });
});
