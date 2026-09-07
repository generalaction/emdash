import type { Meta, StoryObj } from '@storybook/react-vite';
import { PlusIcon, RefreshCwIcon, WifiOffIcon } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../../primitives/button';
import { ToggleGroup } from '../../primitives/toggle';
import { SortSelect } from '../collection-view';
import { CollectionToolbar } from './collection-toolbar';

const meta = {
  title: 'Patterns/CollectionToolbar',
  component: CollectionToolbar.Root,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof CollectionToolbar.Root>;

export default meta;
type Story = StoryObj<typeof meta>;

const storyWidth = { width: 'min(52rem, calc(100vw - 4rem))' };

export const WithActions: Story = {
  render: function WithActionsStory() {
    const [searchValue, setSearchValue] = useState('');

    return (
      <CollectionToolbar.Root style={storyWidth}>
        <CollectionToolbar.Search
          value={searchValue}
          onValueChange={setSearchValue}
          placeholder="Search skills…"
        />
        <CollectionToolbar.Spacer />
        <CollectionToolbar.Group>
          <Button variant="secondary" icon aria-label="Refresh skills">
            <RefreshCwIcon />
          </Button>
          <Button variant="primary">
            <PlusIcon />
            New Skill
          </Button>
        </CollectionToolbar.Group>
      </CollectionToolbar.Root>
    );
  },
};

export const WithMetadata: Story = {
  render: function WithMetadataStory() {
    const [searchValue, setSearchValue] = useState('');

    return (
      <CollectionToolbar.Root style={storyWidth}>
        <CollectionToolbar.Search
          value={searchValue}
          onValueChange={setSearchValue}
          placeholder="Search conversations, tasks, workspaces…"
        />
        <CollectionToolbar.Spacer />
        <CollectionToolbar.Group>
          <span>9 conversations</span>
          <span>
            <WifiOffIcon aria-hidden size={12} />
            Offline
          </span>
        </CollectionToolbar.Group>
      </CollectionToolbar.Root>
    );
  },
};

export const SearchOnly: Story = {
  render: function SearchOnlyStory() {
    const [searchValue, setSearchValue] = useState('');

    return (
      <CollectionToolbar.Root style={storyWidth}>
        <CollectionToolbar.Search
          value={searchValue}
          onValueChange={setSearchValue}
          placeholder="Search agents…"
        />
      </CollectionToolbar.Root>
    );
  },
};

function TaskToolbarExample({ width = storyWidth.width }: { width?: string }) {
  const [tab, setTab] = useState<'active' | 'archived'>('active');
  const [sortKey, setSortKey] = useState<'updated' | 'name'>('updated');
  const [searchValue, setSearchValue] = useState('');

  return (
    <CollectionToolbar.Root style={{ width }}>
      <ToggleGroup.Root
        multiple={false}
        value={[tab]}
        aria-label="Task status"
        onValueChange={([value]) => value && setTab(value as 'active' | 'archived')}
      >
        <ToggleGroup.Item value="active">Active (8)</ToggleGroup.Item>
        <ToggleGroup.Item value="archived">Archived (3)</ToggleGroup.Item>
      </ToggleGroup.Root>
      <CollectionToolbar.Separator />
      <SortSelect
        sort={{
          key: sortKey,
          dir: 'asc',
          setKey: setSortKey,
          toggleDir: () => {},
          keys: {
            updated: { label: 'Recently updated' },
            name: { label: 'Name' },
          },
        }}
      />
      <CollectionToolbar.Spacer />
      <CollectionToolbar.Search
        value={searchValue}
        onValueChange={setSearchValue}
        placeholder="Search tasks…"
      />
      <Button variant="primary">Create Task</Button>
    </CollectionToolbar.Root>
  );
}

export const TaskControls: Story = {
  render: () => <TaskToolbarExample />,
};

export const ResponsiveWrap: Story = {
  render: () => <TaskToolbarExample width="20rem" />,
};
