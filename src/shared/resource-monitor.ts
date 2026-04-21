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
  cpu: number;
  memory: number;
}

export interface ResourceSnapshot {
  timestamp: number;
  cpuCount: number;
  totalMemoryBytes: number;
  freeMemoryBytes: number;
  entries: ResourcePtyEntry[];
}
