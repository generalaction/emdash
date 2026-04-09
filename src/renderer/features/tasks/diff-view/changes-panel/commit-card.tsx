import { useState } from 'react';
import { Button } from '@renderer/lib/ui/button';
import { Input } from '@renderer/lib/ui/input';
import { Textarea } from '@renderer/lib/ui/textarea';

interface CommitCardProps {
  onCommit: (message: string) => void;
}

export function CommitCard({ onCommit }: CommitCardProps) {
  const [commitMessage, setCommitMessage] = useState('');
  const [description, setDescription] = useState('');

  const handleCommit = () => {
    onCommit(commitMessage + '\n\n' + description);
    setCommitMessage('');
    setDescription('');
  };

  return (
    <div className="shrink-0 mx-2 mb-2 flex flex-col gap-2 items-center justify-between rounded-lg border border-border bg-background-1  p-2">
      <Input
        placeholder="Commit message"
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
      <Button variant="default" size="sm" className="w-full" onClick={handleCommit}>
        Commit
      </Button>
    </div>
  );
}
