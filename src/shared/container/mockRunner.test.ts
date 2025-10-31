import { describe, expect, it, vi } from 'vitest';

import type { ResolvedContainerConfig } from './config';
import { buildMockPortAllocator, generateMockStartEvents } from './mockRunner';

const baseConfig: ResolvedContainerConfig = {
  version: 1,
  packageManager: 'npm',
  start: 'npm run dev',
  workdir: '.',
  ports: [
    { service: 'app', container: 3000, protocol: 'tcp', preview: true },
    { service: 'inspect', container: 9229, protocol: 'tcp', preview: false },
  ],
};

describe('generateMockStartEvents', () => {
  it('emits the expected lifecycle and ports events with shared metadata', async () => {
    const timestamps = [1000, 1001, 1002, 1003];
    const now = () => {
      const value = timestamps.shift();
      if (value == null) throw new Error('No timestamp available');
      return value;
    };

    const events = await generateMockStartEvents({
      workspaceId: 'ws_123',
      config: baseConfig,
      portAllocator: buildMockPortAllocator([45000, 45001]),
      runId: 'run-1',
      mode: 'container',
      now,
    });

    expect(events).toHaveLength(4);
    expect(events.map((event) => event.type)).toEqual([
      'lifecycle',
      'lifecycle',
      'ports',
      'lifecycle',
    ]);

    const metadata = events.map(({ workspaceId, runId, mode }) => ({ workspaceId, runId, mode }));
    metadata.forEach((meta) => {
      expect(meta).toEqual({ workspaceId: 'ws_123', runId: 'run-1', mode: 'container' });
    });

    const portsEvent = events[2];
    if (portsEvent.type !== 'ports') throw new Error('Expected ports event');
    expect(portsEvent.previewService).toBe('app');
    expect(portsEvent.ports).toEqual([
      {
        service: 'app',
        protocol: 'tcp',
        container: 3000,
        host: 45000,
        url: 'http://localhost:45000',
      },
      {
        service: 'inspect',
        protocol: 'tcp',
        container: 9229,
        host: 45001,
        url: 'http://localhost:45001',
      },
    ]);

    expect(events.map((event) => event.ts)).toEqual([1000, 1001, 1002, 1003]);
  });

  it('derives runId when none is provided', async () => {
    const timestamp = Date.parse('2024-01-10T00:00:00.000Z');
    const now = vi.fn(() => timestamp);

    const events = await generateMockStartEvents({
      workspaceId: 'ws_abc',
      config: baseConfig,
      portAllocator: buildMockPortAllocator([46000, 46001]),
      now,
    });

    expect(events[0].runId).toBe('r_2024-01-10T00:00:00.000Z');
  });

  it('uses the first service as preview when none are flagged', async () => {
    const config: ResolvedContainerConfig = {
      ...baseConfig,
      ports: [
        { service: 'web', container: 5173, protocol: 'tcp', preview: false },
        { service: 'api', container: 8080, protocol: 'tcp', preview: false },
      ],
    };

    const events = await generateMockStartEvents({
      workspaceId: 'ws_next',
      config,
      portAllocator: buildMockPortAllocator([50000, 50001]),
    });

    const portsEvent = events.find((event) => event.type === 'ports');
    if (portsEvent?.type !== 'ports') throw new Error('Expected ports event');
    expect(portsEvent.previewService).toBe('web');
  });
});
