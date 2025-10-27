import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import net from 'node:net';

import type { ResolvedContainerPortConfig } from './config';
import { PortAllocationError, PortManager } from './portManager';

const BASE_PORT = 45000;
const PORT_RANGE = 50;

function buildPorts(): ResolvedContainerPortConfig[] {
  return [
    { service: 'app', container: 3000, protocol: 'tcp', preview: true },
    { service: 'inspect', container: 9229, protocol: 'tcp', preview: false },
  ];
}

describe('PortManager', () => {
  let manager: PortManager;

  beforeEach(() => {
    manager = new PortManager({ minPort: BASE_PORT, maxPort: BASE_PORT + PORT_RANGE });
  });


  it('allocates unique host ports for each container port', async () => {
    const allocations = await manager.allocate(buildPorts());
    const hosts = allocations.map((entry) => entry.host);

    expect(new Set(hosts).size).toBe(2);
    expect(allocations.every((entry) => entry.host >= BASE_PORT && entry.host <= BASE_PORT + PORT_RANGE)).toBe(
      true
    );
  });

  it('does not reuse reserved host ports', async () => {
    manager.reserveHostPort(BASE_PORT);

    const allocations = await manager.allocate(buildPorts());

    expect(allocations.find((entry) => entry.host === BASE_PORT)).toBeUndefined();
  });

  it('skips ports that are already bound on the host', async () => {
    const busyPort = BASE_PORT + 1;
    const server = net.createServer();

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(busyPort, '127.0.0.1', () => resolve());
    });

    try {
      const allocations = await manager.allocate(buildPorts());
      expect(allocations.find((entry) => entry.host === busyPort)).toBeUndefined();
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('throws when no free ports are available', async () => {
    const smallManager = new PortManager({ minPort: BASE_PORT, maxPort: BASE_PORT });

    smallManager.reserveHostPort(BASE_PORT);

    await expect(smallManager.allocate(buildPorts())).rejects.toBeInstanceOf(PortAllocationError);
  });
});
