import { defineVersionedSchema } from '@emdash/core/primitives/versioned-schema/api';
import { z } from 'zod';
import { days, defineMemento } from '@core/primitives/mementos/api';
import { conversationSubject } from './subject';

export const ACP_DRAFT_MAX_LENGTH = 65_536;

const acpDraftV1Schema = z.object({
  version: z.literal('1'),
  text: z.string().max(ACP_DRAFT_MAX_LENGTH),
});

export const acpDraftSchema = defineVersionedSchema().initial('1', acpDraftV1Schema).build();
export type AcpDraftState = typeof acpDraftSchema.Type;

export const acpDraftMemento = defineMemento({
  id: 'conversations.acp-draft',
  subject: conversationSubject,
  schema: acpDraftSchema,
  default: {
    version: '1' as const,
    text: '',
  },
  retention: { tier: 'persisted', maxAge: days(90), maxEntries: 5_000 },
});
