import { Plus } from 'lucide-react';
import { PageHeader } from '@renderer/lib/components/page-header';
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
    <PageHeader title={title} description={subtitle}>
      {showActions && (
        <div className="flex items-center justify-between gap-2">
          <SearchInput
            placeholder={searchPlaceholder}
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            aria-label={searchPlaceholder}
          />
          {showNewButton ? (
            <Button
              className="shrink-0 whitespace-nowrap"
              disabled={createPending}
              onClick={onNewAutomation}
            >
              <Plus className="h-3.5 w-3.5" />
              New Automation
            </Button>
          ) : null}
        </div>
      )}
    </PageHeader>
  );
}
