import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { useProvisionedTask } from '@renderer/features/tasks/task-view-context';
import { Input } from '@renderer/lib/ui/input';
import { SplitButton, type SplitButtonAction } from '@renderer/lib/ui/split-button';
import { Textarea } from '@renderer/lib/ui/textarea';

export const CommitCard = observer(function CommitCard() {
  const provisioned = useProvisionedTask();
  const git = provisioned.workspace.git;
  const changesView = provisioned.taskView.diffView.changesView;
  const hasPRs = changesView.expandedSections.pullRequests;
  const [commitMessage, setCommitMessage] = useState('');
  const [description, setDescription] = useState('');
  const fullMessage = description ? `${commitMessage}\n\n${description}` : commitMessage;
  const doCommit = () => {
    git.commit(fullMessage);
    changesView.setExpanded({ unstaged: true, staged: false, pullRequests: hasPRs });
    setCommitMessage('');
    setDescription('');
  };
  const doCommitAndPush = () => {
    git.commit(fullMessage).then(() => git.push());
    changesView.setExpanded({ unstaged: true, staged: false, pullRequests: hasPRs });
    setCommitMessage('');
    setDescription('');
  };
  const actions: SplitButtonAction[] = [
    { value: 'commit', label: 'Commit', action: doCommit },
    {
      value: 'commit-push',
      label: 'Commit & Push',
      action: doCommitAndPush,
    },
  ];
  const diffView = provisioned.taskView.diffView;
  return (
    <div className="shrink-0 mx-2 mb-2 flex flex-col gap-2 items-center justify-between rounded-lg border border-border bg-background-1 p-2">
      <Input
        placeholder="Commit message"
        autoFocus
        className="w-full bg-background"
        value={commitMessage}
        onChange={(e) => setCommitMessage(e.target.value)}
      />
      <Textarea
        placeholder="Description"
        className="w-full bg-background"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      <SplitButton
        actions={actions}
        size="sm"
        className="w-full"
        defaultValue={diffView.effectiveCommitAction}
        onValueChange={(value) => diffView.setCommitAction(value as 'commit' | 'commit-push')}
      />
    </div>
  );
});
