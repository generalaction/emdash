import type { SettingsPageTab } from '@core/features/settings/contributions/views';
import {
  defineSettingsPageContribution,
  type SettingsPageContribution,
} from '@core/primitives/settings/api/page-contribution';
import { UsageSettingsPage } from '../browser/usage-settings-page';

export const usageSettingsPage = defineSettingsPageContribution({
  id: 'usage',
  label: 'Usage',
  icon: 'chart-no-axes-combined',
  component: UsageSettingsPage,
} satisfies SettingsPageContribution<SettingsPageTab>);
