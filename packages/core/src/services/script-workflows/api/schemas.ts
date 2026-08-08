import { z } from 'zod';
import { hostFileRefSchema } from '#primitives/path/api';

export const terminalSizeSchema = z.object({
  cols: z.number().int().positive(),
  rows: z.number().int().positive(),
});

export type TerminalSize = z.infer<typeof terminalSizeSchema>;

export const scriptWorkflowKindSchema = z.string().min(1);

export const scriptNodeLifecycleSchema = z.enum(['background', 'completable']);

export type ScriptNodeLifecycle = z.infer<typeof scriptNodeLifecycleSchema>;

export const scriptNodeSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1).optional(),
  command: z.string().min(1),
  shellSetup: z.string().optional(),
  cwd: z.string().min(1),
  env: z.record(z.string(), z.string()),
  dependsOn: z.array(z.string().min(1)).optional(),
  lifecycle: scriptNodeLifecycleSchema.optional(),
});

export type ScriptNode = z.infer<typeof scriptNodeSchema>;

export const runScriptWorkflowInputSchema = z
  .object({
    workspace: hostFileRefSchema,
    kind: scriptWorkflowKindSchema,
    nodes: z.array(scriptNodeSchema).min(1),
  })
  .merge(terminalSizeSchema.partial());

export type RunScriptWorkflowInput = z.infer<typeof runScriptWorkflowInputSchema>;

export const scriptWorkflowProgressSchema = z.object({
  workflowId: z.string().min(1),
  kind: scriptWorkflowKindSchema,
  runningNodeId: z.string().min(1).optional(),
  message: z.string().optional(),
});

export type ScriptWorkflowProgress = z.infer<typeof scriptWorkflowProgressSchema>;

export const terminalExitSchema = z.object({
  exitCode: z.number().int().nullable(),
  signal: z.string().nullable(),
  outputTail: z.string(),
});

export type TerminalExit = z.infer<typeof terminalExitSchema>;

export const scriptWorkflowResultSchema = z.object({
  workflowId: z.string().min(1),
  kind: scriptWorkflowKindSchema,
  completedNodes: z.array(z.string().min(1)),
});

export type ScriptWorkflowResult = z.infer<typeof scriptWorkflowResultSchema>;

/** A workflow of a different kind is already running for the workspace. */
export const workflowInFlightErrorSchema = z.object({
  type: z.literal('workflow-in-flight'),
  message: z.string().min(1),
});

/** The workflow graph failed to compile (duplicate node, cycle, unknown dependency…). */
export const workflowCompileFailedErrorSchema = z.object({
  type: z.literal('workflow-compile-failed'),
  message: z.string().min(1),
});

/** A script node exited non-zero, was signalled, or failed while running. */
export const scriptFailedErrorSchema = z.object({
  type: z.literal('script-failed'),
  message: z.string().min(1),
  nodeId: z.string().optional(),
});

/** The workflow (or a node) was cancelled before completing. */
export const workflowCancelledErrorSchema = z.object({
  type: z.literal('cancelled'),
  message: z.string().min(1),
});

/**
 * Catch-all for workflow-primitive errors whose open `WorkflowError.type` is not one of
 * the enumerated variants above (an unexpected node throw, an illegal machine
 * transition, …). The original open discriminant survives in `workflowErrorType` so the
 * union itself stays closed.
 */
export const workflowRuntimeErrorSchema = z.object({
  type: z.literal('workflow-runtime-error'),
  /** The workflow primitive's original open `WorkflowError.type`, when one existed. */
  workflowErrorType: z.string().min(1).optional(),
  message: z.string().min(1),
  resolutions: z.array(z.string()).optional(),
});

export const scriptWorkflowErrorSchema = z.discriminatedUnion('type', [
  workflowInFlightErrorSchema,
  workflowCompileFailedErrorSchema,
  scriptFailedErrorSchema,
  workflowCancelledErrorSchema,
  workflowRuntimeErrorSchema,
]);

export type ScriptWorkflowError = z.infer<typeof scriptWorkflowErrorSchema>;

export const terminalScopeInputSchema = z.object({
  workspace: hostFileRefSchema,
});
