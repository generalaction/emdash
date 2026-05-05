import type { ReactNode } from 'react';
import type { ProvisionStep } from '@shared/events/taskEvents';
import { SteppedLoadingScreen } from '@renderer/lib/ui/stepped-loading-screen';

export type BootstrapStep =
  | ProvisionStep
  | 'creating'
  | 'create-error'
  | 'provision-error'
  | 'teardown-error'
  | 'project-mounting'
  | 'idle'
  | 'teardown';

const BOOTSTRAP_STEPS: Record<BootstrapStep, { label: string }> = {
  creating: { label: 'Creating task…' },
  'project-mounting': { label: 'Opening project…' },
  idle: { label: 'Setting up workspace…' },
  teardown: { label: 'Tearing down…' },
  'resolving-worktree': { label: 'Resolving worktree…' },
  'initialising-workspace': { label: 'Initialising workspace…' },
  'running-provision-script': { label: 'Running provision script…' },
  'running-setup-script': { label: 'Running setup script…' },
  connecting: { label: 'Connecting…' },
  'setting-up-workspace': { label: 'Setting up workspace…' },
  'starting-sessions': { label: 'Starting sessions…' },
  'create-error': { label: 'Create failed' },
  'provision-error': { label: 'Provision failed' },
  'teardown-error': { label: 'Teardown failed' },
};

export interface TaskBootstrapViewProps {
  step: BootstrapStep;
  activeStepStatus?: 'pending' | 'error';
  children?: ReactNode;
  actions?: ReactNode;
}

export function TaskBootstrapView({
  step,
  activeStepStatus = 'pending',
  children,
  actions,
}: TaskBootstrapViewProps) {
  return (
    <SteppedLoadingScreen
      steps={BOOTSTRAP_STEPS}
      activeStep={step}
      activeStepStatus={activeStepStatus}
      actions={actions}
    >
      {children}
    </SteppedLoadingScreen>
  );
}
