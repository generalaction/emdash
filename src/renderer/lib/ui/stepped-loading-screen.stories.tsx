import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button } from './button';
import { SteppedLoadingScreen, type SteppedLoadingScreenProps } from './stepped-loading-screen';

const SAMPLE_STEPS: Record<string, { label: string }> = {
  'resolving-worktree': { label: 'Resolving worktree' },
  'initialising-workspace': { label: 'Initialising workspace' },
  'running-setup-script': { label: 'Running setup script' },
  connecting: { label: 'Connecting' },
  'starting-sessions': { label: 'Starting sessions' },
};

type StoryArgs = SteppedLoadingScreenProps<string> & { showChildren?: boolean };

const meta: Meta<StoryArgs> = {
  title: 'UI/SteppedLoadingScreen',
  component: SteppedLoadingScreen,
  parameters: { layout: 'fullscreen' },
  argTypes: {
    activeStep: {
      control: 'select',
      options: Object.keys(SAMPLE_STEPS),
      description: 'The step currently in progress (or that errored)',
    },
    children: { table: { disable: true } },
    steps: { table: { disable: true } },
  },
};
export default meta;

type Story = StoryObj<StoryArgs>;

export const Default: Story = {
  args: {
    steps: SAMPLE_STEPS,
    activeStep: 'initialising-workspace',
    className: 'min-w-md',
    activeStepStatus: 'pending',
    showChildren: true,
  },
  argTypes: {
    showChildren: {
      control: 'boolean',
      description: 'Toggle children visibility to preview the height animation',
    },
  },
  render: ({ showChildren, ...args }) => (
    <SteppedLoadingScreen
      {...args}
      actions={
        <Button variant="ghost" size="xs">
          Skip
        </Button>
      }
    >
      {showChildren ? (
        <div className=" p-4 w-full min-h-[200px] bg-red-200 flex items-center rounded-md justify-center text-foreground-passive">
          PTY
        </div>
      ) : undefined}
    </SteppedLoadingScreen>
  ),
};
