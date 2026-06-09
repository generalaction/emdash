import { useState } from 'react';
import { Input } from '@renderer/lib/ui/input';
import { SetupFormShell, type SetupFormProps } from './SetupFormShell';

function MondaySetupForm({ onSuccess, onClose }: SetupFormProps) {
  const [token, setToken] = useState('');
  const [boardUrls, setBoardUrls] = useState('');

  return (
    <SetupFormShell
      providerId="monday"
      getInput={() => ({
        token: token.trim(),
        boardUrls: boardUrls.trim(),
      })}
      canSubmit={!!token.trim()}
      onSuccess={onSuccess}
      onClose={onClose}
    >
      <div className="grid gap-2">
        <Input
          type="password"
          placeholder="API token"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          className="h-9 w-full"
          autoFocus
        />
        <Input
          placeholder="Board URLs (optional, comma-separated)"
          value={boardUrls}
          onChange={(e) => setBoardUrls(e.target.value)}
          className="h-9 w-full"
        />
        <p className="text-muted-foreground text-xs">
          Generate a token at{' '}
          <span className="font-medium">
            monday.com {'>'} Admin {'>'} API
          </span>
          . Add board URLs to choose exactly which boards Emdash searches; otherwise it checks the
          first 20 accessible boards.
        </p>
      </div>
    </SetupFormShell>
  );
}

export default MondaySetupForm;
