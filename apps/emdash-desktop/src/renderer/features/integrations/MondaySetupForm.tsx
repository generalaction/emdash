import React from 'react';
import { Input } from '@renderer/lib/ui/input';

interface Props {
  token: string;
  boardUrls: string;
  onChange: (update: Partial<{ token: string; boardUrls: string }>) => void;
  error?: string | null;
}

const MondaySetupForm: React.FC<Props> = ({ token, boardUrls, onChange, error }) => {
  return (
    <div className="grid gap-2">
      <Input
        type="password"
        placeholder="API token"
        value={token}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange({ token: e.target.value })}
        className="h-9 w-full"
        autoFocus
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
        Generate a token at{' '}
        <span className="font-medium">
          monday.com {'>'} Admin {'>'} API
        </span>
        . Add board URLs to choose exactly which boards Emdash searches; otherwise it checks the
        first 20 accessible boards.
      </p>
      {error ? (
        <p className="text-destructive text-xs" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
};

export default MondaySetupForm;
