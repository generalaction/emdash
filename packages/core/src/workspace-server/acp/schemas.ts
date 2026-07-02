import { z } from 'zod';

export const stopReasonSchema = z.enum([
  'end_turn',
  'max_tokens',
  'max_turn_requests',
  'refusal',
  'cancelled',
]);

export const sessionLifecycleSchema = z.enum([
  'starting',
  'replaying',
  'ready',
  'working',
  'cancelling',
  'closed',
]);

export const sessionUsageSchema = z.object({
  contextSize: z.number().int(),
  contextUsed: z.number().int(),
  cost: z.object({ amount: z.number(), currency: z.string() }).nullable(),
});

export const acpPermissionOptionSchema = z.object({
  optionId: z.string(),
  name: z.string(),
  kind: z.union([
    z.literal('allow_once'),
    z.literal('allow_always'),
    z.literal('reject_once'),
    z.literal('reject_always'),
    z.string(),
  ]),
});

export const acpPermissionRequestSchema = z.object({
  conversationId: z.string(),
  requestId: z.string(),
  toolCallId: z.string().optional(),
  title: z.string(),
  toolKind: z.string().optional(),
  options: z.array(acpPermissionOptionSchema),
});

export const acpTerminalExitSchema = z.object({
  exitCode: z.number().int().nullable(),
  signal: z.string().nullable(),
});

export const terminalSnapshotSchema = z.object({
  terminalId: z.string(),
  command: z.string(),
  args: z.array(z.string()),
  cwd: z.string(),
  output: z.string(),
  truncated: z.boolean(),
  exitStatus: acpTerminalExitSchema.nullable(),
});

export const acpPromptImageSchema = z.object({
  data: z.string(),
  mimeType: z.string(),
  name: z.string().optional(),
});

export const agentDiffSchema = z.object({
  path: z.string(),
  oldText: z.string().nullable(),
  newText: z.string(),
});

export const agentImageSchema = z.object({
  data: z.string(),
  mimeType: z.string(),
  name: z.string().optional(),
});

export const agentToolStatusSchema = z.enum(['pending', 'in_progress', 'completed', 'failed']);

export const agentPlanEntryStatusSchema = z.enum(['pending', 'in_progress', 'completed']);

export const agentPlanEntryPrioritySchema = z.enum(['high', 'medium', 'low']);

export const agentPlanEntrySchema = z.object({
  content: z.string(),
  status: agentPlanEntryStatusSchema,
  priority: agentPlanEntryPrioritySchema,
});

export const agentUpdateSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('message'),
    role: z.enum(['user', 'assistant']),
    messageId: z.string().nullable(),
    text: z.string(),
    images: z.array(agentImageSchema).optional(),
  }),
  z.object({
    kind: z.literal('thinking'),
    messageId: z.string().nullable(),
    text: z.string(),
  }),
  z.object({
    kind: z.literal('tool_call'),
    toolCallId: z.string(),
    title: z.string(),
    toolKind: z.string().nullable(),
    status: agentToolStatusSchema.nullable(),
    parentToolCallId: z.string().nullable(),
    diffs: z.array(agentDiffSchema),
  }),
  z.object({
    kind: z.literal('tool_update'),
    toolCallId: z.string(),
    title: z.string().nullable(),
    toolKind: z.string().nullable(),
    status: agentToolStatusSchema.nullable(),
    parentToolCallId: z.string().nullable(),
    diffs: z.array(agentDiffSchema),
  }),
  z.object({
    kind: z.literal('plan'),
    entries: z.array(agentPlanEntrySchema),
  }),
  z.object({ kind: z.literal('ignored') }),
]);

export const turnStatusSchema = z.enum(['active', 'complete', 'error', 'cancelled']);

export const turnSourceSchema = z.enum(['live', 'replay']);

export const acpTurnSchema = z.object({
  id: z.string(),
  status: turnStatusSchema,
  source: turnSourceSchema,
  startSeq: z.number().int(),
  endSeq: z.number().int().nullable(),
  updates: z.array(z.object({ seq: z.number().int(), update: agentUpdateSchema })),
  stopReason: stopReasonSchema.nullable(),
});

