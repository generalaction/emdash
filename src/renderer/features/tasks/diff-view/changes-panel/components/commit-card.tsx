import { CheckCircle, Loader2 } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { useProvisionedTask } from '@renderer/features/tasks/task-view-context';
import { Input } from '@renderer/lib/ui/input';
import { SplitButton, type SplitButtonAction } from '@renderer/lib/ui/split-button';
import { Textarea } from '@renderer/lib/ui/textarea';

type CommitPhase = 'idle' | 'committing' | 'commit-only-done' | 'committed' | 'pushing' | 'pushed';

interface CommitCardProps {
  autoStage?: boolean;
}

export const CommitCard = observer(function CommitCard({ autoStage = false }: CommitCardProps) {
  const provisioned = useProvisionedTask();
  const git = provisioned.workspace.git;
  const changesView = provisioned.taskView.diffView.changesView;
  const hasPRs = changesView.expandedSections.pullRequests;
  const [commitMessage, setCommitMessage] = useState('');
  const [description, setDescription] = useState('');
  const [phase, setPhase] = useState<CommitPhase>('idle');
  const fullMessage = description ? `${commitMessage}\n\n${description}` : commitMessage;
  const isInFlight = phase !== 'idle';

  const doCommit = async () => {
    setPhase('committing');
    if (autoStage) {
      changesView.suppressNextAutoExpand('staged');
      await git.stageAllFiles();
    }
    const result = await git.commit(fullMessage);
    if (!result.success) {
      setPhase('idle');
      return;
    }
    setCommitMessage('');
    setDescription('');
    if (!autoStage) {
      changesView.setExpanded({ unstaged: true, staged: false, pullRequests: hasPRs });
    }
    setPhase('commit-only-done');
    setTimeout(() => setPhase('idle'), 3000);
  };

  const doCommitAndPush = async () => {
    setPhase('committing');
    if (autoStage) {
      changesView.suppressNextAutoExpand('staged');
      await git.stageAllFiles();
    }
    const commitResult = await git.commit(fullMessage);
    if (!commitResult.success) {
      setPhase('idle');
      return;
    }
    setCommitMessage('');
    setDescription('');
    if (!autoStage) {
      changesView.setExpanded({ unstaged: true, staged: false, pullRequests: hasPRs });
    }
    setPhase('committed');
    await new Promise((r) => setTimeout(r, 1000));
    setPhase('pushing');
    const pushResult = await git.push();
    if (!pushResult.success) {
      setPhase('idle');
      return;
    }
    setPhase('pushed');
    setTimeout(() => setPhase('idle'), 3000);
  };

  const actions: SplitButtonAction[] = [
    { value: 'commit', label: 'Commit', action: doCommit },
    { value: 'commit-push', label: 'Commit & Push', action: doCommitAndPush },
  ];

  const diffView = provisioned.taskView.diffView;

  return (
    <div className="shrink-0 mx-2 mb-2 flex flex-col gap-2 items-center justify-between rounded-xl border border-border bg-background-1 p-2">
      <Input
        placeholder="Commit message"
        autoFocus
        className="w-full bg-background"
        value={commitMessage}
        onChange={(e) => setCommitMessage(e.target.value)}
        disabled={isInFlight}
      />
      <Textarea
        placeholder="Description"
        className="w-full bg-background"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        disabled={isInFlight}
      />
      {phase === 'idle' && (
        <SplitButton
          actions={actions}
          size="sm"
          className="w-full"
          disabled={!commitMessage.trim()}
          defaultValue={diffView.effectiveCommitAction}
          onValueChange={(value) => diffView.setCommitAction(value as 'commit' | 'commit-push')}
        />
      )}
      {phase === 'committing' && (
        <StatusRow icon={<Loader2 className="size-4 animate-spin" />} label="Committing…" />
      )}
      {(phase === 'commit-only-done' || phase === 'committed') && (
        <StatusRow icon={<CheckCircle className="size-4 text-green-500" />} label="Committed" />
      )}
      {phase === 'pushing' && (
        <StatusRow icon={<Loader2 className="size-4 animate-spin" />} label="Pushing…" />
      )}
      {phase === 'pushed' && (
        <StatusRow icon={<CheckCircle className="size-4 text-green-500" />} label="Pushed" />
      )}
    </div>
  );
});

function StatusRow({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex w-full items-center justify-center gap-2 py-1 text-sm text-foreground-muted">
      {icon}
      <span>{label}</span>
    </div>
  );
}
