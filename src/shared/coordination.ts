/**
 * Multi-agent coordination types.
 *
 * Surfaces sibling-task activity so agents working in parallel worktrees of the
 * same project can avoid redundant or conflicting work. Passive awareness only:
 * no claims, no locks, no enforcement.
 *
 * Design: `agents/architecture` and the project memory
 * `multi-agent-coordination-design`.
 */

export type CoordinationStatus = 'active' | 'idle' | 'inactive';

/** Touched-file timestamps are ISO-8601 strings (sqlite text columns). */
export interface SiblingTask {
  taskId: string;
  projectId: string;
  branch: string | null;
  name: string;
  status: CoordinationStatus;
  summary: string | null;
  lastEventAt: string;
  touchedFiles: string[];
}

export interface OverlappingSibling {
  taskId: string;
  branch: string | null;
  name: string;
  lastTouchedAt: string;
}

export interface FileOverlap {
  path: string;
  siblings: OverlappingSibling[];
}
