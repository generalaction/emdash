import React from 'react';

interface SettingRowProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  control: React.ReactNode;
}

export function SettingRow({ title, description, control }: SettingRowProps) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex flex-1 flex-col gap-0.5">
        <div className="text-sm text-foreground">{title}</div>
        {description && <div className="text-xs text-foreground-passive">{description}</div>}
      </div>
      <div className="flex items-center gap-1">{control}</div>
    </div>
  );
}
