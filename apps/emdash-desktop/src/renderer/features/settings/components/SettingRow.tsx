import React from 'react';
import { cn } from '@renderer/utils/utils';
import {
  SETTING_HIGHLIGHT_CLASS,
  SettingsSearchTarget,
  useSettingsSearchHighlight,
} from '../search/settings-search-context';
import { slugifySettingLabel } from '../search/settings-search';

interface SettingRowProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  control: React.ReactNode;
  className?: string;
  /** Search index id; defaults to the slugified title when the title is a string. */
  searchId?: string;
  /** Compatibility alias for settings introduced before sidebar-filter search. */
  settingId?: string;
}

export function SettingRow({
  title,
  description,
  control,
  className,
  searchId,
  settingId,
}: SettingRowProps) {
  const id =
    searchId ?? settingId ?? (typeof title === 'string' ? slugifySettingLabel(title) : undefined);
  const highlighted = useSettingsSearchHighlight(id);
  return (
    <div
      data-setting-id={id}
      data-highlighted={highlighted || undefined}
      className={cn(
        'flex min-w-0 flex-wrap items-start gap-x-4 gap-y-2',
        highlighted && SETTING_HIGHLIGHT_CLASS,
        className
      )}
    >
      <div className="flex min-w-0 flex-1 basis-64 flex-col gap-0.5">
        <div className="text-sm break-words text-foreground">{title}</div>
        {description && (
          <div className="text-xs break-words text-foreground-passive">{description}</div>
        )}
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-1">{control}</div>
    </div>
  );
}

export function SettingTarget({
  settingId,
  className,
  children,
}: {
  settingId: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <SettingsSearchTarget id={settingId} className={className}>
      {children}
    </SettingsSearchTarget>
  );
}
