import { tokens } from '@emdash/theme';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { sx } from '@styles/index';
import { PlusIcon, RefreshCwIcon, WifiOffIcon } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../../primitives/button';
import { Icon } from '../../primitives/icon';
import { CollectionToolbar } from './collection-toolbar';

const meta = {
  title: 'Patterns/CollectionToolbar',
  component: CollectionToolbar,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof CollectionToolbar>;

export default meta;
type Story = StoryObj<typeof meta>;

const storyWidth = { width: 'min(52rem, calc(100vw - 4rem))' };

export const WithActions: Story = {
  args: {
    searchValue: '',
    onSearchValueChange: () => {},
    searchPlaceholder: 'Search skills…',
  },
  render: function WithActionsStory() {
    const [searchValue, setSearchValue] = useState('');

    return (
      <CollectionToolbar
        style={storyWidth}
        searchValue={searchValue}
        onSearchValueChange={setSearchValue}
        searchPlaceholder="Search skills…"
        actions={
          <>
            <Button variant="secondary" icon aria-label="Refresh skills">
              <Icon source={RefreshCwIcon} />
            </Button>
            <Button variant="primary">
              <Icon source={PlusIcon} />
              New Skill
            </Button>
          </>
        }
      />
    );
  },
};

export const WithMetadata: Story = {
  args: {
    searchValue: '',
    onSearchValueChange: () => {},
    searchPlaceholder: 'Search conversations, tasks, workspaces…',
  },
  render: function WithMetadataStory() {
    const [searchValue, setSearchValue] = useState('');

    return (
      <CollectionToolbar
        style={storyWidth}
        searchValue={searchValue}
        onSearchValueChange={setSearchValue}
        searchPlaceholder="Search conversations, tasks, workspaces…"
        metadata={
          <>
            <span>9 conversations</span>
            <span>
              <Icon source={WifiOffIcon} size="xs" />
              Offline
            </span>
          </>
        }
      />
    );
  },
};

export const SearchOnly: Story = {
  args: {
    searchValue: '',
    onSearchValueChange: () => {},
    searchPlaceholder: 'Search agents…',
  },
  render: function SearchOnlyStory() {
    const [searchValue, setSearchValue] = useState('');

    return (
      <CollectionToolbar
        style={storyWidth}
        searchValue={searchValue}
        onSearchValueChange={setSearchValue}
        searchPlaceholder="Search agents…"
      />
    );
  },
};

/** Caller-owned root padding uses `sx`; search disabled state remains semantic. */
export const DisabledSearchWithSxOverride: Story = {
  args: {
    searchValue: 'Unavailable while syncing',
    onSearchValueChange: () => {},
    searchPlaceholder: 'Search agents…',
  },
  render: (args) => (
    <div style={storyWidth}>
      <CollectionToolbar
        {...args}
        searchDisabled
        className={sx({ p: tokens.space.step2 })}
        metadata={<span>Syncing collection…</span>}
      />
    </div>
  ),
};
