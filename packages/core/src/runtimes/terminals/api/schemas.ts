import { hostFileRefSchema } from '@primitives/path/api';
import { z } from 'zod';

export const terminalKeySchema = z.object({
  workspace: hostFileRefSchema,
  id: z.string().min(1),
});

export type TerminalKey = z.infer<typeof terminalKeySchema>;

export const terminalSizeSchema = z.object({
  cols: z.number().int().positive(),
  rows: z.number().int().positive(),
});

export type TerminalSize = z.infer<typeof terminalSizeSchema>;

export const terminalShellProfileSchema = z.object({
  id: z.string().min(1),
  resolvedShellId: z.string().min(1),
  resolvedFromSystem: z.boolean(),
  executable: z.string().min(1),
  available: z.literal(true).optional(),
  family: z.enum(['posix', 'csh', 'windows-cmd', 'powershell', 'wsl']),
  interactiveArgs: z.array(z.string()),
  commandArgs: z.array(z.string()),
  envCaptureArgs: z.array(z.string()).optional(),
  capturedEnv: z.record(z.string(), z.string()).optional(),
  remotePathLookup: z.boolean().optional(),
});

export type TerminalShellProfile = z.infer<typeof terminalShellProfileSchema>;

export const startTerminalSpecSchema = z
  .object({
    cwd: z.string().min(1),
    env: z.record(z.string(), z.string()),
    shellProfile: terminalShellProfileSchema.optional(),
    shellSetup: z.string().optional(),
    tmux: z.boolean().optional(),
  })
  .merge(terminalSizeSchema.partial());

export type StartTerminalSpec = z.infer<typeof startTerminalSpecSchema>;

export const startTerminalInputSchema = z.object({
  key: terminalKeySchema,
  spec: startTerminalSpecSchema,
});

export type StartTerminalInput = z.infer<typeof startTerminalInputSchema>;

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

export const scriptNodeStatusSchema = z.enum(['pending', 'running', 'done', 'skipped', 'failed']);

export const scriptNodeStateSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1).optional(),
  status: scriptNodeStatusSchema,
  awaitingOn: z.array(z.string().min(1)),
  attempt: z.number().int().positive().optional(),
  pid: z.number().int().positive().optional(),
  progress: z
    .object({
      percent: z.number().min(0).max(100).optional(),
      message: z.string().optional(),
    })
    .optional(),
  exit: terminalExitSchema.omit({ outputTail: true }).optional(),
  error: terminalErrorSchema.optional(),
});

export type ScriptNodeState = z.infer<typeof scriptNodeStateSchema>;

export const scriptWorkflowPhaseSchema = z.enum([
  'idle',
  'running',
  'succeeded',
  'failed',
  'cancelled',
]);

export const scriptWorkflowStateSchema = z.object({
  workflowId: z.string().min(1),
  kind: scriptWorkflowKindSchema,
  phase: scriptWorkflowPhaseSchema,
  nodes: z.record(z.string(), scriptNodeStateSchema),
  order: z.array(z.string().min(1)),
  startedAt: z.number().int(),
  finishedAt: z.number().int().optional(),
  error: terminalErrorSchema.optional(),
});

export type ScriptWorkflowState = z.infer<typeof scriptWorkflowStateSchema>;

export const terminalSessionStateSchema = z.object({
  key: terminalKeySchema,
  status: z.enum(['running', 'exited']),
  kind: z.enum(['workflow', 'terminal']),
  startCount: z.number().int().nonnegative(),
  tmux: z.boolean().optional(),
  pid: z.number().int().positive().optional(),
  cols: z.number().int().positive(),
  rows: z.number().int().positive(),
  startedAt: z.number().int(),
  exitedAt: z.number().int().optional(),
  exit: terminalExitSchema.omit({ outputTail: true }).optional(),
});

export type TerminalSessionState = z.infer<typeof terminalSessionStateSchema>;

export const terminalSessionListSchema = z.record(z.string(), terminalSessionStateSchema);

export type TerminalSessionList = z.infer<typeof terminalSessionListSchema>;

export const terminalDataInputSchema = z.object({
  key: terminalKeySchema,
  data: z.string(),
});

export const terminalResizeInputSchema = z
  .object({
    key: terminalKeySchema,
  })
  .merge(terminalSizeSchema);

export const terminalControlInputSchema = z.object({
  key: terminalKeySchema,
});

export const terminalScopeInputSchema = z.object({
  workspace: hostFileRefSchema,
});
