import { Plus } from 'lucide-react';
import { Button } from '@renderer/lib/ui/button';
import { EmptyState } from '@renderer/lib/ui/empty-state';

interface AutomationsEmptyStateProps {
  createPending: boolean;
  onNewAutomation: () => void;
}

export function AutomationsEmptyState({
  createPending,
  onNewAutomation,
}: AutomationsEmptyStateProps) {
  return (
    <EmptyState
      label="No automations yet"
      description="Use a template or start from scratch."
      action={
        <Button size="sm" variant="outline" disabled={createPending} onClick={onNewAutomation}>
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          New Automation
        </Button>
      }
    />
  );
}

export function AutomationsNoResults() {
  return <EmptyState label="No matches" description="No automations match your search." />;
}
