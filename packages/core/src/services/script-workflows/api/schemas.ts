import { hostFileRefSchema } from '@primitives/path/api';
import { z } from 'zod';

export const terminalSizeSchema = z.object({
  cols: z.number().int().positive(),
  rows: z.number().int().positive(),
});

export type TerminalSize = z.infer<typeof terminalSizeSchema>;

export const scriptWorkflowKindSchema = z.string().min(1);

export const scriptNodeSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1).optional(),
  command: z.string().min(1),
  shellSetup: z.string().optional(),
  cwd: z.string().min(1),
  env: z.record(z.string(), z.string()),
  dependsOn: z.array(z.string().min(1)).optional(),
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

export const terminalErrorSchema = z.object({
  type: z.string().min(1),
  message: z.string().min(1),
  nodeId: z.string().optional(),
  resolutions: z.array(z.string()).optional(),
});

export type TerminalError = z.infer<typeof terminalErrorSchema>;

export const terminalScopeInputSchema = z.object({
  workspace: hostFileRefSchema,
});
