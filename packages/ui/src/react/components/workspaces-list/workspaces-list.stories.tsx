import type { Meta, StoryObj } from '@storybook/react-vite';
import * as React from 'react';
import { WorkspacesList, type WorkspacesListItem } from './workspaces-list';

const meta: Meta<typeof WorkspacesList> = {
  title: 'Components/WorkspacesList',
  component: WorkspacesList,
  parameters: { layout: 'padded' },
};
export default meta;
type Story = StoryObj<typeof WorkspacesList>;

const ITEMS: WorkspacesListItem[] = [
  {
    id: 'dir-documents',
    name: 'Documents',
    path: '/Users/david/Documents',
    kind: 'directory',
    status: 'idle',
    linkedTaskCount: 0,
    lastUsed: 'Today',
    activeTaskCount: 0,
  },
  {
    id: 'repo-emdash',
    name: 'emdash',
    path: '/Users/david/Documents/repos/emdash',
    kind: 'repository',
    status: 'active',
    worktreeCount: 4,
    linkedTaskCount: 25,
    lastUsed: 'Today',
    activeTaskCount: 4,
  },
  {
    id: 'repo-acme',
    name: 'acme',
    path: '/Users/david/Documents/repos/acme',
    kind: 'repository',
    status: 'setting-up',
    worktreeCount: 2,
    linkedTaskCount: 8,
    lastUsed: '2 days ago',
    activeTaskCount: 1,
  },
  {
    id: 'repo-sandbox',
    name: 'sandbox',
    path: '/srv/work/sandbox',
    kind: 'repository',
    status: 'tearing-down',
    worktreeCount: 1,
    linkedTaskCount: 2,
    lastUsed: '1 week ago',
    activeTaskCount: 0,
  },
];

function WorkspacesListDemo() {
  const [clickedId, setClickedId] = React.useState<string | null>(null);

  return (
    <div
      style={{
        width: '48rem',
        maxWidth: '100%',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.75rem',
      }}
    >
      <div style={{ height: '18rem' }}>
        <WorkspacesList items={ITEMS} onItemClick={(item) => setClickedId(item.id)} />
      </div>
      <p
        style={{
          margin: 0,
          color: 'var(--em-foreground-muted)',
          fontSize: 'var(--em-text-xs)',
        }}
      >
        {clickedId === null ? 'Click a row to open details.' : `Open details for: ${clickedId}`}
      </p>
    </div>
  );
}

export const Default: Story = {
  render: () => <WorkspacesListDemo />,
};

export const Empty: Story = {
  render: () => (
    <div style={{ width: '48rem', maxWidth: '100%', height: '12rem' }}>
      <WorkspacesList
        items={[]}
        emptySlot={
          <div
            style={{
              padding: '2rem',
              textAlign: 'center',
              color: 'var(--em-foreground-muted)',
              fontSize: 'var(--em-text-sm)',
            }}
          >
            No workspaces found.
          </div>
        }
      />
    </div>
  ),
};
