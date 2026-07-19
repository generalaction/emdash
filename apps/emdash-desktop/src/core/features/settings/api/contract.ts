import { defineContract, procedure } from '@emdash/wire';
import { z } from 'zod';
import type { AppSettings, AppSettingsKey } from '@core/primitives/app-settings/api';

export const appSettingsContract = defineContract({
  get: procedure({
    input: z.object({ key: z.custom<AppSettingsKey>() }),
    output: z.custom<AppSettings[AppSettingsKey]>(),
  }),
  getAll: procedure({ input: z.void(), output: z.custom<AppSettings>() }),
  getWithMeta: procedure({
    input: z.object({ key: z.custom<AppSettingsKey>() }),
    output: z.custom<{
      value: AppSettings[AppSettingsKey];
      defaults: AppSettings[AppSettingsKey];
      overrides: Partial<AppSettings[AppSettingsKey]>;
    }>(),
  }),
  update: procedure({
    input: z.object({
      key: z.custom<AppSettingsKey>(),
      value: z.custom<AppSettings[AppSettingsKey]>(),
    }),
    output: z.void(),
  }),
  reset: procedure({
    input: z.object({ key: z.custom<AppSettingsKey>() }),
    output: z.void(),
  }),
  resetField: procedure({
    input: z.object({ key: z.custom<AppSettingsKey>(), field: z.string() }),
    output: z.void(),
  }),
});
