/**
 * Plan row stories — agent task list in each state.
 */

import type { Meta, StoryObj } from 'storybook-solidjs-vite';
import type { ChatPlanEntry } from '@/model';
import {
  ChatHost,
  ChatHostExpanded,
  ScriptedChat,
  type ScriptStep,
} from '@/stories/_harness/chat-host';
import { PlanStateMatrix } from '@/stories/_harness/state-matrix';
import { applyTurnEvent } from '@/stories/_harness/turn-reducer';

const meta: Meta = {
  title: 'Rows/Messages/Agent/Plan',
  parameters: { layout: 'centered' },
};
export default meta;

type Story = StoryObj;

const ENTRIES_IN_PROGRESS: ChatPlanEntry[] = [
  { content: 'Analyze existing codebase structure', status: 'completed', priority: 'high' },
  {
    content: 'Extract duplicated utilities into shared modules',
    status: 'completed',
    priority: 'high',
  },
  { content: 'Refactor component directory layout', status: 'in_progress', priority: 'medium' },
  { content: 'Add Storybook stories for new layout', status: 'pending', priority: 'low' },
  { content: 'Run typecheck, lint, and tests', status: 'pending', priority: 'high' },
];

/** Collapsed plan — header only with progress badge. */
export const Collapsed: Story = {
  render: () => (
    <ChatHost items={[{ kind: 'plan', id: 'plan-1', entries: ENTRIES_IN_PROGRESS }]} height={80} />
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
  {
    content: 'Extract duplicated utilities into shared modules',
    status: 'completed',
    priority: 'high',
  },
  { content: 'Refactor component directory layout', status: 'completed', priority: 'medium' },
  { content: 'Add Storybook stories for new layout', status: 'completed', priority: 'low' },
  { content: 'Run typecheck, lint, and tests', status: 'completed', priority: 'high' },
];

export const StateMatrix: Story = {
  render: () => (
    <PlanStateMatrix
      rowHeight={140}
      rows={[
        {
          label: 'Streaming',
          item: {
            kind: 'plan',
            id: 'plan-matrix-streaming',
            entries: ENTRIES_IN_PROGRESS,
            streaming: true,
          },
        },
        {
          label: 'In Progress',
          item: { kind: 'plan', id: 'plan-matrix-progress', entries: ENTRIES_IN_PROGRESS },
        },
        {
          label: 'All Done',
          item: { kind: 'plan', id: 'plan-matrix-done', entries: ENTRIES_DONE },
        },
        {
          label: 'Empty',
          item: { kind: 'plan', id: 'plan-matrix-empty', entries: [] },
        },
        {
          label: 'Single Pending',
          item: {
            kind: 'plan',
            id: 'plan-matrix-single',
            entries: [{ content: 'Run the test suite', status: 'pending', priority: 'high' }],
          },
        },
      ]}
    />
  ),
};

function planUpdateStep(
  id: string,
  entries: ChatPlanEntry[],
  streaming: boolean,
  waitMs: number
): ScriptStep[] {
  return [
    { kind: 'wait', ms: waitMs },
    {
      kind: 'call',
      fn: (api) => {
        const current = api.activeTurn.get();
        api.activeTurn.set(
          applyTurnEvent(current, { type: 'plan_update', id, entries, streaming }),
          'generating'
        );
      },
    },
  ];
}

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

const ENTRIES_FIT: ChatPlanEntry[] = [
  {
    content: 'Repository structure and central documentation reviewed',
    status: 'completed',
    priority: 'high',
  },
  {
    content: 'Architecture, apps, and packages summarized',
    status: 'in_progress',
    priority: 'medium',
  },
  {
    content: 'Development and operational requirements documented',
    status: 'pending',
    priority: 'medium',
  },
];

const ENTRIES_OVERFLOW: ChatPlanEntry[] = [
  ...ENTRIES_FIT,
  { content: 'Update automated tests', status: 'pending', priority: 'medium' },
  { content: 'Prepare the implementation handoff', status: 'pending', priority: 'medium' },
];

/** Compare a fully visible three-item plan with a five-item plan that continues below. */
export const FadeComparison: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: '24px' }}>
      <div>
        <p style={{ margin: '0 0 8px', 'font-weight': 600 }}>3 To-dos — no fade</p>
        <ChatHost
          width={600}
          height={180}
          items={[{ kind: 'plan', id: 'plan-fits-without-fade', entries: ENTRIES_FIT }]}
        />
      </div>
      <div>
        <p style={{ margin: '0 0 8px', 'font-weight': 600 }}>5 To-dos — overflow fade</p>
        <ChatHost
          width={600}
          height={180}
          items={[{ kind: 'plan', id: 'plan-overflows-with-fade', entries: ENTRIES_OVERFLOW }]}
        />
      </div>
    </div>
  ),
};

export const Streaming: Story = {
  render: () => (
    <ScriptedChat
      height={260}
      script={[
        {
          kind: 'call',
          fn: (api) => {
            api.activeTurn.set(
              applyTurnEvent(null, {
                type: 'message_chunk',
                id: 'u1',
                role: 'user',
                text: 'Create an implementation plan',
              }),
              'generating'
            );
          },
        },
        ...planUpdateStep('plan-stream', ENTRIES_IN_PROGRESS.slice(0, 1), true, 250),
        ...planUpdateStep('plan-stream', ENTRIES_IN_PROGRESS.slice(0, 3), true, 450),
        ...planUpdateStep('plan-stream', ENTRIES_IN_PROGRESS, true, 450),
        ...planUpdateStep('plan-stream', ENTRIES_DONE, false, 700),
        { kind: 'call', fn: (api) => api.activeTurn.commit('done') },
      ]}
    />
  ),
};
