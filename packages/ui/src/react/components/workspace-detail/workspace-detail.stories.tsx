import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { WorkspaceDetailView } from './workspace-detail';

const meta: Meta<typeof WorkspaceDetailView> = {
  title: 'Components/WorkspaceDetailView',
  component: WorkspaceDetailView,
  parameters: { layout: 'padded' },
};
export default meta;
type Story = StoryObj<typeof WorkspaceDetailView>;

function RepositoryDemo() {
  const [action, setAction] = useState('No action yet.');

  return (
    <div style={{ width: '52rem', maxWidth: '100%' }}>
      <WorkspaceDetailView
        name="emdash"
        path="/Users/david/Documents/repos/emdash"
        kind="repository"
        status="active"
        branch="main"
        git={{ added: 21, removed: 21, ahead: 2, behind: 1 }}
        worktreeCount={4}
        linkedTaskCount={8}
        onBack={() => setAction('Back clicked.')}
        onDelete={() => setAction('Delete clicked.')}
        worktreesSlot="Worktrees placeholder content."
        tasksSlot="Tasks placeholder content."
      />
      <p
        style={{
          marginTop: '0.75rem',
          color: 'var(--em-foreground-muted)',
          fontSize: 'var(--em-text-xs)',
        }}
      >
        {action}
      </p>
    </div>
  );
}

export const Repository: Story = {
  render: () => <RepositoryDemo />,
};

export const Directory: Story = {
  render: () => (
    <div style={{ width: '52rem', maxWidth: '100%' }}>
      <WorkspaceDetailView
        name="Documents"
        path="/Users/david/Documents"
        kind="directory"
        status="idle"
        worktreeCount={0}
        linkedTaskCount={0}
        onBack={() => undefined}
        onDelete={() => undefined}
      />
    </div>
  ),
};
