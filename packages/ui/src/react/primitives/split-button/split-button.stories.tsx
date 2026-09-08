import { SplitButton } from '@react/primitives/split-button';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { sx } from '@styles/index';
import { GitMergeIcon } from 'lucide-react';
import * as React from 'react';
import type { ButtonVariant } from '../button';
import { Icon } from '../icon';
const buttonVariants: ButtonVariant[] = ['primary', 'destructive', 'secondary', 'ghost', 'link'];
const options = [
  { id: 'create', label: 'Create task' },
  { id: 'draft', label: 'Save as draft' },
  { id: 'schedule', label: 'Schedule later' },
];
const meta: Meta<typeof SplitButton> = {
  title: 'Primitives/SplitButton',
  component: SplitButton,
  parameters: { layout: 'centered' },
  argTypes: {
    variant: { control: 'select', options: buttonVariants },
    size: { control: 'select', options: ['base', 'sm'] },
    tone: { table: { disable: true } },
    disabled: { control: 'boolean' },
  },
  args: {
    options,
    selectedId: 'create',
    variant: 'primary',
    size: 'sm',
    onAction: () => undefined,
  },
};
export default meta;
type Story = StoryObj<typeof SplitButton>;
export const Default: Story = {};
export const Variants: Story = {
  render: () => (
    <div
      className={sx({
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: '2',
      })}
    >
      {buttonVariants.map((variant) => (
        <SplitButton
          key={variant}
          options={options}
          selectedId="create"
          variant={variant}
          onAction={() => undefined}
        />
      ))}
    </div>
  ),
};
export const WithIconAndDescriptions: Story = {
  render: () => (
    <SplitButton
      icon={<Icon source={GitMergeIcon} size="xs" />}
      options={[
        { id: 'push-create', label: 'Push & Create PR' },
        {
          id: 'create-only',
          label: 'Create PR',
          description: 'Skip push and open a PR from the current remote state',
        },
      ]}
      variant="secondary"
      onAction={() => undefined}
    />
  ),
};
export const Loading: Story = {
  render: () => (
    <div
      className={sx({
        display: 'flex',
        alignItems: 'center',
        gap: '2',
      })}
    >
      <SplitButton
        options={options}
        selectedId="create"
        loading
        loadingLabel="Creating…"
        onAction={() => undefined}
      />
      <SplitButton options={options} selectedId="create" loading onAction={() => undefined} />
    </div>
  ),
};
/**
 * Select-then-commit: picking a menu option only changes the pending selection;
 * the primary face commits it. Used for flows like choosing a merge strategy.
 */
export const SelectThenCommit: Story = {
  render: function SelectThenCommit() {
    const [selectedId, setSelectedId] = React.useState('merge');
    const [committed, setCommitted] = React.useState<string | null>(null);
    return (
      <div
        className={sx({
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '2',
        })}
      >
        <SplitButton
          options={[
            { id: 'merge', label: 'Merge', description: 'Create a merge commit' },
            { id: 'squash', label: 'Squash & merge', description: 'Squash into a single commit' },
            { id: 'rebase', label: 'Rebase & merge', description: 'Rebase onto the base branch' },
          ]}
          selectedId={selectedId}
          onSelectedChange={setSelectedId}
          commitOnSelect={false}
          onAction={setCommitted}
        />
        <span style={{ fontSize: 'var(--em-text-xs)', color: 'var(--em-foreground-muted)' }}>
          {committed ? `Committed: ${committed}` : 'Nothing committed yet'}
        </span>
      </div>
    );
  },
};
export const FullWidth: Story = {
  render: () => (
    <div style={{ width: '20rem' }}>
      <SplitButton
        options={options}
        selectedId="create"
        size="sm"
        fullWidth
        onAction={() => undefined}
      />
    </div>
  ),
};
