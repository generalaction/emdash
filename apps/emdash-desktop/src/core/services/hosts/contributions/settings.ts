import { z } from 'zod';
import type { HostSettings } from '@core/primitives/app-settings/api';
import { defineSettingsContribution } from '@core/primitives/settings/api';

const hostSettingsSchema = z.object({
  installBaseUrl: z.string(),
  installCommand: z.string().nullable(),
});

// The persisted settings key stays 'remoteMachine': it is stored in the app
// settings table and must not change in a structural rename.
export const hostSettingsContribution = defineSettingsContribution<'remoteMachine', HostSettings>({
  key: 'remoteMachine',
  schema: hostSettingsSchema,
  defaults: () => ({
    installBaseUrl:
      process.env['EMDASH_WORKSPACE_SERVER_ARTIFACTS_URL'] ??
      'https://releases.emdash.sh/workspace-server',
    installCommand: process.env['EMDASH_WORKSPACE_SERVER_INSTALL_COMMAND'] ?? null,
  }),
});
