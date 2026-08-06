import type { LoopPhaseKind, LoopStatus, PhaseStatus } from '@shared/core/loops/loops';

export type LoopTabEvidence = {
  label: string;
  status: 'pending' | 'running' | 'passed' | 'failed';
  summary: string;
  artifactId?: string;
};

export type LoopTabArtifact = {
  artifactId: string;
  kind: 'test-report' | 'command-log' | 'diff-summary' | 'screenshot' | 'browser-diagnostics';
  label?: string;
  byteLength: number;
};

export type LoopTabHandoff = {
  summary: string;
  risks: string[];
  remainingWork: string[];
  artifacts: LoopTabArtifact[];
};

export type LoopTabPhaseSnapshot = {
  id: string;
  index: number;
  kind: LoopPhaseKind;
  name: string;
  goal: string;
  status: PhaseStatus;
  attempts: number;
  lastError: string | null;
  handoff: LoopTabHandoff | null;
  evidence: LoopTabEvidence[];
};

export type LoopTabBrowserState =
  | { kind: 'disabled' }
  | { kind: 'waiting'; message: string }
  | { kind: 'ready'; message: string }
  | { kind: 'running'; message: string }
  | { kind: 'reconnecting'; message: string }
  | { kind: 'passed'; message: string }
  | { kind: 'failed'; message: string };

export type LoopTabSnapshot = {
  loopId: string;
  taskId: string;
  name: string;
  status: LoopStatus;
  currentPhaseIndex: number;
  phases: LoopTabPhaseSnapshot[];
  browser: LoopTabBrowserState;
};

export type LoopTabEvent =
  | { type: 'snapshot'; snapshot: LoopTabSnapshot }
  | { type: 'unavailable'; message: string };

/** Renderer-only seam implemented by the final RPC/event integration lane. */
export interface LoopAuthoringPort {
  loadLoop(loopId: string): Promise<LoopTabSnapshot>;
  subscribeToLoop(loopId: string, listener: (event: LoopTabEvent) => void): () => void;
  startLoop(loopId: string): Promise<LoopTabSnapshot>;
  pauseLoop(loopId: string): Promise<LoopTabSnapshot>;
  resumeLoop(loopId: string): Promise<LoopTabSnapshot>;
  retryPhase(loopId: string, phaseId: string): Promise<LoopTabSnapshot>;
}
