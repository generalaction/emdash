import { cn } from '@renderer/utils/utils';
import { ToggleGroup, ToggleGroupItem } from './toggle-group';

interface MiniTab {
  value: string;
  label: string;
  disabled?: boolean;
}

interface MiniTabsProps {
  value: string;
  onValueChange: (value: string) => void;
  tabs: MiniTab[];
  /** Stretch items to fill the container equally. Pass alongside className="w-full". */
  stretch?: boolean;
  className?: string;
}

export function MiniTabs({ value, onValueChange, tabs, stretch = false, className }: MiniTabsProps) {
  return (
    <ToggleGroup
      className={cn('gap-1 border-none bg-transparent', className)}
      value={[value]}
      onValueChange={([v]) => {
        if (v) onValueChange(v);
      }}
    >
      {tabs.map((tab) => (
        <ToggleGroupItem
          key={tab.value}
          className={cn(
            'h-6! rounded-lg! px-2! py-0.5! text-xs',
            stretch ? 'flex-1' : 'min-w-0!'
          )}
          value={tab.value}
          disabled={tab.disabled}
        >
          {tab.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
