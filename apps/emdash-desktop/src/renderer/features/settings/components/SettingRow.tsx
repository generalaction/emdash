import React from 'react';
import { cn } from '@renderer/utils/utils';

const SettingHighlightContext = React.createContext<string | null>(null);

export function SettingsHighlightProvider({
  highlightedSettingId,
  children,
}: {
  highlightedSettingId: string | null;
  children: React.ReactNode;
}) {
  return (
    <SettingHighlightContext.Provider value={highlightedSettingId}>
      {children}
    </SettingHighlightContext.Provider>
  );
}

export function useIsSettingHighlighted(settingId?: string): boolean {
  const highlightedSettingId = React.useContext(SettingHighlightContext);
  return settingId !== undefined && highlightedSettingId === settingId;
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
  const highlighted = useIsSettingHighlighted(settingId);

  return (
    <div
      data-setting-id={settingId}
      data-highlighted={highlighted ? 'true' : undefined}
      className={cn(
        'scroll-mt-24 rounded-lg transition-[background-color,box-shadow] duration-500',
        highlighted && 'bg-background-2 shadow-[0_0_0_1px_var(--ring)]',
        className
      )}
    >
      {children}
    </div>
  );
}

interface SettingRowProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  control: React.ReactNode;
  className?: string;
  settingId?: string;
}

export function SettingRow({ title, description, control, className, settingId }: SettingRowProps) {
  const highlighted = useIsSettingHighlighted(settingId);

  return (
    <div
      data-setting-id={settingId}
      data-highlighted={highlighted ? 'true' : undefined}
      className={cn(
        'flex min-w-0 scroll-mt-24 flex-wrap items-start gap-x-4 gap-y-2 rounded-lg transition-[background-color,box-shadow] duration-500',
        settingId && '-mx-2 px-2 py-2',
        highlighted && 'bg-background-2 shadow-[0_0_0_1px_var(--ring)]',
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
