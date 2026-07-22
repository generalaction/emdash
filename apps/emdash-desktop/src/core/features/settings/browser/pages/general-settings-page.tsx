import { PageLayout, SettingsCard } from '@emdash/ui/react/patterns';
import { SeparatedList } from '@emdash/ui/react/primitives';
import NotificationSettingsCard from '../components/NotificationSettingsCard';
import {
  AutoApproveByDefaultRow,
  AutoGenerateTaskNamesRow,
  AutoTrustWorktreesRow,
  CreateBranchAndWorktreeRow,
  DeleteBranchByDefaultRow,
  EnableTmuxRow,
  IncludeIssueContextByDefaultRow,
  PreserveTaskNameCapitalizationRow,
} from '../components/TaskSettingsRows';
import TelemetryCard from '../components/TelemetryCard';
import { UpdateCard } from '../components/UpdateCard';

export function GeneralSettingsPage() {
  return (
    <div className="space-y-8 pb-10">
      <PageLayout.Header
        sticky
        title="General"
        description="Manage your account, privacy settings, notifications, and app updates."
      />
      <SettingsCard>
        <SeparatedList gap="1rem" direction="column">
          <UpdateCard />
          <TelemetryCard />
        </SeparatedList>
      </SettingsCard>
      <SettingsCard>
        <SeparatedList gap="1rem" direction="column">
          <AutoGenerateTaskNamesRow />
          <AutoApproveByDefaultRow />
          <AutoTrustWorktreesRow />
          <CreateBranchAndWorktreeRow />
          <DeleteBranchByDefaultRow />
          <PreserveTaskNameCapitalizationRow />
          <IncludeIssueContextByDefaultRow />
          <EnableTmuxRow />
        </SeparatedList>
      </SettingsCard>
      <NotificationSettingsCard />
    </div>
  );
}
