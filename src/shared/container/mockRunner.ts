import type { ResolvedContainerConfig, ResolvedContainerPortConfig } from './config';
import type { RunnerEvent, RunnerMode, RunnerPortMapping } from './events';

export interface PortAllocator {
  allocate(requests: ResolvedContainerPortConfig[]): Promise<RunnerPortMapping[]>;
}

export interface MockStartOptions {
  workspaceId: string;
  config: ResolvedContainerConfig;
  portAllocator: PortAllocator;
  runId?: string;
  mode?: RunnerMode;
  now?: () => number;
}

const DEFAULT_MODE: RunnerMode = 'container';

function resolveRunId(runId: string | undefined, now: () => number): string {
  if (runId) return runId;
  return `r_${new Date(now()).toISOString()}`;
}

function resolveContainerId(workspaceId: string): string {
  return `emdash_ws_${workspaceId}`;
}

function previewServiceFromConfig(config: ResolvedContainerConfig): string {
  const previewPort = config.ports.find((port) => port.preview);
  return previewPort ? previewPort.service : (config.ports[0]?.service ?? 'app');
}

function withUrl(mapping: RunnerPortMapping): RunnerPortMapping {
  const url = mapping.protocol === 'tcp' ? `http://localhost:${mapping.host}` : undefined;
  return url ? { ...mapping, url } : mapping;
}

function createTimestampGenerator(now: () => number): () => number {
  return () => now();
}

function createEventBase(
  workspaceId: string,
  runId: string,
  mode: RunnerMode,
  nextTs: () => number
) {
  return {
    workspaceId,
    runId,
    mode,
    ts: nextTs(),
  };
}

export async function generateMockStartEvents(options: MockStartOptions): Promise<RunnerEvent[]> {
  const now = options.now ?? Date.now;
  const nextTs = createTimestampGenerator(now);
  const mode = options.mode ?? DEFAULT_MODE;
  const runId = resolveRunId(options.runId, now);
  const containerId = resolveContainerId(options.workspaceId);
  const previewService = previewServiceFromConfig(options.config);

  const ports = await options.portAllocator.allocate(options.config.ports);
  const mappedPorts = ports.map(withUrl);

  return [
    {
      ...createEventBase(options.workspaceId, runId, mode, nextTs),
      type: 'lifecycle',
      status: 'building',
    },
    {
      ...createEventBase(options.workspaceId, runId, mode, nextTs),
      type: 'lifecycle',
      status: 'starting',
      containerId,
    },
    {
      ...createEventBase(options.workspaceId, runId, mode, nextTs),
      type: 'ports',
      previewService,
      ports: mappedPorts,
    },
    {
      ...createEventBase(options.workspaceId, runId, mode, nextTs),
      type: 'lifecycle',
      status: 'ready',
    },
  ];
}

export function buildMockPortAllocator(hostPorts: number[]): PortAllocator {
  return {
    async allocate(requests: ResolvedContainerPortConfig[]): Promise<RunnerPortMapping[]> {
      if (hostPorts.length < requests.length) {
        throw new Error('Not enough host ports provided for mock allocator');
      }
      return requests.map((request, index) => ({
        service: request.service,
        protocol: request.protocol,
        container: request.container,
        host: hostPorts[index],
      }));
    },
  };
}
