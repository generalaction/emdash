import { useState } from 'react';
import { Button } from '@renderer/components/ui/button';
import { Input } from '@renderer/components/ui/input';
import { Textarea } from '@renderer/components/ui/textarea';
import { useGitChangesContext } from '../state/git-changes-provider';

export function CommitCard() {
  const [commitMessage, setCommitMessage] = useState('');
  const [description, setDescription] = useState('');
  const { commitChanges } = useGitChangesContext();
  return (
    <div className="shrink-0 mx-2 mb-2 flex flex-col gap-2 items-center justify-between rounded-lg border border-border  p-2.5">
      <Input
        placeholder="Commit message"
        className="w-full"
        value={commitMessage}
        onChange={(e) => setCommitMessage(e.target.value)}
      />
      <Textarea
        placeholder="Description"
        className="w-full"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      <Button
        variant="default"
        size="sm"
        className="w-full"
        onClick={() => commitChanges(commitMessage + '\n\n' + description)}
      >
        Commit
      </Button>
    </div>
  );
}
