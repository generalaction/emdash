import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  BookOpenIcon,
  BotIcon,
  ExternalLinkIcon,
  GlobeIcon,
  PlusIcon,
  SettingsIcon,
  TerminalIcon,
  UserIcon,
  WrenchIcon,
  ZapIcon,
} from 'lucide-react';
import * as React from 'react';
import { Button } from '../../primitives/button';
import { SearchInput } from '../../primitives/search-input';
import { PageLayout } from './index';

const meta: Meta = {
  title: 'Patterns/PageLayout',
  parameters: { layout: 'fullscreen' },
};
export default meta;
type Story = StoryObj;

// ── Placeholder helpers ───────────────────────────────────────────────────────

function Card({ title, rows = 3 }: { title: string; rows?: number }) {
  return (
    <div
      style={{
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        padding: '1rem 1.25rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.75rem',
      }}
    >
      <div style={{ fontSize: 'var(--text-sm)', fontWeight: 500, color: 'var(--foreground)' }}>
        {title}
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          style={{
            height: '0.75rem',
            borderRadius: '999px',
            backgroundColor: 'var(--background-2)',
            width: `${65 + (i % 3) * 10}%`,
          }}
        />
      ))}
    </div>
  );
}

function PlaceholderList({ count = 5 }: { count?: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      {Array.from({ length: count }).map((_, i) => (
        <Card key={i} title={`Item ${i + 1}`} />
      ))}
    </div>
  );
}

// ── 1. Library style — sidebar + content (max-w-3xl) ─────────────────────────

const LIBRARY_ITEMS = [
  { id: 'prompts', label: 'Prompts', icon: <BookOpenIcon style={{ width: 14, height: 14 }} /> },
  { id: 'skills', label: 'Skills', icon: <WrenchIcon style={{ width: 14, height: 14 }} /> },
  { id: 'mcp', label: 'MCP', icon: <TerminalIcon style={{ width: 14, height: 14 }} /> },
];

function LibraryDemo() {
  const [tab, setTab] = React.useState('prompts');
  const [query, setQuery] = React.useState('');

  return (
    <div style={{ height: '40rem', display: 'flex', flexDirection: 'column' }}>
      <PageLayout
        sidebar={
          <PageLayout.SidebarMenu
            items={LIBRARY_ITEMS}
            activeId={tab}
            onSelect={(item) => setTab(item.id)}
          />
        }
      >
        <PageLayout.Content maxWidth="3xl">
          <PageLayout.Header
            title={LIBRARY_ITEMS.find((i) => i.id === tab)?.label ?? ''}
            description="Manage reusable prompts that can be sent from task prompt menus."
            sticky
            actions={
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
                <SearchInput
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onClear={() => setQuery('')}
                  placeholder="Search…"
                  style={{ flex: 1 }}
                />
                <Button size="sm">
                  <PlusIcon style={{ width: '0.875rem', height: '0.875rem' }} />
                  New Prompt
                </Button>
              </div>
            }
          />
          <div style={{ paddingTop: '1.5rem', paddingBottom: '2.5rem' }}>
            <PlaceholderList count={6} />
          </div>
        </PageLayout.Content>
      </PageLayout>
    </div>
  );
}

export const LibraryStyle: Story = {
  name: 'Library style — sidebar + content (max-w-3xl)',
  render: () => <LibraryDemo />,
};

// ── 2. Settings style — sidebar + content (default max-w-4xl) ────────────────

const SETTINGS_ITEMS = [
  { id: 'general', label: 'General', icon: <SettingsIcon style={{ width: 14, height: 14 }} /> },
  { id: 'account', label: 'Account', icon: <UserIcon style={{ width: 14, height: 14 }} /> },
  { id: 'agents', label: 'Agents', icon: <BotIcon style={{ width: 14, height: 14 }} /> },
  { id: 'integrations', label: 'Integrations', icon: <GlobeIcon style={{ width: 14, height: 14 }} /> },
  { id: 'connections', label: 'Connections', icon: <ZapIcon style={{ width: 14, height: 14 }} /> },
  { id: 'docs', label: 'Docs', icon: <ExternalLinkIcon style={{ width: 14, height: 14 }} />, isExternal: true },
];

