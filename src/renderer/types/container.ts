/**
 * Container run state types used across the renderer.
 */

import type { RunnerLifecycleStatus, RunnerPortMapping } from '@shared/container';

export interface ContainerRunState {
  workspaceId: string;
  runId?: string;
  status: RunnerLifecycleStatus | 'idle';
  containerId?: string;
  ports: Array<RunnerPortMapping & { url: string }>;
  previewService?: string;
  previewUrl?: string;
  lastUpdatedAt: number;
  lastError: { code: string; message: string } | null;
}
