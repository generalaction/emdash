import { SettingsRow, type SettingsRowProps } from '@agent/ui/react/patterns';
import * as React from 'react';

export interface SettingRowProps extends Omit<SettingsRowProps, 'label'> {
  title: React.ReactNode;
}

/**
 * Local SettingRow — a thin wrapper around `@agent/ui`'s `SettingsRow` that
 * preserves the existing `title` prop name used across the settings feature.
 */
export function SettingRow({ title, ...props }: SettingRowProps) {
  return <SettingsRow label={title} {...props} />;
}
