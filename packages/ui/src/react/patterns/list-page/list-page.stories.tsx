import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  BotIcon,
  Code2Icon,
  CpuIcon,
  SparklesIcon,
  TerminalIcon,
  WandSparklesIcon,
  type LucideIcon,
} from 'lucide-react';
import { observer } from 'mobx-react-lite';
import * as React from 'react';
import { SearchInput, ToggleGroup } from '../../primitives';
import { createListView, createTextMatcher, defineFilter } from '../list-view';
import { PageLayout, type PageNavItem } from '../page-layout';
import { ListPage } from './index';

const meta: Meta = {
  title: 'Patterns/ListPage',
  parameters: { layout: 'fullscreen' },
};
export default meta;
type Story = StoryObj;

type AgentStatus = 'installed' | 'not-installed';

interface DemoAgent {
  id: string;
  name: string;
  description: string;
  status: AgentStatus;
  recommended: boolean;
  supportsChat: boolean;
  icon: LucideIcon;
}

const DEMO_AGENTS: DemoAgent[] = [
  {
    id: 'claude',
    name: 'Claude Code',
    description: 'Anthropic coding agent',
    status: 'installed',
    recommended: true,
    supportsChat: true,
    icon: SparklesIcon,
  },
  {
    id: 'codex',
    name: 'Codex',
    description: 'OpenAI coding agent',
    status: 'installed',
    recommended: true,
    supportsChat: true,
    icon: Code2Icon,
  },
  {
    id: 'pi',
    name: 'Pi',
    description: 'Minimal terminal coding agent',
    status: 'not-installed',
    recommended: true,
    supportsChat: false,
    icon: TerminalIcon,
  },
  {
    id: 'amp',
    name: 'Amp',
    description: 'Agentic coding environment',
    status: 'installed',
    recommended: false,
    supportsChat: true,
    icon: WandSparklesIcon,
  },
  {
    id: 'aider',
    name: 'Aider',
    description: 'Pair programming in your terminal',
    status: 'not-installed',
    recommended: false,
    supportsChat: false,
    icon: BotIcon,
  },
  {
    id: 'cursor-agent',
    name: 'Cursor Agent',
    description: 'Cursor command-line coding agent',
    status: 'installed',
    recommended: false,
    supportsChat: true,
    icon: CpuIcon,
  },
  {
    id: 'gemini',
    name: 'Gemini CLI',
    description: 'Google AI coding agent',
    status: 'not-installed',
    recommended: false,
    supportsChat: true,
    icon: SparklesIcon,
  },
  {
    id: 'goose',
    name: 'Goose',
    description: 'Open-source developer agent',
    status: 'not-installed',
    recommended: false,
    supportsChat: false,
    icon: BotIcon,
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    description: 'Open-source terminal coding agent',
    status: 'installed',
    recommended: false,
    supportsChat: true,
    icon: TerminalIcon,
  },
  {
    id: 'qwen',
    name: 'Qwen Code',
    description: 'Terminal agent powered by Qwen',
    status: 'not-installed',
    recommended: false,
    supportsChat: false,
    icon: Code2Icon,
  },
  {
    id: 'roo',
    name: 'Roo Code',
    description: 'Autonomous software development agent',
    status: 'not-installed',
    recommended: false,
    supportsChat: true,
    icon: WandSparklesIcon,
  },
  {
    id: 'sourcegraph',
    name: 'Sourcegraph Cody',
    description: 'AI assistant with codebase context',
    status: 'not-installed',
    recommended: false,
    supportsChat: false,
    icon: CpuIcon,
  },
];

type AgentFilterModel = {
  tab: 'all' | 'installed' | 'not-installed';
};

const agentView = createListView({
  getItemId: (agent: DemoAgent) => agent.id,
  source: { kind: 'sync', items: DEMO_AGENTS },
  search: {
    kind: 'sync',
    predicate: createTextMatcher((agent: DemoAgent) => [agent.name, agent.description]),
  },
  filter: defineFilter<DemoAgent, AgentFilterModel>({
    kind: 'sync',
    initial: { tab: 'all' },
    apply: (agent, filter) => filter.tab === 'all' || agent.status === filter.tab,
  }),
  sections: {
    by: (agent) => (agent.recommended ? 'Recommended' : 'All agents'),
    order: ['Recommended', 'All agents'],
    header: (key, count) => <ListPage.SectionHeader label={key} count={count} />,
  },
});

const NAV_ITEMS: PageNavItem[] = [
  { id: 'general', label: 'General', icon: 'settings' },
  { id: 'account', label: 'Account', icon: 'user' },
  { id: 'agents', label: 'Agents', icon: 'bot' },
  { id: 'integrations', label: 'Integrations', icon: 'plug' },
  { id: 'repository', label: 'Repository', icon: 'folder-git-2' },
];

function Badge({
  children,
  tone = 'neutral',
}: {
  children: React.ReactNode;
  tone?: 'neutral' | 'success';
}) {
  const color = tone === 'success' ? 'var(--em-status-success)' : 'var(--em-foreground-muted)';
  return (
    <span
      style={{
        border: `1px solid color-mix(in srgb, ${color} 35%, transparent)`,
        borderRadius: 'var(--em-radius-full)',
        padding: '0.125rem 0.375rem',
        color,
        fontSize: 'var(--em-text-xs)',
        lineHeight: 1,
      }}
    >
      {children}
    </span>
  );
}

