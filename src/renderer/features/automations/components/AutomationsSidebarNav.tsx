import { cn } from '@renderer/utils/utils';
import { AUTOMATIONS_TABS, type AutomationsTab } from '../automations-view';

interface AutomationsSidebarNavProps {
  tab: AutomationsTab;
  onTabChange: (tab: AutomationsTab) => void;
}

export function AutomationsSidebarNav({ tab, onTabChange }: AutomationsSidebarNavProps) {
  return (
    <nav className="flex min-h-0 w-52 flex-col gap-0.5 overflow-y-auto">
      {AUTOMATIONS_TABS.map((item) => {
        const isActive = item.id === tab;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onTabChange(item.id)}
            className={cn(
              'flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-normal text-foreground-muted transition-colors hover:bg-background-1 hover:text-foreground',
              isActive &&
                'bg-background-2 text-foreground hover:bg-background-2 hover:text-foreground'
            )}
          >
            <span className="text-left">{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
