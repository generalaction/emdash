/**
 * Per-PTY resource sample. `cpu` is a percentage of one core (can exceed 100
 * on multi-core systems). `memory` is RSS in bytes. `pid` is undefined for
 * remote (SSH) PTYs where the owning process runs on the remote host.
 */
export interface ResourcePtyEntry {
  sessionId: string;
  projectId: string;
  scopeId: string;
  leafId: string;
  pid: number | undefined;
  ppid?: number;
  cpu: number;
  memory: number;
}

/**
 * Memory + CPU consumed by the Electron app itself (main, renderer, GPU,
 * utility processes). Sampled from `app.getAppMetrics()`. Does not include
 * PTY child processes — those are reported per-entry to avoid double counting.
 */
export interface ResourceAppUsage {
  memoryBytes: number;
  cpuPercent: number;
}

export type ResourceAppProcessType =
  | 'Browser'
  | 'Tab'
  | 'Utility'
  | 'Zygote'
  | 'Sandbox helper'
  | 'GPU'
  | 'Pepper Plugin'
  | 'Pepper Plugin Broker'
  | 'Unknown';

/**
 * Per-process breakdown of the Electron app (one entry per `app.getAppMetrics()`
 * row). Sums of `memory` / `cpu` across these match `ResourceAppUsage`.
 */
export interface ResourceAppProcess {
  pid: number;
  type: ResourceAppProcessType;
  name?: string;
  cpu: number;
  memory: number;
}

export interface ResourceSnapshot {
  timestamp: number;
  cpuCount: number;
  totalMemoryBytes: number;
  app: ResourceAppUsage;
  appProcesses: ResourceAppProcess[];
  entries: ResourcePtyEntry[];
}
