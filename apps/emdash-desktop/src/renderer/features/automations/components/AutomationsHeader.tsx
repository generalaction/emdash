import { Plus } from 'lucide-react';
import { PageHeader } from '@renderer/lib/components/page-header';
import { Button } from '@renderer/lib/ui/button';
import { SearchInput } from '@renderer/lib/ui/search-input';

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
