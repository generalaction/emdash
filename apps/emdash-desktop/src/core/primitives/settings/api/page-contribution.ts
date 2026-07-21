import type { IconName } from '@emdash/ui/react/primitives';
import type { ComponentType } from 'react';

export interface SettingsPageContribution<TId extends string = string> {
  id: TId;
  label: string;
  icon?: IconName;
  component: ComponentType;
}

export function defineSettingsPageContribution<TId extends string>(
  contribution: SettingsPageContribution<TId>
): SettingsPageContribution<TId> {
  return Object.freeze(contribution);
}
