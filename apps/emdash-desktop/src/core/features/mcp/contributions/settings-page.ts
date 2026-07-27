import type { SettingsPageTab } from '@core/features/settings/contributions/views';
import {
  defineSettingsPageContribution,
  type SettingsPageContribution,
} from '@core/primitives/settings/api/page-contribution';
import { McpView } from '../api/browser/components/McpView';

export const mcpSettingsPage = defineSettingsPageContribution({
  id: 'mcp',
  label: 'MCPs',
  icon: 'server',
  component: McpView,
} satisfies SettingsPageContribution<SettingsPageTab>);
