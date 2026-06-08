import React from 'react';
import { Input } from '@renderer/lib/ui/input';

interface Props {
  apiKey: string;
  token: string;
  boardUrls: string;
  onChange: (update: Partial<{ apiKey: string; token: string; boardUrls: string }>) => void;
  error?: string | null;
}

const TrelloSetupForm: React.FC<Props> = ({ apiKey, token, boardUrls, onChange, error }) => {
  return (
    <div className="grid gap-2">
      <Input
        placeholder="API key"
        value={apiKey}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange({ apiKey: e.target.value })}
        className="h-9 w-full"
        autoFocus
      />
      <Input
        type="password"
        placeholder="API token"
        value={token}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange({ token: e.target.value })}
        className="h-9 w-full"
      />
      <Input
        placeholder="Board URLs (optional, comma-separated)"
        value={boardUrls}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
          onChange({ boardUrls: e.target.value })
        }
        className="h-9 w-full"
      />
      <p className="text-muted-foreground text-xs">
        Create a Power-Up at <span className="font-medium">trello.com/power-ups/admin</span> to get
        an API key, then generate a token from the API key page. Add board URLs to choose exactly
        which boards Emdash searches; otherwise it checks the first 20 open boards.
      </p>
      {error ? (
        <p className="text-destructive text-xs" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
};

export default TrelloSetupForm;
