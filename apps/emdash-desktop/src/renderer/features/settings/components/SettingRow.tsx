import React from 'react';
import { cn } from '@renderer/utils/utils';

interface SettingRowProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  control: React.ReactNode;
  className?: string;
}

export function SettingRow({ title, description, control, className }: SettingRowProps) {
  return (
    <div className={cn('flex min-w-0 flex-wrap items-start gap-x-4 gap-y-2', className)}>
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
