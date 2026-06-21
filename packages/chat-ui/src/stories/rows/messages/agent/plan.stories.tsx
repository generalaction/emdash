/**
 * Plan row stories — agent task list in each state.
 */

import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import type { ChatPlanEntry } from '../../../../model';
import { ChatHost, ChatHostExpanded } from '../../../_harness/chat-host';

const meta: Meta = {
  title: 'Rows/Messages/Agent/Plan',
  parameters: { layout: 'centered' },
};
export default meta;

type Story = StoryObj;

const ENTRIES_IN_PROGRESS: ChatPlanEntry[] = [
  { content: 'Analyze existing codebase structure', status: 'completed', priority: 'high' },
  { content: 'Extract duplicated utilities into shared modules', status: 'completed', priority: 'high' },
  { content: 'Refactor component directory layout', status: 'in_progress', priority: 'medium' },
  { content: 'Add Storybook stories for new layout', status: 'pending', priority: 'low' },
  { content: 'Run typecheck, lint, and tests', status: 'pending', priority: 'high' },
];

/** Collapsed plan — header only with progress badge. */
export const Collapsed: Story = {
  render: () => (
    <ChatHost
      items={[{ kind: 'plan', id: 'plan-1', entries: ENTRIES_IN_PROGRESS }]}
      height={80}
    />
  ),
};

/** Expanded plan — full task list with mixed statuses. */
export const Expanded: Story = {
  render: () => (
    <ChatHostExpanded
      expandId="plan-1"
      items={[{ kind: 'plan', id: 'plan-1', entries: ENTRIES_IN_PROGRESS }]}
      height={280}
    />
  ),
};

const ENTRIES_DONE: ChatPlanEntry[] = [
  { content: 'Analyze existing codebase structure', status: 'completed', priority: 'high' },
  { content: 'Extract duplicated utilities into shared modules', status: 'completed', priority: 'high' },
  { content: 'Refactor component directory layout', status: 'completed', priority: 'medium' },
  { content: 'Add Storybook stories for new layout', status: 'completed', priority: 'low' },
  { content: 'Run typecheck, lint, and tests', status: 'completed', priority: 'high' },
];

/** All tasks completed. */
export const AllDone: Story = {
  render: () => (
    <ChatHostExpanded
      expandId="plan-2"
      items={[{ kind: 'plan', id: 'plan-2', entries: ENTRIES_DONE }]}
      height={280}
    />
  ),
};

/** Single pending entry — minimal plan. */
export const SinglePending: Story = {
  render: () => (
    <ChatHost
      items={[
        {
          kind: 'plan',
          id: 'plan-3',
          entries: [{ content: 'Run the test suite', status: 'pending', priority: 'high' }],
        },
      ]}
      height={80}
    />
  ),
};
