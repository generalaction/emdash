const GIBIBYTE = 1024 ** 3;
const SAMPLE_INTERVAL_MS = 5_000;

export interface MachineMetricsSample {
  cpu: {
    usedPercent: number;
  };
  memory: {
    usedPercent: number;
    usedBytes: number;
    totalBytes: number;
  };
  disk: {
    usedPercent: number;
    usedBytes: number;
    totalBytes: number;
    path: string;
  };
  collectedAt: string;
}

// TODO: Replace this renderer-only mock with machines.getMachineMetrics when machine telemetry lands.
export function mockMachineMetrics(machineId: string, now = Date.now()): MachineMetricsSample {
  const seed = hashString(machineId);
  const sample = Math.floor(now / SAMPLE_INTERVAL_MS);
  const cpuPercent = percentage(seed, sample, 0x2f, 8, 72, 6);
  const memoryPercent = percentage(seed, sample, 0x53, 34, 78, 1);
  const diskPercent = percentage(seed, sample, 0x71, 22, 84, 0.2);
  const memoryTotalBytes = [8, 16, 32, 64][seed % 4]! * GIBIBYTE;
  const diskTotalBytes = [256, 512, 1024][seed % 3]! * GIBIBYTE;

  return {
    cpu: { usedPercent: cpuPercent },
    memory: {
      usedPercent: memoryPercent,
      usedBytes: Math.round(memoryTotalBytes * (memoryPercent / 100)),
      totalBytes: memoryTotalBytes,
    },
    disk: {
      usedPercent: diskPercent,
      usedBytes: Math.round(diskTotalBytes * (diskPercent / 100)),
      totalBytes: diskTotalBytes,
      path: '/',
    },
    collectedAt: new Date(now).toISOString(),
  };
}

function percentage(
  seed: number,
  sample: number,
  salt: number,
  minimum: number,
  maximum: number,
  jitter: number
): number {
  const base = scale(mix(seed ^ salt), minimum + jitter, maximum - jitter);
  const variation = scale(mix(seed ^ Math.imul(sample, 0x45d9f3b) ^ salt), -jitter, jitter);
  return Math.round(Math.min(maximum, Math.max(minimum, base + variation)) * 10) / 10;
}

function scale(value: number, minimum: number, maximum: number): number {
  return minimum + (value / 0xffffffff) * (maximum - minimum);
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mix(value: number): number {
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
  return (value ^ (value >>> 16)) >>> 0;
}
