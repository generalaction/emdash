import { Plus } from 'lucide-react';
import { Button } from '@core/primitives/ui/browser/button';
import { PageHeader } from '@core/primitives/ui/browser/components/page-header';
import { SearchInput } from '@core/primitives/ui/browser/search-input';

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
  return (
    <PageHeader title={'Automations'} description={'Run agents on a schedule across your projects'}>
      <div className="flex items-center justify-between gap-2">
        <SearchInput
          placeholder={'Search automations...'}
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
        />
        <Button
          className="shrink-0 whitespace-nowrap"
          disabled={createPending}
          onClick={onNewAutomation}
        >
          <Plus className="h-3.5 w-3.5" />
          New Automation
        </Button>
      </div>
    </PageHeader>
  );
}
