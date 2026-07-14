import type { Meta, StoryObj } from '@storybook/react-vite';
import * as React from 'react';
import { Button } from '../../primitives/button';
import { SteppedLoader, SteppedLoaderProgress, type StepStatus } from './stepped-loader';
import * as s from '@react/story-layout.css';

const BASE_STEPS = [
  { id: 'clone', name: 'Clone repository' },
  { id: 'install', name: 'Install dependencies' },
  { id: 'configure', name: 'Configure workspace' },
  { id: 'start', name: 'Start development server' },
];

const meta: Meta<typeof SteppedLoader> = {
  title: 'Components/SteppedLoader',
  component: SteppedLoader,
  parameters: { layout: 'centered' },
  args: {
    label: 'Setting up project',
    steps: BASE_STEPS,
    activeStepId: 'install',
    status: 'loading',
  },
  argTypes: {
    status: {
      control: 'select',
      options: ['pending', 'loading', 'success', 'error'],
    },
  },
};
export default meta;
type Story = StoryObj<typeof SteppedLoader>;

function retryCancelActions() {
  return (
    <>
      <Button size="sm" variant="primary">
        Retry
      </Button>
      <Button size="sm" variant="ghost" tone="destructive">
        Cancel
      </Button>
    </>
  );
}

export const Loading: Story = {
  args: {
    status: 'loading',
  },
  render: (args) => <SteppedLoader {...args} className={s.w96} />,
};

export const LoadingWithProgress: Story = {
  name: 'Loading with progress',
  args: {
    status: 'loading',
    steps: BASE_STEPS.map((step) =>
      step.id === 'install'
        ? {
            ...step,
            children: <SteppedLoaderProgress percent={42} aria-label="Install progress" />,
          }
        : step
    ),
  },
  render: (args) => <SteppedLoader {...args} className={s.w96} />,
};

export const Success: Story = {
  args: {
    status: 'success',
    steps: BASE_STEPS.map((step) =>
      step.id === 'install'
        ? {
            ...step,
            children: <SteppedLoaderProgress percent={100} aria-label="Install progress" />,
          }
        : step
    ),
  },
  render: (args) => <SteppedLoader {...args} className={s.w96} />,
};

export const ErrorState: Story = {
  name: 'Error',
  args: {
    status: 'error',
    actions: retryCancelActions(),
  },
  render: (args) => <SteppedLoader {...args} className={s.w96} />,
};

export const WithLabel: Story = {
  name: 'With label and actions',
  args: {
    label: 'Preparing workspace',
    status: 'loading',
    actions: retryCancelActions(),
  },
  render: (args) => <SteppedLoader {...args} className={s.w96} />,
};

const ALL_STATES: Array<{
  label: string;
  status: StepStatus;
  percent?: number;
  actions?: boolean;
}> = [
  { label: 'pending', status: 'pending' },
  { label: 'loading', status: 'loading' },
  { label: 'loading 42%', status: 'loading', percent: 42 },
  { label: 'success', status: 'success', percent: 100 },
  { label: 'error', status: 'error', actions: true },
];

export const AllStates: Story = {
  name: 'All states',
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', width: '28rem' }}>
      {ALL_STATES.map(({ label, status, percent, actions }) => (
        <div key={label}>
          <p
            style={{
              fontSize: 'var(--em-text-xs)',
              color: 'var(--em-foreground-muted)',
              marginBottom: '0.375rem',
              fontFamily: 'var(--em-font-mono)',
            }}
          >
            {label}
          </p>
          <SteppedLoader
            label="Setting up project"
            steps={BASE_STEPS.map((step) =>
              step.id === 'install' && percent != null
                ? {
                    ...step,
                    children: (
                      <SteppedLoaderProgress percent={percent} aria-label={`${label} progress`} />
                    ),
                  }
                : step
            )}
            activeStepId="install"
            status={status}
            actions={actions ? retryCancelActions() : undefined}
          />
        </div>
      ))}
    </div>
  ),
};

function InteractiveDemo() {
  const [activeIndex, setActiveIndex] = React.useState(0);
  const [status, setStatus] = React.useState<StepStatus>('loading');
  const [progress, setProgress] = React.useState(0);
  const [isRunning, setIsRunning] = React.useState(true);
  const isLastStep = activeIndex >= BASE_STEPS.length - 1;
  const activeStep = BASE_STEPS[activeIndex] ?? BASE_STEPS[0];
  const activeStepId = activeStep?.id ?? 'clone';

  React.useEffect(() => {
    if (!isRunning || status !== 'loading') {
      return;
    }

    if (progress >= 100) {
      setStatus('success');
      return;
    }

    const timer = window.setTimeout(() => {
      setProgress((current) => Math.min(100, current + 12));
    }, 250);

    return () => window.clearTimeout(timer);
  }, [isRunning, progress, status]);

  React.useEffect(() => {
    if (!isRunning || status !== 'success' || isLastStep) {
      return;
    }

    const timer = window.setTimeout(() => {
      setActiveIndex((current) => Math.min(BASE_STEPS.length - 1, current + 1));
      setProgress(0);
      setStatus('loading');
    }, 900);

    return () => window.clearTimeout(timer);
  }, [isLastStep, isRunning, status]);

  function retry() {
    setIsRunning(true);
    setProgress(0);
    setStatus('loading');
  }

  function cancel() {
    setIsRunning(false);
    setStatus('pending');
  }

  function triggerError() {
    setIsRunning(false);
    setStatus('error');
  }

  function reset() {
    setActiveIndex(0);
    setProgress(0);
    setStatus('loading');
    setIsRunning(true);
  }

  const steps = BASE_STEPS.map((step, index) => ({
    ...step,
    children:
      index <= activeIndex ? (
        <SteppedLoaderProgress
          percent={index < activeIndex ? 100 : progress}
          aria-label={`${step.name} progress`}
        />
      ) : undefined,
  }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', width: '28rem' }}>
      <SteppedLoader
        label="Interactive setup"
        steps={steps}
        activeStepId={activeStepId}
        status={status}
        actions={
          <>
            <Button size="sm" variant="primary" onClick={retry}>
              Retry
            </Button>
            <Button size="sm" variant="ghost" tone="warning" onClick={triggerError}>
              Error
            </Button>
            <Button size="sm" variant="ghost" tone="destructive" onClick={cancel}>
              Cancel
            </Button>
          </>
        }
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <Button size="sm" variant="ghost" onClick={reset}>
          Reset
        </Button>
        <span
          style={{
            fontSize: 'var(--em-text-xs)',
            color: 'var(--em-foreground-muted)',
            fontFamily: 'var(--em-font-mono)',
          }}
        >
          {activeIndex + 1} / {BASE_STEPS.length} - {status} - {progress}%
        </span>
      </div>
    </div>
  );
}

export const Interactive: Story = {
  name: 'Interactive walkthrough',
  render: () => <InteractiveDemo />,
};
