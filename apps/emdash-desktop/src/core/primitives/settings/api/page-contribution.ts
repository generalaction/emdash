import type { IconName } from '@emdash/ui/react/primitives';
import type { ComponentType } from 'react';

export interface SettingsPageProps {
  openDetail: (detailId: string) => void;
}

export interface SettingsPageDetailProps {
  detailId: string;
  closeDetail: () => void;
}

export interface SettingsPageDetailContribution {
  component: ComponentType<SettingsPageDetailProps>;
  breadcrumbLabel: (detailId: string) => string | null;
}

export interface SettingsPageContribution<TId extends string = string> {
  id: TId;
  label: string;
  icon?: IconName;
  component: ComponentType<SettingsPageProps>;
  detail?: SettingsPageDetailContribution;
}

export function defineSettingsPageContribution<TId extends string>(
  contribution: SettingsPageContribution<TId>
): SettingsPageContribution<TId> {
  return Object.freeze(contribution);
}
