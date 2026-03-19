// ── Shared types for the resource monitor ────────────────────────────

export interface UsageValues {
  cpu: number;
  memory: number;
}

export interface SessionMetrics extends UsageValues {
  ptyId: string;
  providerId: string;
  providerName: string;
  kind: 'main' | 'chat';
  pid: number | null;
}

export interface TaskMetrics extends UsageValues {
  taskId: string;
  taskName: string;
  sessions: SessionMetrics[];
}

export interface ProjectMetrics extends UsageValues {
  projectId: string;
  projectName: string;
  tasks: TaskMetrics[];
}

export interface AppMetrics extends UsageValues {
  main: UsageValues;
  renderer: UsageValues;
  other: UsageValues;
}

export interface HostMetrics {
  totalMemory: number;
  freeMemory: number;
  usedMemory: number;
  memoryUsagePercent: number;
  cpuCoreCount: number;
}

export interface ResourceMetricsSnapshot {
  app: AppMetrics;
  projects: ProjectMetrics[];
  host: HostMetrics;
  totalCpu: number;
  totalMemory: number;
  collectedAt: number;
}
