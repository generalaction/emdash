import { PageLayout } from '@emdash/ui/react/patterns';
import { MachinesCard } from '../../api/browser/components/MachinesCard';

export function ConnectionsSettingsPage() {
  return (
    <div className="space-y-8">
      <PageLayout.Header
        sticky
        title="Connections"
        description="Manage reusable SSH connections for remote projects."
      />
      <MachinesCard />
    </div>
  );
}
