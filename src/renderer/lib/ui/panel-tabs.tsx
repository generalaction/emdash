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
  className?: string;
}

export function PanelTabs<T extends string>({
  value,
  onChange,
  tabs,
  className,
}: PanelTabsProps<T>) {
  return (
    <ToggleGroup
      className={cn('w-full shrink-0 gap-1 border-none bg-transparent', className)}
      value={[value]}
      onValueChange={([v]) => {
        if (v) onChange(v as T);
      }}
    >
      {tabs.map((tab) => (
        <ToggleGroupItem
          key={tab.value}
          className="h-6! flex-1 rounded-lg! px-2! py-0.5! text-xs"
          value={tab.value}
        >
          {tab.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
