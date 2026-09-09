import { tokens } from '@emdash/theme';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { sx } from '@styles/index';
import {
  Activity,
  Brain,
  Folder,
  GitPullRequest,
  ListTodo,
  MessageSquare,
  PanelsTopLeft,
  Server,
  Settings,
  User,
} from 'lucide-react';
import { useState } from 'react';
import { Icon } from '../../primitives/icon';
import { PillTabs, type PillTab, type PillTabsLabelVisibility } from './pill-tabs';

const meta: Meta = {
  title: 'Patterns/PillTabs',
  parameters: { layout: 'padded' },
};

export default meta;
type Story = StoryObj;

type ProjectSection = 'tasks' | 'pull-requests' | 'workspaces' | 'settings';

const projectTabs: readonly PillTab<ProjectSection>[] = [
  { value: 'tasks', label: 'Tasks', icon: <Icon source={ListTodo} /> },
  { value: 'pull-requests', label: 'Pull Requests', icon: <Icon source={GitPullRequest} /> },
  { value: 'workspaces', label: 'Workspaces', icon: <Icon source={PanelsTopLeft} /> },
  { value: 'settings', label: 'Settings', icon: <Icon source={Settings} /> },
];

function ProjectTabsExample({
  labelVisibility = 'always',
  disabled,
  className,
}: {
  labelVisibility?: PillTabsLabelVisibility;
  disabled?: ProjectSection;
  className?: string;
}) {
  const [value, setValue] = useState<ProjectSection>('tasks');
  const items = projectTabs.map((item) => ({
    ...item,
    disabled: item.value === disabled,
  }));
  return (
    <PillTabs
      items={items}
      value={value}
      onValueChange={setValue}
      ariaLabel="Project sections"
      labelVisibility={labelVisibility}
      className={className}
    />
  );
}

export const AlwaysVisibleLabels: Story = {
  render: () => <ProjectTabsExample />,
};

export const ActiveLabelOnly: Story = {
  render: () => <ProjectTabsExample labelVisibility="active-only" />,
};

export const DisabledTab: Story = {
  render: () => <ProjectTabsExample labelVisibility="active-only" disabled="pull-requests" />,
};

export const NarrowWidth: Story = {
  render: () => (
    <div style={{ width: '20rem' }}>
      <ProjectTabsExample labelVisibility="active-only" />
    </div>
  ),
};

/** Caller-owned block padding through the documented tablist root seam. */
export const SxOverride: Story = {
  render: () => <ProjectTabsExample className={sx({ p: tokens.space.step2 })} />,
};

type MachineSection = 'system' | 'workspaces' | 'conversations' | 'agents' | 'mcp' | 'skills';

const machineTabs: readonly PillTab<MachineSection>[] = [
  { value: 'system', label: 'System', icon: <Icon source={Activity} /> },
  { value: 'workspaces', label: 'Workspaces', icon: <Icon source={Folder} /> },
  { value: 'conversations', label: 'Conversations', icon: <Icon source={MessageSquare} /> },
  { value: 'agents', label: 'Agents', icon: <Icon source={User} /> },
  { value: 'mcp', label: 'MCP', icon: <Icon source={Server} /> },
  { value: 'skills', label: 'Skills', icon: <Icon source={Brain} /> },
];

function MachineTabsExample() {
  const [value, setValue] = useState<MachineSection>('system');
  return (
    <PillTabs
      items={machineTabs}
      value={value}
      onValueChange={setValue}
      ariaLabel="Machine sections"
      labelVisibility="active-only"
    />
  );
}

export const SixTabs: Story = {
  render: () => <MachineTabsExample />,
};
