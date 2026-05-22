import { Plus } from 'lucide-react';
import { Button } from '@renderer/lib/ui/button';

interface AutomationsEmptyStateProps {
  createPending: boolean;
  onNewAutomation: () => void;
}

export function AutomationsEmptyState({
  createPending,
  onNewAutomation,
}: AutomationsEmptyStateProps) {
  return (
    <div className="rounded-md border border-dashed border-border px-6 py-12 text-center">
      <p className="text-sm text-muted-foreground">
        No automations yet. Use a template or start from scratch.
      </p>
      <Button
        size="sm"
        variant="outline"
        className="mt-3"
        disabled={createPending}
        onClick={onNewAutomation}
      >
        <Plus className="mr-1.5 h-3.5 w-3.5" />
        New Automation
      </Button>
    </div>
  );
}

export function AutomationsNoResults() {
  return (
    <div className="mb-6 py-12 text-center">
      <p className="text-sm text-muted-foreground">No automations match your search.</p>
    </div>
  );
}
