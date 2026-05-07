import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';
import { TaskBootstrapView, type BootstrapStep } from './task-bootstrap-view';

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

const ERROR_STEPS = new Set<BootstrapStep>(['create-error', 'provision-error', 'teardown-error']);
const PTY_STEP: BootstrapStep = 'running-setup-script';

const meta: Meta = {
  title: 'Tasks/Bootstrap',
  parameters: { layout: 'fullscreen' },
};
export default meta;

function BootstrapCycler() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setIndex((i) => (i + 1) % BOOTSTRAP_STEPS.length);
    }, 5000);
    return () => clearInterval(id);
  }, []);

  const step = BOOTSTRAP_STEPS[index];
  const isError = ERROR_STEPS.has(step);
  const isPty = step === PTY_STEP;

  return (
    <TaskBootstrapView step={step} activeStepStatus={isError ? 'error' : 'pending'}>
      {isError ? (
        <p className="text-xs font-mono text-foreground-muted">
          Timed out while running the setup script.
        </p>
      ) : isPty ? (
        <div className="flex min-h-[200px] w-full items-center justify-center font-mono text-sm text-foreground-passive border rounded-md">
          PTY terminal
        </div>
      ) : undefined}
    </TaskBootstrapView>
  );
}

export const Default: StoryObj = {
  render: () => <BootstrapCycler />,
};
