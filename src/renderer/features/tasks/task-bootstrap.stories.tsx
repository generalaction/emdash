import type { Meta, StoryObj } from '@storybook/react-vite';
import { type BootstrapStep, TaskBootstrapView } from './task-bootstrap-view';

const BOOTSTRAP_STEPS: BootstrapStep[] = [
  'creating',
  'project-mounting',
  'resolving-worktree',
  'initialising-workspace',
  'running-provision-script',
  'running-setup-script',
  'connecting',
  'setting-up-workspace',
  'starting-sessions',
  'idle',
  'teardown',
  'create-error',
  'provision-error',
  'teardown-error',
];

const meta: Meta<typeof TaskBootstrapView> = {
  title: 'Tasks/Bootstrap',
  component: TaskBootstrapView,
  parameters: { layout: 'fullscreen' },
  argTypes: {
    step: {
      control: 'select',
      options: BOOTSTRAP_STEPS,
      description: 'Which bootstrap step to display',
    },
    message: {
      control: 'text',
      description: 'Progress message (overrides the step default)',
    },
    errorTitle: {
      control: 'text',
      description: 'Error heading (error steps only)',
    },
    errorDetail: {
      control: 'text',
      description: 'Error detail (error steps only)',
    },
    isSkipping: {
      control: 'boolean',
      description: 'Simulates the Skip button disabled state (running-setup-script without a real session)',
    },
    onSkip: { action: 'skip' },
    ptyView: { table: { disable: true } },
  },
};
export default meta;

export const Default: StoryObj<typeof TaskBootstrapView> = {
  args: {
    step: 'creating',
    errorTitle: 'Error creating task',
    errorDetail: 'Timed out while running the setup script.',
    isSkipping: false,
  },
};
