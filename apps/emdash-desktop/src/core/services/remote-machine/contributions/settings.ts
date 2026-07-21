import { z } from 'zod';
import type { RemoteMachineSettings } from '@core/primitives/app-settings/api';
import { defineSettingsContribution } from '@core/primitives/settings/api';

const remoteMachineSettingsSchema = z.object({
  installBaseUrl: z.string(),
  installCommand: z.string().nullable(),
});

export const remoteMachineSettingsContribution = defineSettingsContribution<
  'remoteMachine',
  RemoteMachineSettings
>({
  key: 'remoteMachine',
  schema: remoteMachineSettingsSchema,
  defaults: () => ({
    installBaseUrl:
      process.env['EMDASH_WORKSPACE_SERVER_ARTIFACTS_URL'] ??
      'https://releases.emdash.sh/workspace-server',
    installCommand: process.env['EMDASH_WORKSPACE_SERVER_INSTALL_COMMAND'] ?? null,
  }),
});
