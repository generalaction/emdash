import { hostFileRefSchema } from '@primitives/path/api';
import {
  scriptWorkflowKindSchema,
  terminalErrorSchema,
  terminalExitSchema,
  terminalSizeSchema,
} from '@services/script-workflows/api';
import { z } from 'zod';

export const terminalKeySchema = z.object({
  workspace: hostFileRefSchema,
  id: z.string().min(1),
});

export type TerminalKey = z.infer<typeof terminalKeySchema>;

export const terminalDevServerSchema = z.object({
  key: terminalKeySchema,
  protocol: z.enum(['http:', 'https:']),
  host: z.enum(['localhost', '127.0.0.1']),
  port: z.number().int().min(1).max(65535),
  urlPath: z.string(),
  detectedAt: z.number().int(),
});

export type TerminalDevServer = z.infer<typeof terminalDevServerSchema>;

export const terminalDevServerListSchema = z.record(z.string(), terminalDevServerSchema);

export type TerminalDevServerList = z.infer<typeof terminalDevServerListSchema>;

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
  lastInputAt: z.number().int().optional(),
  lastOutputAt: z.number().int().optional(),
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
