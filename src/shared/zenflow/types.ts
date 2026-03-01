/** Step type classification */
export type WorkflowStepType = 'requirements' | 'spec' | 'planning' | 'implementation';

/** Step execution status */
export type WorkflowStepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'paused';

/** Overall workflow status */
export type ZenflowWorkflowStatus = 'running' | 'paused' | 'completed' | 'failed';

/** Workflow template identifier */
export type ZenflowTemplateId = 'spec-and-build' | 'full-sdd';

/** A workflow step as seen by both main and renderer */
export interface WorkflowStep {
  id: string;
  taskId: string;
  conversationId: string | null;
  stepNumber: number;
  name: string;
  type: WorkflowStepType;
  status: WorkflowStepStatus;
  pauseAfter: boolean;
  prompt: string | null;
  artifactPaths: string[]; // parsed from JSON
  metadata: Record<string, unknown> | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Zenflow-specific metadata stored in task.metadata.zenflow */
export interface ZenflowMetadata {
  enabled: boolean;
  template: ZenflowTemplateId;
  currentStepNumber: number;
  totalSteps: number;
  status: ZenflowWorkflowStatus;
  featureDescription: string;
  artifactsDir: string;
}

/** Events emitted by the orchestration service */
export interface ZenflowEvent {
  taskId: string;
  type:
    | 'step-started'
    | 'step-completed'
    | 'step-failed'
    | 'workflow-paused'
    | 'workflow-completed'
    | 'steps-expanded';
  stepId?: string;
  stepNumber?: number;
  conversationId?: string;
  data?: unknown;
}

/** A step as represented in plan.md (source of truth) */
export interface PlanStepData {
  stepNumber: number;
  name: string;
  type: WorkflowStepType;
  status: WorkflowStepStatus;
  conversationId: string | null;
  pauseAfter: boolean;
}

/** Parsed plan.md document */
export interface PlanDocument {
  featureDescription: string;
  templateId: ZenflowTemplateId;
  steps: PlanStepData[];
}
