import { SettingsCard } from '@emdash/ui/react/patterns';
import { Heading, SeparatedList } from '@emdash/ui/react/primitives';
import * as React from 'react';
import { AccountTab } from '../components/AccountTab';
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

const dragStyle: React.CSSProperties & { WebkitAppRegion: string } = {
  WebkitAppRegion: 'drag',
};

export function GeneralSettingsPage() {
  return (
    <div className="pb-10">
      <div className="h-10 w-full" style={dragStyle} aria-hidden="true" />
      <div className="space-y-8">
        <Heading level={1}>General</Heading>
        <div className="space-y-3"></div>
        <div className="space-y-3">
          <SettingsCard>
            <AccountTab />
          </SettingsCard>
        </div>
        <div className="space-y-3">
          <Heading level={3} className="px-4">
            App
          </Heading>
          <SettingsCard>
            <SeparatedList gap="1rem" direction="column">
              <UpdateCard />
              <TelemetryCard />
            </SeparatedList>
          </SettingsCard>
        </div>
        <div className="space-y-3">
          <Heading level={3} className="px-4">
            Notifications
          </Heading>
          <NotificationSettingsCard />
        </div>
        <div className="space-y-3">
          <Heading level={3} className="px-4">
            Preferences
          </Heading>
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
        </div>
      </div>
    </div>
  );
}
