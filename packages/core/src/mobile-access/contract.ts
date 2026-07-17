import {
  defineContract,
  downloadFile,
  fallible,
  liveLog,
  procedure,
  uploadFile,
} from '@emdash/wire';
import { z } from 'zod';
import {
  attachmentMimeTypeSchema,
  attachmentRefSchema,
  permissionDecisionSchema,
  promptInputSchema,
} from '../acp';
import {
  MOBILE_ACCESS_PROTOCOL_VERSION,
  mobileAccessErrorSchema,
  mobileAcpSnapshotSchema,
  mobileCatalogSchema,
  mobileCreationOptionsSchema,
  mobileDiffEntrySchema,
  mobileDiffReadSchema,
  mobileDraftConflictSchema,
  mobileFileEntrySchema,
  mobileFileReadSchema,
  mobileInitializeResultSchema,
  mobilePromptSchema,
  mobilePtyOutputKeySchema,
  mobileResourceHandleSchema,
} from './schemas';

const handleInputSchema = z.strictObject({ handleId: z.string() });
const taskInputSchema = z.strictObject({ taskId: z.string() });
const requestIdSchema = z.string().uuid();

const fallibleEndpoint = <I extends z.ZodTypeAny, D extends z.ZodTypeAny>(input: I, data: D) =>
  fallible({ input, data, error: mobileAccessErrorSchema });

export const mobileAccessContract = defineContract({
  health: procedure({
    input: z.void().optional(),
    output: z.strictObject({ ok: z.literal(true), protocolVersion: z.number().int() }),
  }),
  initialize: fallibleEndpoint(
    z.strictObject({ protocolVersion: z.literal(MOBILE_ACCESS_PROTOCOL_VERSION) }),
    mobileInitializeResultSchema
  ),
  catalog: fallibleEndpoint(z.void().optional(), mobileCatalogSchema),
  creationOptions: fallibleEndpoint(taskInputSchema, mobileCreationOptionsSchema),
  createAgent: fallibleEndpoint(
    z.strictObject({
      requestId: requestIdSchema,
      taskId: z.string(),
      interface: z.enum(['acp', 'pty']),
      providerId: z.string(),
      model: z.string().nullable().optional(),
      autoApprove: z.boolean().optional(),
    }),
    mobileResourceHandleSchema
  ),
  createTerminal: fallibleEndpoint(
    z.strictObject({
      requestId: requestIdSchema,
      taskId: z.string(),
      shellId: z.string().optional(),
    }),
    mobileResourceHandleSchema
  ),
  openResource: fallibleEndpoint(
    z.strictObject({
      kind: z.enum(['acp', 'conversation', 'terminal']),
      resourceId: z.string(),
    }),
    mobileResourceHandleSchema
  ),
  closeResource: fallibleEndpoint(handleInputSchema, z.void()),
  renameResource: fallibleEndpoint(
    z.strictObject({ handleId: z.string(), name: z.string().trim().min(1).max(100) }),
    z.void()
  ),
  pty: defineContract({
    output: liveLog({ key: mobilePtyOutputKeySchema }),
    sendInput: fallibleEndpoint(
      z.strictObject({ handleId: z.string(), data: z.string().max(8 * 1024) }),
      z.void()
    ),
    resize: fallibleEndpoint(
      z.strictObject({
        handleId: z.string(),
        cols: z.number().int().min(20).max(500),
        rows: z.number().int().min(5).max(300),
      }),
      z.void()
    ),
  }),
  acp: defineContract({
    snapshot: fallibleEndpoint(
      z.strictObject({ handleId: z.string(), before: z.number().int().optional() }),
      mobileAcpSnapshotSchema
    ),
    sendPrompt: fallibleEndpoint(
      z.strictObject({ handleId: z.string(), prompt: mobilePromptSchema }),
      z.strictObject({ queued: z.boolean() })
    ),
    queuePrompt: fallibleEndpoint(
      z.strictObject({ handleId: z.string(), prompt: mobilePromptSchema }),
      z.strictObject({ queued: z.boolean() })
    ),
    editQueuedPrompt: fallibleEndpoint(
      z.strictObject({ handleId: z.string(), id: z.string(), input: promptInputSchema }),
      z.void()
    ),
    deleteQueuedPrompt: fallibleEndpoint(
      z.strictObject({ handleId: z.string(), id: z.string() }),
      z.void()
    ),
    reorderQueuedPrompts: fallibleEndpoint(
      z.strictObject({ handleId: z.string(), ids: z.array(z.string()) }),
      z.void()
    ),
    cancel: fallibleEndpoint(handleInputSchema, z.void()),
    resolvePermission: fallibleEndpoint(
      z.strictObject({ handleId: z.string(), decision: permissionDecisionSchema }),
      z.void()
    ),
    setConfig: fallibleEndpoint(
      z.strictObject({
        handleId: z.string(),
        dimension: z.enum(['model', 'effort', 'mode']),
        value: z.string(),
      }),
      z.void()
    ),
    setDraft: fallibleEndpoint(
      z.strictObject({
        handleId: z.string(),
        expectedRev: z.number().int().nonnegative().nullable(),
        input: promptInputSchema.nullable(),
      }),
      mobileDraftConflictSchema
    ),
    exportTranscript: downloadFile({
      input: z.strictObject({ handleId: z.string(), format: z.enum(['parsed', 'raw']) }),
      error: mobileAccessErrorSchema,
    }),
    uploadAttachment: uploadFile({
      input: handleInputSchema,
      accept: attachmentMimeTypeSchema.options,
      maxSize: 10 * 1024 * 1024,
      result: attachmentRefSchema,
      error: mobileAccessErrorSchema,
    }),
    deleteAttachment: fallibleEndpoint(
      z.strictObject({ handleId: z.string(), attachmentId: z.string() }),
      z.void()
    ),
  }),
  files: defineContract({
    list: fallibleEndpoint(
      z.strictObject({ taskId: z.string(), path: z.string().max(4096) }),
      z.array(mobileFileEntrySchema)
    ),
    read: fallibleEndpoint(
      z.strictObject({ taskId: z.string(), path: z.string().max(4096) }),
      mobileFileReadSchema
    ),
  }),
  diffs: defineContract({
    list: fallibleEndpoint(taskInputSchema, z.array(mobileDiffEntrySchema)),
    read: fallibleEndpoint(
      z.strictObject({ taskId: z.string(), path: z.string().max(4096), staged: z.boolean() }),
      mobileDiffReadSchema
    ),
  }),
});

export type MobileAccessContract = typeof mobileAccessContract;