function SettingsDemo() {
  const [tab, setTab] = React.useState('general');

  return (
    <div style={{ height: '40rem', display: 'flex', flexDirection: 'column', backgroundColor: 'var(--background)' }}>
      <PageLayout
        sidebar={
          <PageLayout.SidebarMenu
            items={SETTINGS_ITEMS}
            activeId={tab}
            onSelect={(item) => { if (!item.isExternal) setTab(item.id); }}
          />
        }
      >
        <PageLayout.Content>
          <div style={{ paddingBottom: '2.5rem', display: 'flex', flexDirection: 'column', gap: '2rem' }}>
            <PageLayout.Header
              title={SETTINGS_ITEMS.find((i) => i.id === tab)?.label ?? ''}
              description="Manage your account, privacy settings, notifications, and app updates."
              sticky
            />
            <Card title="Update settings" rows={4} />
            <Card title="Telemetry" rows={2} />
            <Card title="Auto-approve defaults" rows={3} />
            <Card title="Appearance" rows={2} />
          </div>
        </PageLayout.Content>
      </PageLayout>
    </div>
  );
}

export const SettingsStyle: Story = {
  name: 'Settings style — sidebar + content (max-w-4xl)',
  render: () => <SettingsDemo />,
};

// ── 3. Automations style — content-only, no sidebar ──────────────────────────

function AutomationsDemo() {
  const [query, setQuery] = React.useState('');

  return (
    <div style={{ height: '40rem', display: 'flex', flexDirection: 'column' }}>
      <PageLayout>
        <PageLayout.Content>
          <div style={{ paddingTop: '1.5rem', paddingBottom: '2.5rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            <PageLayout.Header
              title="Automations"
              description="Run agents on a schedule across your projects."
              actions={
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
                  <SearchInput
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onClear={() => setQuery('')}
                    placeholder="Search automations…"
                    style={{ flex: 1 }}
                  />
                  <Button size="sm" style={{ flexShrink: 0, whiteSpace: 'nowrap' }}>
                    <PlusIcon style={{ width: '0.875rem', height: '0.875rem' }} />
                    New Automation
                  </Button>
                </div>
              }
            />
            <PlaceholderList count={4} />
          </div>
        </PageLayout.Content>
      </PageLayout>
    </div>
  );
}

export const AutomationsStyle: Story = {
  name: 'Automations style — content-only',
  render: () => <AutomationsDemo />,
};

// ── 4. Custom sidebar — PageLayout.Sidebar bare slot ─────────────────────────

function CustomSidebarDemo() {
  const [selected, setSelected] = React.useState(0);
  const projects = ['emdash', 'api-gateway', 'frontend', 'docs-site'];

  return (
    <div style={{ height: '40rem', display: 'flex', flexDirection: 'column' }}>
      <PageLayout
        sidebar={
          <PageLayout.Sidebar>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <p style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--foreground-muted)', paddingLeft: '0.75rem', paddingBottom: '0.25rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Projects
              </p>
              {projects.map((name, i) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => setSelected(i)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    width: '100%',
                    border: 'none',
                    borderRadius: 'var(--radius-md)',
                    padding: '0.5rem 0.75rem',
                    fontSize: 'var(--text-sm)',
                    cursor: 'pointer',
                    backgroundColor: selected === i ? 'var(--background-2)' : 'transparent',
                    color: selected === i ? 'var(--foreground)' : 'var(--foreground-muted)',
                    textAlign: 'left',
                  }}
                >
                  <WrenchIcon style={{ width: 14, height: 14, flexShrink: 0 }} />
                  {name}
                </button>
              ))}
            </div>
          </PageLayout.Sidebar>
        }
      >
        <PageLayout.Content>
          <div style={{ paddingBottom: '2.5rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            <PageLayout.Header
              title={projects[selected] ?? ''}
              description="Custom sidebar demonstrating the bare PageLayout.Sidebar slot."
              sticky
            />
            <PlaceholderList count={3} />
          </div>
        </PageLayout.Content>
      </PageLayout>
    </div>
  );
}

export const CustomSidebar: Story = {
  name: 'Custom sidebar — PageLayout.Sidebar bare slot',
  render: () => <CustomSidebarDemo />,
};
