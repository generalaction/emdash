import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  FolderGit2Icon,
  GitBranchIcon,
  MonitorIcon,
  ServerIcon,
  type LucideIcon,
} from 'lucide-react';
import * as React from 'react';
import { Button } from '../../primitives/button';
import { HierarchicalList, type HierarchicalListNode } from './hierarchical-list';
import * as s from '../../story-layout.css';

const meta: Meta = {
  title: 'Components/HierarchicalList',
  parameters: { layout: 'padded' },
};
export default meta;
type Story = StoryObj;

interface WorkspaceNodeData {
  label: string;
  description: string;
  kind: 'local-host' | 'ssh-host' | 'project' | 'workspace';
}

const WORKSPACE_TREE: HierarchicalListNode<WorkspaceNodeData>[] = [
  {
    id: 'host-local',
    data: {
      label: 'Local',
      description: 'Workspaces on this Mac',
      kind: 'local-host',
    },
    children: [
      {
        id: 'project-emdash',
        data: {
          label: 'emdash',
          description: '~/Documents/repos/emdash',
          kind: 'project',
        },
        children: [
          {
            id: 'workspace-emdash-main',
            data: {
              label: 'main',
              description: 'Primary checkout',
              kind: 'workspace',
            },
          },
          {
            id: 'workspace-emdash-settings',
            data: {
              label: 'feature/settings-redesign',
              description: 'Task worktree',
              kind: 'workspace',
            },
          },
        ],
      },
      {
        id: 'project-acme',
        data: {
          label: 'acme',
          description: '~/Documents/repos/acme',
          kind: 'project',
        },
        children: [
          {
            id: 'workspace-acme-api',
            data: {
              label: 'api',
              description: 'Backend service workspace',
              kind: 'workspace',
            },
          },
          {
            id: 'workspace-acme-web',
            data: {
              label: 'web',
              description: 'Frontend app workspace',
              kind: 'workspace',
            },
          },
        ],
      },
    ],
  },
  {
    id: 'host-remote',
    data: {
      label: 'Remote (SSH)',
      description: 'devbox.internal',
      kind: 'ssh-host',
    },
    children: [
      {
        id: 'project-sandbox',
        data: {
          label: 'sandbox',
          description: '/srv/work/sandbox',
          kind: 'project',
        },
        children: [
          {
            id: 'workspace-sandbox-experiment',
            data: {
              label: 'experiment',
              description: 'Remote task workspace',
              kind: 'workspace',
            },
          },
        ],
      },
    ],
  },
];

const ICONS: Record<WorkspaceNodeData['kind'], LucideIcon> = {
  'local-host': MonitorIcon,
  'ssh-host': ServerIcon,
  project: FolderGit2Icon,
  workspace: GitBranchIcon,
};

function renderWorkspaceNode(
  node: HierarchicalListNode<WorkspaceNodeData>,
  { depth }: { depth: number }
) {
  const Icon = ICONS[node.data.kind];

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: 0 }}>
      <Icon
        style={{
          width: '0.875rem',
          height: '0.875rem',
          flexShrink: 0,
          color: 'var(--em-foreground-muted)',
        }}
      />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div
          style={{
            fontSize: 'var(--em-text-sm)',
            fontWeight: depth === 0 ? 500 : 400,
            color: 'var(--em-foreground)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {node.data.label}
        </div>
        <div
          style={{
            marginTop: 1,
            fontSize: 'var(--em-text-xs)',
            color: 'var(--em-foreground-muted)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {node.data.description}
        </div>
      </div>
    </div>
  );
}

export const ThreeLevelHierarchy: Story = {
  name: '3-level workspace hierarchy',
  render: () => (
    <div className={s.w96} style={{ height: '24rem' }}>
      <HierarchicalList nodes={WORKSPACE_TREE} renderItem={renderWorkspaceNode} estimateSize={52} />
    </div>
  ),
};

function InteractiveSelectionDemo() {
  const [selectedIds, setSelectedIds] = React.useState<ReadonlySet<string>>(new Set());

  return (
    <div
      className={s.w96}
      style={{
        height: '28rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.75rem',
      }}
    >
      <p
        style={{
          margin: 0,
          fontSize: 'var(--em-text-xs)',
          color: 'var(--em-foreground-muted)',
        }}
      >
        Click to select, Shift-click for range, Alt-click to toggle.
      </p>
      <div style={{ minHeight: 0, flex: 1 }}>
        <HierarchicalList
          nodes={WORKSPACE_TREE}
          selectedIds={selectedIds}
          onSelectedIdsChange={setSelectedIds}
          renderItem={renderWorkspaceNode}
          estimateSize={52}
        />
      </div>
      <div
        style={{
          padding: '0.5rem 0.75rem',
          borderRadius: 'var(--em-radius-md)',
          border: '1px solid var(--em-border)',
          backgroundColor: 'var(--em-surface-overlay)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.75rem',
        }}
      >
        <span
          style={{
            minWidth: 0,
            flex: 1,
            color: 'var(--em-foreground)',
            fontSize: 'var(--em-text-sm)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {selectedIds.size > 0
            ? `${selectedIds.size} selected: ${Array.from(selectedIds).join(', ')}`
            : 'No rows selected'}
        </span>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => setSelectedIds(new Set())}
          disabled={selectedIds.size === 0}
        >
          Clear
        </Button>
      </div>
    </div>
  );
}

export const InteractiveSelection: Story = {
  name: 'Interactive selection',
  render: () => <InteractiveSelectionDemo />,
};
