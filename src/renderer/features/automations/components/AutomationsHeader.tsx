import { Plus } from 'lucide-react';
import { Button } from '@renderer/lib/ui/button';
import { SearchInput } from '@renderer/lib/ui/search-input';
import { cn } from '@renderer/utils/utils';

interface AutomationsHeaderProps {
  title: string;
  subtitle: string;
  showActions: boolean;
  showNewButton: boolean;
  panelOpen: boolean;
  search: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder: string;
  createPending: boolean;
  onNewAutomation: () => void;
}

export function AutomationsHeader({
  title,
  subtitle,
  showActions,
  showNewButton,
  panelOpen,
  search,
  onSearchChange,
  searchPlaceholder,
  createPending,
  onNewAutomation,
}: AutomationsHeaderProps) {
  return (
    <div className="mb-6">
      <div className="min-w-0">
        <h1 className="truncate text-lg font-semibold">{title}</h1>
        <p className="text-muted-foreground mt-1 max-w-md text-xs text-pretty">{subtitle}</p>
      </div>

      {showActions && (
        <div className="mt-4 flex items-center justify-between gap-2">
          <SearchInput
            containerClassName={cn('max-w-full min-w-0 shrink-0', panelOpen ? 'w-48' : 'w-64')}
            placeholder={searchPlaceholder}
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            aria-label={searchPlaceholder}
            className="w-full min-w-0 focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:outline-none"
          />

          {showNewButton ? (
            <Button
              size="sm"
              variant="outline"
              className="shrink-0 whitespace-nowrap"
              disabled={createPending}
              onClick={onNewAutomation}
            >
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              New Automation
            </Button>
          ) : null}
        </div>
      )}
    </div>
  );
}
