import { z } from 'zod';
import {
  agentStateSchema,
  historyPageSchema,
  planStateSchema,
  promptDraftSchema,
  promptInputSchema,
  sessionConfigStateSchema,
  sessionStateSchema,
  sessionUsageSchema,
  terminalStateSchema,
  transcriptTurnSchema,
} from '../acp';

export const MOBILE_ACCESS_PROTOCOL_VERSION = 1;

export const mobileAccessErrorCodeSchema = z.enum([
  'invalid_request',
  'not_found',
  'not_ready',
  'not_available',
  'not_supported',
  'unauthorized',
  'conflict',
  'rate_limited',
  'too_large',
  'runtime_error',
]);

export const mobileAccessErrorSchema = z.strictObject({
  code: mobileAccessErrorCodeSchema,
  message: z.string(),
});

export const mobileProjectSchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  kind: z.enum(['local', 'ssh']),
});

export const mobileTaskSchema = z.strictObject({
  id: z.string(),
  projectId: z.string(),
  name: z.string(),
  lifecycleStatus: z.string(),
  bootstrapStatus: z.enum(['ready', 'bootstrapping', 'error', 'not-started']),
  bootstrapMessage: z.string().optional(),
  updatedAt: z.string(),
});

export const mobileConversationResourceSchema = z.strictObject({
  kind: z.enum(['acp', 'conversation']),
  id: z.string(),
  projectId: z.string(),
  taskId: z.string(),
  title: z.string(),
  providerId: z.string(),
  status: z.string().nullable(),
  seen: z.boolean(),
  runtimeAvailable: z.boolean(),
});

export const mobileTerminalResourceSchema = z.strictObject({
  kind: z.literal('terminal'),
  id: z.string(),
  projectId: z.string(),
  taskId: z.string(),
  title: z.string(),
  shellId: z.string(),
  runtimeAvailable: z.boolean(),
});

export const mobileBrowserResourceSchema = z.strictObject({
  kind: z.literal('browser'),
  id: z.string(),
  projectId: z.string(),
  taskId: z.string(),
  title: z.string(),
  url: z.string(),
  openable: z.boolean(),
  unavailableReason: z.string().optional(),
});

export const mobileResourceSchema = z.discriminatedUnion('kind', [
  mobileConversationResourceSchema,
  mobileTerminalResourceSchema,
  mobileBrowserResourceSchema,
]);

export const mobileCatalogSchema = z.strictObject({
  revision: z.number().int().nonnegative(),
  projects: z.array(mobileProjectSchema),
  tasks: z.array(mobileTaskSchema),
  resources: z.array(mobileResourceSchema),
});

export const mobileAgentOptionSchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  supportsAcp: z.boolean(),
  supportsPty: z.boolean(),
  supportsAutoApprove: z.boolean(),
  models: z.array(z.strictObject({ id: z.string(), name: z.string() })),
});

export const mobileCreationOptionsSchema = z.strictObject({
  defaultAgentId: z.string().nullable(),
  agents: z.array(mobileAgentOptionSchema),
  defaultShellId: z.string(),
  shells: z.array(z.strictObject({ id: z.string(), name: z.string(), available: z.boolean() })),
  autoApproveByDefault: z.boolean(),
});

export const mobileHandleKindSchema = z.enum(['acp', 'conversation', 'terminal']);

export const mobileResourceHandleSchema = z.strictObject({
  id: z.string(),
  kind: mobileHandleKindSchema,
  resourceId: z.string(),
  title: z.string(),
});

export const mobilePtyOutputKeySchema = z.strictObject({ handleId: z.string() });

export const mobileFileEntrySchema = z.strictObject({
  name: z.string(),
  path: z.string(),
  kind: z.enum(['file', 'directory', 'symlink']),
});

export const mobileFileReadSchema = z.strictObject({
  path: z.string(),
  kind: z.enum(['text', 'image', 'binary']),
  mimeType: z.string().optional(),
  content: z.string().nullable(),
  truncated: z.boolean(),
  totalSize: z.number().int().nonnegative(),
});

export const mobileDiffEntrySchema = z.strictObject({
  path: z.string(),
  status: z.string(),
  staged: z.boolean(),
  additions: z.number().int().nonnegative().optional(),
  deletions: z.number().int().nonnegative().optional(),
});

export const mobileDiffReadSchema = z.strictObject({
  path: z.string(),
  patch: z.string().nullable(),
  binary: z.boolean(),
  truncated: z.boolean(),
});

export const mobileAcpSnapshotSchema = z.strictObject({
  history: historyPageSchema,
  state: sessionStateSchema,
  config: sessionConfigStateSchema,
  usage: sessionUsageSchema.nullable(),
  plan: planStateSchema.nullable(),
  agents: z.array(agentStateSchema),
  activeTurn: transcriptTurnSchema.nullable(),
  draftRev: z.number().int().nullable(),
  draft: promptDraftSchema.nullable(),
  terminals: z.array(terminalStateSchema),
});

export const mobileDraftConflictSchema = z.strictObject({
  status: z.enum(['applied', 'conflict']),
  rev: z.number().int().nullable(),
  draft: promptDraftSchema.nullable(),
});

export const mobileInitializeResultSchema = z.strictObject({
  protocolVersion: z.literal(MOBILE_ACCESS_PROTOCOL_VERSION),
  serverName: z.string(),
  capabilities: z.array(z.string()),
});

export const mobilePromptSchema = promptInputSchema.extend({
  text: z.string().max(64 * 1024),
});

export type MobileAccessError = z.infer<typeof mobileAccessErrorSchema>;
export type MobileCatalog = z.infer<typeof mobileCatalogSchema>;
export type MobileCreationOptions = z.infer<typeof mobileCreationOptionsSchema>;
export type MobileResource = z.infer<typeof mobileResourceSchema>;
export type MobileResourceHandle = z.infer<typeof mobileResourceHandleSchema>;
export type MobileAcpSnapshot = z.infer<typeof mobileAcpSnapshotSchema>;
export type MobileFileEntry = z.infer<typeof mobileFileEntrySchema>;
export type MobileFileRead = z.infer<typeof mobileFileReadSchema>;
export type MobileDiffEntry = z.infer<typeof mobileDiffEntrySchema>;
export type MobileDiffRead = z.infer<typeof mobileDiffReadSchema>;
