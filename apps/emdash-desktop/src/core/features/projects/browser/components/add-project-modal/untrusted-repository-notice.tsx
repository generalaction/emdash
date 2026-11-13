import { safeDirectoryCommand, type GitDubiousOwnership } from '@emdash/core/primitives/git/api';
import type { Result } from '@emdash/shared';
import { Alert, Button } from '@emdash/ui/react/primitives';
import { useState, type ReactNode } from 'react';
import { CopyButton } from '@core/primitives/agents/browser/install-command-row';

export type TrustRepositoryConfirmation = {
  title: string;
  description: ReactNode;
  confirmLabel: string;
  variant: 'default';
};

/**
 * Explains Git's refusal to open a repository it does not consider owned by the user and offers
 * to add Git's own `safe.directory` suggestion, only after an explicit confirmation.
 */
export function UntrustedRepositoryNotice({
  dubiousOwnership,
  hostLabel,
  confirm,
  trust,
  onTrusted,
}: {
  dubiousOwnership: GitDubiousOwnership;
  /** Where Git runs: "this computer" or the machine's name. */
  hostLabel: string;
  confirm(confirmation: TrustRepositoryConfirmation): Promise<boolean>;
  trust(): Promise<Result<unknown, { message: string }>>;
  onTrusted(): Promise<unknown> | void;
}) {
  const [state, setState] = useState<
    { kind: 'idle' | 'trusting' } | { kind: 'failed'; message: string }
  >({ kind: 'idle' });
  const { command, requiresPowerShell } = safeDirectoryCommand(dubiousOwnership.safeDirectory);

  const handleTrust = async () => {
    const confirmed = await confirm({
      title: 'Trust this repository?',
      description: (
        <div className="flex flex-col gap-3">
          <p>Emdash will run this command on {hostLabel}:</p>
          <CommandBlock command={command} />
          <p className="text-foreground-muted">
            This changes your global Git config, so Git, agents, and your terminal will open this
            repository from now on. A repository's Git config can run programs, so only trust
            repositories you know.
          </p>
        </div>
      ),
      confirmLabel: 'Trust repository',
      variant: 'default',
    });
    if (!confirmed) return;

    setState({ kind: 'trusting' });
    try {
      const result = await trust();
      if (!result.success) {
        setState({ kind: 'failed', message: result.error.message });
        return;
      }
      await onTrusted();
      setState({ kind: 'idle' });
    } catch (error) {
      setState({ kind: 'failed', message: error instanceof Error ? error.message : String(error) });
    }
  };

  return (
    <Alert.Root status="warning">
      <Alert.Title>Git doesn&apos;t trust this repository</Alert.Title>
      <div className="flex flex-col gap-2 text-xs">
        <Alert.Description>
          Git won&apos;t open{' '}
          <span className="wrap-anywhere">{dubiousOwnership.repositoryPath}</span> because it
          can&apos;t confirm the folder belongs to the user running Git on {hostLabel}. This often
          happens with folders in WSL, on network shares, or on external drives. To trust it, run
          {requiresPowerShell ? ' this in PowerShell' : ''}:
        </Alert.Description>
        <CommandBlock command={command} />
        {state.kind === 'failed' && <p className="text-destructive">{state.message}</p>}
        <div>
          <Button
            variant="secondary"
            size="sm"
            disabled={state.kind === 'trusting'}
            onClick={() => void handleTrust()}
          >
            {state.kind === 'trusting' ? 'Trusting...' : 'Trust repository...'}
          </Button>
        </div>
      </div>
    </Alert.Root>
  );
}

function CommandBlock({ command }: { command: string }) {
  return (
    <div className="group flex items-start gap-2 rounded-md bg-background-quaternary-1 px-2 py-1.5">
      <code className="min-w-0 flex-1 font-mono text-xs wrap-break-word whitespace-pre-wrap text-foreground">
        {command}
      </code>
      <CopyButton command={command} />
    </div>
  );
}
