import type { SettingsPageTab } from '@core/features/settings/contributions/views';
import {
  defineSettingsPageContribution,
  type SettingsPageContribution,
} from '@core/primitives/settings/api/page-contribution';
import { SkillsView } from '../api/browser/components/SkillsView';

export const skillsSettingsPage = defineSettingsPageContribution({
  id: 'skills',
  label: 'Skills',
  icon: 'brain',
  component: SkillsView,
} satisfies SettingsPageContribution<SettingsPageTab>);
