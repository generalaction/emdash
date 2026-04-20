/**
 * Per-PTY resource sample. `cpu` is a percentage of one core (can exceed 100
 * on multi-core systems). `memory` is RSS in bytes. `pid` is omitted for
 * remote (SSH) PTYs where local sampling is not applicable.
 */
export interface ResourcePtyEntry {
  sessionId: string;
  projectId: string;
  scopeId: string;
  leafId: string;
  pid?: number;
  kind: 'local' | 'ssh';
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