function DemoAgentRow({ agent }: { agent: DemoAgent }) {
  const Icon = agent.icon;
  return (
    <ListPage.Row onClick={() => undefined}>
      <ListPage.RowIcon>
        <Icon style={{ width: 16, height: 16 }} />
      </ListPage.RowIcon>
      <ListPage.RowContent>
        <ListPage.RowTitle>{agent.name}</ListPage.RowTitle>
        <ListPage.RowDescription>{agent.description}</ListPage.RowDescription>
      </ListPage.RowContent>
      <ListPage.RowTrailing>
        {agent.supportsChat && <Badge>Chat</Badge>}
        <Badge tone={agent.status === 'installed' ? 'success' : 'neutral'}>
          {agent.status === 'installed' ? 'Installed' : 'Not installed'}
        </Badge>
      </ListPage.RowTrailing>
    </ListPage.Row>
  );
}

const AgentsToolbar = observer(function AgentsToolbar() {
  const filter = agentView.useFilter();
  const search = agentView.useSearch();

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '0.5rem',
      }}
    >
      <ToggleGroup.Root
        aria-label="Filter agents"
        value={[filter.model.tab]}
        onValueChange={(value) => {
          const tab = value[0] as AgentFilterModel['tab'] | undefined;
          if (tab) filter.set({ tab });
        }}
      >
        <ToggleGroup.Item value="all">All</ToggleGroup.Item>
        <ToggleGroup.Item value="installed">Installed</ToggleGroup.Item>
        <ToggleGroup.Item value="not-installed">Not installed</ToggleGroup.Item>
      </ToggleGroup.Root>
      <SearchInput
        size="sm"
        value={search.query}
        onChange={(event) => search.setQuery(event.target.value)}
        onClear={() => search.setQuery('')}
        placeholder="Search agents…"
        style={{ width: '14rem' }}
      />
    </div>
  );
});

function SettingsPageWithListDemo() {
  const [activeId, setActiveId] = React.useState('agents');

  return (
    <div style={{ height: '44rem', display: 'flex', flexDirection: 'column' }}>
      <agentView.Root>
        <PageLayout
          sidebar={
            <PageLayout.SidebarMenu
              items={NAV_ITEMS}
              activeId={activeId}
              onSelect={(item) => setActiveId(item.id)}
            />
          }
        >
          <PageLayout.Content>
            <PageLayout.Header
              sticky
              title="Agents"
              description="Manage agents and model configurations."
              actions={<AgentsToolbar />}
            />
            <ListPage>
              <ListPage.Body>
                <agentView.List
                  renderItem={(agent) => <DemoAgentRow agent={agent} />}
                  emptySlot={
                    <p
                      style={{
                        padding: '2rem',
                        color: 'var(--em-foreground-muted)',
                        fontSize: 'var(--em-text-sm)',
                        textAlign: 'center',
                      }}
                    >
                      No agents match your search.
                    </p>
                  }
                />
              </ListPage.Body>
            </ListPage>
          </PageLayout.Content>
        </PageLayout>
      </agentView.Root>
    </div>
  );
}

export const SettingsPageWithList: Story = {
  render: () => <SettingsPageWithListDemo />,
};

function StaticSectionsDemo() {
  const recommended = DEMO_AGENTS.filter((agent) => agent.recommended);
  const otherAgents = DEMO_AGENTS.filter((agent) => !agent.recommended).slice(0, 4);

  return (
    <div style={{ width: '36rem', padding: '1rem' }}>
      <ListPage>
        <ListPage.Body>
          <ListPage.Section>
            <ListPage.SectionHeader label="Recommended" count={recommended.length} />
            {recommended.map((agent) => (
              <DemoAgentRow key={agent.id} agent={agent} />
            ))}
          </ListPage.Section>
          <ListPage.Separator />
          <ListPage.Section>
            <ListPage.SectionHeader label="All agents" count={otherAgents.length} />
            {otherAgents.map((agent) => (
              <DemoAgentRow key={agent.id} agent={agent} />
            ))}
          </ListPage.Section>
        </ListPage.Body>
      </ListPage>
    </div>
  );
}

export const StaticSections: Story = {
  render: () => <StaticSectionsDemo />,
};

function SingleColumnDemo() {
  const [query, setQuery] = React.useState('');
  const agents = DEMO_AGENTS.filter((agent) =>
    agent.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())
  ).slice(0, 6);

  return (
    <div style={{ height: '40rem', display: 'flex', flexDirection: 'column' }}>
      <PageLayout>
        <PageLayout.Content>
          <PageLayout.Header
            sticky
            title="Agents"
            description="A ListPage also works without a sidebar."
            actions={
              <SearchInput
                size="sm"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onClear={() => setQuery('')}
                placeholder="Search agents…"
              />
            }
          />
          <ListPage>
            <ListPage.Section>
              <ListPage.SectionHeader label="Available agents" count={agents.length} />
              {agents.map((agent) => (
                <DemoAgentRow key={agent.id} agent={agent} />
              ))}
            </ListPage.Section>
          </ListPage>
        </PageLayout.Content>
      </PageLayout>
    </div>
  );
}

export const SingleColumn: Story = {
  render: () => <SingleColumnDemo />,
};
