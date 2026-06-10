import type { ReactNode } from 'react';
import { AccountTab } from './AccountTab';
import { CliAgentsList } from './CliAgentsList';
import DefaultAgentSettingsCard from './DefaultAgentSettingsCard';
import HiddenToolsSettingsCard from './HiddenToolsSettingsCard';
import IntegrationsCard from './IntegrationsCard';
import InterfaceSettingsCard from './InterfaceSettingsCard';
import KeyboardSettingsCard from './KeyboardSettingsCard';
import NotificationSettingsCard from './NotificationSettingsCard';
import RepositorySettingsCard from './RepositorySettingsCard';
import ResourceMonitorSettingsCard from './ResourceMonitorSettingsCard';
import {
  type SectionSearchConfig,
  type SettingsContentTab,
  type TabSearchConfig,
  settingsSearchContent,
} from './settings-page-config';
import SidebarMetadataSettingsCard from './SidebarMetadataSettingsCard';
import { SshConnectionsSettingsCard } from './SshConnectionsSettingsCard';
import {
  AutoGenerateTaskNamesRow,
  AutoTrustWorktreesRow,
  CreateBranchAndWorktreeRow,
  EnableTmuxRow,
  IncludeIssueContextByDefaultRow,
  PreserveTaskNameCapitalizationRow,
} from './TaskSettingsRows';
import TelemetryCard from './TelemetryCard';
import TerminalSettingsCard from './TerminalSettingsCard';
import ThemeCard from './ThemeCard';
import { UpdateCard } from './UpdateCard';

export interface SectionConfig extends SectionSearchConfig {
  action?: ReactNode;
  component: ReactNode;
}

export interface TabContent extends Omit<TabSearchConfig, 'sections'> {
  sections: SectionConfig[];
}

export const settingsTabContent: Record<SettingsContentTab, TabContent> = {
  general: {
    ...settingsSearchContent.general,
    sections: [
      {
        ...settingsSearchContent.general.sections[0],
        component: <TelemetryCard />,
      },
      {
        ...settingsSearchContent.general.sections[1],
        component: <AutoGenerateTaskNamesRow />,
      },
      {
        ...settingsSearchContent.general.sections[2],
        component: <AutoTrustWorktreesRow />,
      },
      {
        ...settingsSearchContent.general.sections[3],
        component: <CreateBranchAndWorktreeRow />,
      },
      {
        ...settingsSearchContent.general.sections[4],
        component: <PreserveTaskNameCapitalizationRow />,
      },
      {
        ...settingsSearchContent.general.sections[5],
        component: <IncludeIssueContextByDefaultRow />,
      },
      {
        ...settingsSearchContent.general.sections[6],
        component: <EnableTmuxRow />,
      },
      {
        ...settingsSearchContent.general.sections[7],
        component: <NotificationSettingsCard />,
      },
      {
        ...settingsSearchContent.general.sections[8],
        component: <UpdateCard />,
      },
    ],
  },
  account: {
    ...settingsSearchContent.account,
    sections: [
      {
        ...settingsSearchContent.account.sections[0],
        component: <AccountTab />,
      },
    ],
  },
  'clis-models': {
    ...settingsSearchContent['clis-models'],
    sections: [
      {
        ...settingsSearchContent['clis-models'].sections[0],
        component: <DefaultAgentSettingsCard />,
      },
      {
        ...settingsSearchContent['clis-models'].sections[1],
        component: (
          <div className="bg-muted/10 rounded-xl border border-border/60 p-2">
            <CliAgentsList />
          </div>
        ),
      },
    ],
  },
  integrations: {
    ...settingsSearchContent.integrations,
    sections: [
      {
        ...settingsSearchContent.integrations.sections[0],
        component: <IntegrationsCard />,
      },
    ],
  },
  connections: {
    ...settingsSearchContent.connections,
    sections: [
      {
        ...settingsSearchContent.connections.sections[0],
        component: <SshConnectionsSettingsCard />,
      },
    ],
  },
  repository: {
    ...settingsSearchContent.repository,
    sections: [
      {
        ...settingsSearchContent.repository.sections[0],
        component: <RepositorySettingsCard />,
      },
    ],
  },
  interface: {
    ...settingsSearchContent.interface,
    sections: [
      {
        ...settingsSearchContent.interface.sections[0],
        component: <ThemeCard />,
      },
      {
        ...settingsSearchContent.interface.sections[1],
        component: <TerminalSettingsCard />,
      },
      {
        ...settingsSearchContent.interface.sections[2],
        component: <SidebarMetadataSettingsCard />,
      },
      {
        ...settingsSearchContent.interface.sections[3],
        component: <ResourceMonitorSettingsCard />,
      },
      {
        ...settingsSearchContent.interface.sections[4],
        component: <InterfaceSettingsCard />,
      },
      {
        ...settingsSearchContent.interface.sections[5],
        component: <KeyboardSettingsCard />,
      },
      {
        ...settingsSearchContent.interface.sections[6],
        component: <HiddenToolsSettingsCard />,
      },
    ],
  },
};
