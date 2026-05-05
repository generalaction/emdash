import type { ReactNode } from 'react';
import type { ProvisionStep } from '@shared/events/taskEvents';
import { BootstrapError, BootstrapPtyLayout, BootstrapSpinner } from './task-bootstrap';

export type BootstrapStep =
  | ProvisionStep
  | 'creating'
  | 'create-error'
  | 'provision-error'
  | 'teardown-error'
  | 'project-mounting'
  | 'idle'
  | 'teardown';

const STEP_MESSAGES: Record<BootstrapStep, string> = {
  'creating': 'Creating task…',
  'project-mounting': 'Opening project…',
  'idle': 'Setting up workspace…',
  'teardown': 'Setting up workspace…',
  'resolving-worktree': 'Resolving worktree…',
  'initialising-workspace': 'Initialising workspace…',
  'running-provision-script': 'Running provision script…',
  'running-setup-script': 'Running setup script…',
  'connecting': 'Connecting…',
  'setting-up-workspace': 'Setting up workspace…',
  'starting-sessions': 'Starting sessions…',
  'create-error': '',
  'provision-error': '',
  'teardown-error': '',
};

const ERROR_STEPS = new Set<BootstrapStep>([
  'create-error',
  'provision-error',
  'teardown-error',
]);

export interface TaskBootstrapViewProps {
  step: BootstrapStep;
  /** Overrides the default message derived from the step. */
  message?: string;
  /** Title shown for error steps. */
  errorTitle?: string;
  /** Optional detail shown below the error title. */
  errorDetail?: string;
  /**
   * Real PTY view for the 'running-setup-script' step.
   * When provided (production), rendered directly.
   * When omitted (Storybook / no session yet), falls back to the
   * BootstrapPtyLayout shell so the header and Skip button are still visible.
   */
  ptyView?: ReactNode;
  /** Controls the Skip button disabled state when ptyView is not provided. */
  isSkipping?: boolean;
  /** Called when the Skip button is clicked when ptyView is not provided. */
  onSkip?: () => void;
}

export function TaskBootstrapView({
  step,
  message,
  errorTitle = '',
  errorDetail,
  ptyView,
  isSkipping = false,
  onSkip = () => {},
}: TaskBootstrapViewProps) {
  const resolvedMessage = message ?? STEP_MESSAGES[step];

  if (ERROR_STEPS.has(step)) {
    return <BootstrapError title={errorTitle} detail={errorDetail} />;
  }

  if (step === 'running-setup-script') {
    // Production: render the provided connected PTY view.
    if (ptyView != null) return <>{ptyView}</>;
    // Storybook / no session yet: graceful degradation — show the layout shell.
    return (
      <BootstrapPtyLayout message={resolvedMessage} isSkipping={isSkipping} onSkip={onSkip} />
    );
  }

  return <BootstrapSpinner message={resolvedMessage} />;
}
