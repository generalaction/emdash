import { CheckCircle, Loader2, WandSparkles } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { toast } from 'sonner';
import { getTaskGitWorktreeStore } from '@renderer/features/tasks/stores/task-selectors';
import {
  useTaskViewContext,
  useWorkspace,
  useWorkspaceId,
  useWorkspaceViewModel,
} from '@renderer/features/tasks/task-view-context';
import { rpc } from '@renderer/lib/ipc';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import { Input } from '@renderer/lib/ui/input';
import { SplitButton, type SplitButtonAction } from '@renderer/lib/ui/split-button';
import { Textarea } from '@renderer/lib/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { formatErrorType, formatPushErrorDetail } from '../../../utils';

type CommitPhase =
  | 'idle'
  | 'committing'
  | 'commit-only-done'
  | 'committed'
  | 'pushing'
  | 'pushed'
  | 'opening-pr';

interface CommitCardProps {
  autoStage?: boolean;
}

export const CommitCard = observer(function CommitCard({ autoStage = false }: CommitCardProps) {
  const { projectId, taskId } = useTaskViewContext();
  const workspaceId = useWorkspaceId();
  const taskView = useWorkspaceViewModel();
  const workspace = useWorkspace();
  const git = workspace.gitWorktree;
  const diffView = taskView.diffView;
  const changesView = diffView?.changesView ?? null;
  const hasPRs = changesView?.expandedSections.pullRequests ?? false;
  const [commitMessage, setCommitMessage] = useState('');
  const [description, setDescription] = useState('');
  const [phase, setPhase] = useState<CommitPhase>('idle');
  const [isGeneratingMessage, setIsGeneratingMessage] = useState(false);
  const fullMessage = description ? `${commitMessage}\n\n${description}` : commitMessage;
  const isInFlight = phase !== 'idle' || isGeneratingMessage;

  const showCreatePrModal = useShowModal('createPrModal');
  const repositoryUrl = workspace.gitRepository.pullRequestRepositoryUrl;

  if (!diffView || !changesView) return null;

  const branchName = getTaskGitWorktreeStore(projectId, taskId)?.branchName;
  const hasOpenPr = taskView.prStore?.pullRequests.some((p) => p.status === 'open') ?? false;
  const canCreatePr = Boolean(repositoryUrl) && Boolean(branchName) && !hasOpenPr;

  const stageAllIfNeeded = async (): Promise<boolean> => {
    if (!autoStage) return true;
    changesView.suppressNextAutoExpand('staged');
    const result = await git.stageAllFiles();
    if (!result.success) {
      toast.error(`Failed to stage changes: ${formatErrorType(result.error)} `);
      setPhase('idle');
      return false;
    }
    return true;
  };

  const generateCommitMessage = async () => {
    setIsGeneratingMessage(true);
    try {
      const result = await rpc.generation.generateCommitMessage({
        projectId,
        workspaceId,
        includeUnstaged: autoStage,
      });
      if (!result.success) {
        toast.error(result.error.message);
        return;
      }
      setCommitMessage(result.data.title);
      setDescription(result.data.body);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setIsGeneratingMessage(false);
    }
  };

  const doCommit = async () => {
    setPhase('committing');
    if (!(await stageAllIfNeeded())) return;
    const result = await git.commit(fullMessage);
    if (!result.success) {
      toast.error(`Failed to commit changes: ${formatErrorType(result.error)} `);
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
    if (!(await stageAllIfNeeded())) return;
    const commitResult = await git.commit(fullMessage);
    if (!commitResult.success) {
      toast.error(`Failed to commit changes: ${formatErrorType(commitResult.error)} `);
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
      toast.error(`Failed to push: ${formatPushErrorDetail(pushResult.error)}`);
      setPhase('idle');
      return;
    }
    setPhase('pushed');
    setTimeout(() => setPhase('idle'), 3000);
  };

  const doCommitAndCreatePr = async () => {
    setPhase('committing');
    if (!(await stageAllIfNeeded())) return;
    const commitResult = await git.commit(fullMessage);
    if (!commitResult.success) {
      toast.error(`Failed to commit changes: ${formatErrorType(commitResult.error)} `);
      setPhase('idle');
      return;
    }
    setCommitMessage('');
    setDescription('');
    if (!autoStage) {
      changesView.setExpanded({ unstaged: true, staged: false, pullRequests: hasPRs });
    }
    setPhase('opening-pr');
    await new Promise((r) => setTimeout(r, 500));
    setPhase('idle');
    showCreatePrModal({
      projectId,
      taskId,
      repositoryUrl: repositoryUrl ?? '',
      branchName: branchName ?? '',
      draft: false,
      workspaceId,
      onSuccess: () => {},
    });
  };

  const actions: SplitButtonAction[] = [
    { value: 'commit', label: 'Commit', action: () => void doCommit() },
    { value: 'commit-push', label: 'Commit & Push', action: () => void doCommitAndPush() },
    ...(canCreatePr
      ? [
          {
            value: 'commit-pr',
            label: 'Commit & Create PR',
            action: () => void doCommitAndCreatePr(),
          },
        ]
      : []),
  ];

  const effectiveAction =
    diffView.effectiveCommitAction === 'commit-pr' && !canCreatePr
      ? 'commit-push'
      : diffView.effectiveCommitAction;

  return (
    <div className="mx-2 mb-2 flex shrink-0 flex-col items-center justify-between gap-2 rounded-xl border border-border bg-background-1 p-2">
      <div className="flex w-full gap-1.5">
        <Input
          placeholder="Commit message"
          autoFocus
          className="min-w-0 flex-1 bg-background"
          value={commitMessage}
          onChange={(e) => setCommitMessage(e.target.value)}
          disabled={isInFlight}
        />
        <Tooltip>
          <TooltipTrigger>
            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => void generateCommitMessage()}
              disabled={isInFlight}
            >
              {isGeneratingMessage ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <WandSparkles className="size-3.5" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>Generate commit message</TooltipContent>
        </Tooltip>
      </div>
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
          disabled={isInFlight || !commitMessage.trim()}
          defaultValue={effectiveAction}
          onValueChange={(value) =>
            diffView.setCommitAction(value as 'commit' | 'commit-push' | 'commit-pr')
          }
        />
      )}
      {phase === 'committing' && (
        <StatusRow icon={<Loader2 className="size-4 animate-spin" />} label="Committing…" />
      )}
      {phase === 'opening-pr' && (
        <StatusRow icon={<Loader2 className="size-4 animate-spin" />} label="Opening PR…" />
      )}
      {(phase === 'commit-only-done' || phase === 'committed') && (
        <StatusRow
          icon={<CheckCircle className="size-4 text-foreground-success" />}
          label="Committed"
        />
      )}
      {phase === 'pushing' && (
        <StatusRow icon={<Loader2 className="size-4 animate-spin" />} label="Pushing…" />
      )}
      {phase === 'pushed' && (
        <StatusRow
          icon={<CheckCircle className="size-4 text-foreground-success" />}
          label="Pushed"
        />
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