// nextCursor = startSeq value to pass as `before`; null means no more pages
export const historyPageSchema = z.object({
  turns: z.array(acpTurnSchema),
  nextCursor: z.number().int().nullable(),
});

// Returned by resumeSession — includes the sessionId alongside the first page
export const resumeResultSchema = historyPageSchema.extend({
  sessionId: z.string(),
});

export const selectableOptionSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
});

export const modelChoiceSchema = selectableOptionSchema.extend({
  features: z
    .object({
      contextWindowSize: z.number().int().optional(),
      speed: z.number().int().optional(),
      intelligence: z.number().int().optional(),
    })
    .optional(),
});

export const modelOptionsSchema = z.object({
  models: z
    .object({
      selected: z.string().nullable(),
      available: z.array(modelChoiceSchema),
    })
    .nullable(),
  efforts: z
    .object({
      selected: z.string().nullable(),
      available: z.array(selectableOptionSchema),
    })
    .nullable(),
});

export const modeOptionsSchema = z
  .object({
    selected: z.string().nullable(),
    available: z.array(selectableOptionSchema),
  })
  .nullable();

export const commandOptionSchema = z.object({
  name: z.string(),
  description: z.string(),
  inputHint: z.string().optional(),
});

export const sessionStateSchema = z.object({
  conversationId: z.string(),
  lifecycle: sessionLifecycleSchema,
  activeTurnId: z.string().nullable(),
  lastStopReason: stopReasonSchema.nullable(),
  usage: sessionUsageSchema.nullable(),
  pendingPermissions: z.array(acpPermissionRequestSchema),
});

export const sessionConfigStateSchema = z.object({
  modelOptions: modelOptionsSchema.nullable(),
  modeOptions: modeOptionsSchema,
  availableCommands: z.array(commandOptionSchema),
});

export const sessionStateListSchema = z.record(z.string(), sessionStateSchema);

export const activeTurnEntrySchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('update'),
    turnId: z.string(),
    seq: z.number().int(),
    update: agentUpdateSchema,
  }),
  z.object({
    kind: z.literal('committed'),
    turnId: z.string(),
    turn: acpTurnSchema,
  }),
]);

export const terminalOutputEventSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('chunk'),
    chunk: z.string(),
    truncated: z.boolean(),
  }),
  z.object({
    kind: z.literal('finished'),
    exitStatus: acpTerminalExitSchema,
  }),
]);

export const sessionConfigInputSchema = z.object({
  model: z.string().optional(),
  effort: z.string().optional(),
  mode: z.string().optional(),
});

export const acpStartInputSchema = z.object({
  conversationId: z.string(),
  providerId: z.string(),
  cwd: z.string(),
  sessionConfig: sessionConfigInputSchema.optional(),
});

export const serializedErrorSchema = z.object({
  name: z.string(),
  message: z.string(),
  stack: z.string().optional(),
});

const plainTagErrorSchema = <T extends string>(type: T) =>
  z.object({ type: z.literal(type), message: z.string().optional() });

const failedErrorSchema = <T extends string>(type: T) =>
  z.object({
    type: z.literal(type),
    message: z.string().optional(),
    cause: serializedErrorSchema.optional(),
  });

export const acpRuntimeErrorSchema = z.union([
  plainTagErrorSchema('provider_unsupported'),
  plainTagErrorSchema('conversation_not_found'),
  plainTagErrorSchema('no_active_session'),
  plainTagErrorSchema('invalid_state'),
  failedErrorSchema('spawn_failed'),
  failedErrorSchema('initialize_failed'),
  failedErrorSchema('new_session_failed'),
  failedErrorSchema('load_session_failed'),
  failedErrorSchema('prompt_failed'),
  failedErrorSchema('cancel_failed'),
  failedErrorSchema('set_config_failed'),
  failedErrorSchema('set_mode_failed'),
]);
