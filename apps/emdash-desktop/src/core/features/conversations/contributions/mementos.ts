import { defineVersionedSchema } from '@emdash/core/primitives/versioned-schema/api';
import { imageAttachmentMimeTypeSchema } from '@emdash/core/runtimes/acp/api/client';
import { z } from 'zod';
import { days, defineMemento } from '@core/primitives/mementos/api';
import { appSubject } from '@core/primitives/subjects/api';
import { conversationSubject } from './subject';

export const ACP_DRAFT_MAX_LENGTH = 65_536;

const acpDraftV1Schema = z.object({
  version: z.literal('1'),
  text: z.string().max(ACP_DRAFT_MAX_LENGTH),
  attachments: z.array(
    z.object({
      id: z.string(),
      mimeType: imageAttachmentMimeTypeSchema,
      name: z.string().optional(),
    })
  ),
});

export const acpDraftSchema = defineVersionedSchema().initial('1', acpDraftV1Schema).build();
export type AcpDraftState = typeof acpDraftSchema.Type;

const providerPreferenceSchema = z.object({
  model: z.string().optional(),
  modeId: z.string().optional(),
  effort: z.string().optional(),
  collaborationMode: z.string().optional(),
});

export const providerPreferencesSchema = defineVersionedSchema()
  .initial(
    '1',
    z.object({
      version: z.literal('1'),
      entries: z.record(z.string(), providerPreferenceSchema),
    })
  )
  .build();
export type ProviderPreference = z.infer<typeof providerPreferenceSchema>;
export type ProviderPreferencesState = typeof providerPreferencesSchema.Type;

export const acpDraftMemento = defineMemento({
  id: 'conversations.acp-draft',
  subject: conversationSubject,
  schema: acpDraftSchema,
  default: {
    version: '1' as const,
    text: '',
    attachments: [],
  },
  retention: { tier: 'persisted', maxAge: days(90), maxEntries: 5_000 },
});

export const providerPreferencesMemento = defineMemento({
  id: 'conversations.provider-preferences',
  subject: appSubject,
  schema: providerPreferencesSchema,
  default: { version: '1' as const, entries: {} },
  retention: {
    tier: 'persisted',
    // Effectively non-expiring; the memento service requires a finite retention window.
    maxAge: Number.MAX_SAFE_INTEGER,
    maxEntries: 1,
  },
});
