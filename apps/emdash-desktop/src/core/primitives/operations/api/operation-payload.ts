import { defineVersionedSchema } from '@emdash/core/primitives/versioned-schema/api';
import z from 'zod';

const confirmationReasonSchema = z
  .enum(['stale', 'workspace-modified', 'reconciler-proposed', 'workspace-busy'])
  .optional();

const commonPayloadShape = {
  source: z.enum(['user', 'reconciler']),
  entityName: z.string().optional(),
  workspacePath: z.string().optional(),
  branchName: z.string().optional(),
  hostLabel: z.string().optional(),
};

type OperationPayloadSchemaOptions = {
  unknownKeys?: 'strict' | 'passthrough';
};

export function defineOperationKindPayloadSchema<TShape extends z.ZodRawShape>(
  shape: TShape,
  options: OperationPayloadSchemaOptions = {}
) {
  const object = <T extends z.ZodRawShape>(schemaShape: T) =>
    options.unknownKeys === 'passthrough'
      ? z.object(schemaShape).passthrough()
      : z.strictObject(schemaShape);
  const v2Shape = {
    version: z.literal('2'),
    source: commonPayloadShape.source,
    ...shape,
  };
  const v2Schema = object(v2Shape);
  const v1Schema = object({
    ...v2Shape,
    version: z.literal('1'),
    confirmationReason: confirmationReasonSchema,
    confirmedAt: z.number().int().nonnegative().optional(),
  });
  return defineVersionedSchema()
    .initial('1', v1Schema)
    .version('2', v2Schema, (previous) => {
      const payload = { ...(previous as Record<string, unknown>) };
      delete payload.confirmationReason;
      delete payload.confirmedAt;
      return v2Schema.parse({ ...payload, version: '2' });
    })
    .build();
}

const operationPayloadShape = {
  ...commonPayloadShape,
  deleteWorktree: z.boolean().optional(),
  deleteBranch: z.boolean().optional(),
  acpConversationIds: z.array(z.string()).optional(),
  tuiConversationIds: z.array(z.string()).optional(),
  terminalSessionIds: z.array(z.string()).optional(),
  tmuxSessionNames: z.array(z.string()).optional(),
};

export const operationPayload = defineOperationKindPayloadSchema(operationPayloadShape, {
  unknownKeys: 'passthrough',
});

export type OperationPayload = typeof operationPayload.Type;
