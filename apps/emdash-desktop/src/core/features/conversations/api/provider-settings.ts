import { serializedHostRefSchema } from '@emdash/core/primitives/host/api';
import { defineVersionedSchema } from '@emdash/core/primitives/versioned-schema/api';
import {
  providerConfigOptionSchema,
  providerOptionValuesSchema,
} from '@emdash/core/runtimes/acp/api/client';
import { defineContract, liveModel, liveState, procedure } from '@emdash/wire/rpc';
import { z } from 'zod';

export const providerSettingsKeySchema = z.object({
  host: serializedHostRefSchema,
  providerId: z.string(),
});
export type ProviderSettingsKey = z.infer<typeof providerSettingsKeySchema>;
export const acpPreferenceSchema = defineVersionedSchema()
  .initial('1', z.object({ version: z.literal('1'), options: providerOptionValuesSchema }))
  .build();
export const ptyPreferenceSchema = defineVersionedSchema()
  .initial('1', z.object({ version: z.literal('1'), autoApprove: z.boolean() }))
  .build();
export const providerOptionsCacheSchema = defineVersionedSchema()
  .initial(
    '1',
    z.object({
      version: z.literal('1'),
      options: z.array(providerConfigOptionSchema),
    })
  )
  .build();
export const providerSettingsSnapshotSchema = z.object({
  acp: acpPreferenceSchema.asNested(),
  pty: ptyPreferenceSchema.asNested(),
  catalogs: z.array(z.array(providerConfigOptionSchema)),
});
export type ProviderSettingsSnapshot = z.infer<typeof providerSettingsSnapshotSchema>;
export const emptyProviderSettings: ProviderSettingsSnapshot = {
  acp: { version: '1', options: {} },
  pty: { version: '1', autoApprove: false },
  catalogs: [],
};
export const providerPreferencePatchSchema = z.discriminatedUnion('transport', [
  z.object({ transport: z.literal('acp'), options: providerOptionValuesSchema }).strict(),
  z.object({ transport: z.literal('pty'), autoApprove: z.boolean() }).strict(),
]);
export type ProviderPreferencePatch = z.infer<typeof providerPreferencePatchSchema>;
export const providerSettingsContract = defineContract({
  model: liveModel({
    key: providerSettingsKeySchema,
    states: { value: liveState({ data: providerSettingsSnapshotSchema }) },
  }),
  patch: procedure({
    input: providerSettingsKeySchema.extend({
      patch: providerPreferencePatchSchema,
    }),
    output: providerSettingsSnapshotSchema,
  }),
});
