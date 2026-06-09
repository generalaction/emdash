import { ToggleGroup, ToggleGroupItem } from '@renderer/lib/ui/toggle-group';
import { cn } from '@renderer/utils/utils';

interface PanelTab<T extends string> {
  value: T;
  label: string;
}

interface PanelTabsProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  tabs: PanelTab<T>[];
  /** When true the group and items size to content instead of stretching full width. */
  compact?: boolean;
  className?: string;
}

export function PanelTabs<T extends string>({
  value,
  onChange,
  tabs,
  compact = false,
  className,
}: PanelTabsProps<T>) {
  return (
    <ToggleGroup
      className={cn(
        'shrink-0 gap-1 border-none bg-transparent',
        compact ? 'w-fit' : 'w-full',
        className
      )}
      value={[value]}
      onValueChange={([v]) => {
        if (v) onChange(v as T);
      }}
    >
      {tabs.map((tab) => (
        <ToggleGroupItem
          key={tab.value}
          className={cn('h-6! rounded-lg! px-2! py-0.5! text-xs', !compact && 'flex-1')}
          value={tab.value}
        >
          {tab.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
