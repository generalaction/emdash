import { z } from 'zod';
import { workbenchLayout } from '@core/primitives/layouts/api';
import { defineView } from '@core/primitives/views/api';

export const settingsPageTabSchema = z.enum([
  'general',
  'account',
  'clis-models',
  'integrations',
  'connections',
  'browser',
  'repository',
  'interface',
  'docs',
]);

export type SettingsPageTab = z.infer<typeof settingsPageTabSchema>;

export const settingsViewDef = defineView({
  id: 'settings',
  params: z.object({
    tab: settingsPageTabSchema.optional(),
  }),
  layout: workbenchLayout,
  telemetryEvent: 'settings_viewed',
});
