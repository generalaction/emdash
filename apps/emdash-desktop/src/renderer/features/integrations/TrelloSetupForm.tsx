import { useState } from 'react';
import { Input } from '@renderer/lib/ui/input';
import { SetupFormShell, type SetupFormProps } from './SetupFormShell';

function TrelloSetupForm({ onSuccess, onClose }: SetupFormProps) {
  const [apiKey, setApiKey] = useState('');
  const [token, setToken] = useState('');
  const [boardUrls, setBoardUrls] = useState('');

  return (
    <SetupFormShell
      providerId="trello"
      getInput={() => ({
        apiKey: apiKey.trim(),
        token: token.trim(),
        boardUrls: boardUrls.trim(),
      })}
      canSubmit={!!(apiKey.trim() && token.trim())}
      onSuccess={onSuccess}
      onClose={onClose}
    >
      <div className="grid gap-2">
        <Input
          placeholder="API key"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          className="h-9 w-full"
          autoFocus
        />
        <Input
          type="password"
          placeholder="API token"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          className="h-9 w-full"
        />
        <Input
          placeholder="Board URLs (optional, comma-separated)"
          value={boardUrls}
          onChange={(e) => setBoardUrls(e.target.value)}
          className="h-9 w-full"
        />
        <p className="text-muted-foreground text-xs">
          Create a Power-Up at <span className="font-medium">trello.com/power-ups/admin</span> to
          get an API key, then generate a token from the API key page. Add board URLs to choose
          exactly which boards Emdash searches; otherwise it checks the first 20 open boards.
        </p>
      </div>
    </SetupFormShell>
  );
}

export default TrelloSetupForm;
