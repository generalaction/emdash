import { PageLayout } from '@emdash/ui/react/patterns';
import { Button, SearchInput } from '@emdash/ui/react/primitives';
import { Plus } from 'lucide-react';
import { useSearchFocusHotkeys } from '@core/primitives/keybindings/browser';

interface AutomationsHeaderProps {
  search: string;
  onSearchChange: (value: string) => void;
  createPending: boolean;
  onNewAutomation: () => void;
}

export function AutomationsHeader({
  search,
  onSearchChange,
  createPending,
  onNewAutomation,
}: AutomationsHeaderProps) {
  const searchRef = useSearchFocusHotkeys();
  return (
    <PageLayout.Header
      title={'Automations'}
      description={'Run agents on a schedule across your projects'}
      actions={
        <div className="flex items-center justify-between gap-2">
          <SearchInput
            ref={searchRef}
            placeholder={'Search automations...'}
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
          />
          <Button
            variant="primary"
            className="shrink-0 whitespace-nowrap"
            disabled={createPending}
            onClick={onNewAutomation}
          >
            <Plus className="h-3.5 w-3.5" />
            New Automation
          </Button>
        </div>
      }
    />
  );
}
