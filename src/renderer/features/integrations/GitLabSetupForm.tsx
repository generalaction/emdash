import React from 'react';
import { Input } from '@renderer/lib/ui/input';

interface Props {
  instanceUrl: string;
  token: string;
  onChange: (update: Partial<{ instanceUrl: string; token: string }>) => void;
  error?: string | null;
}

const GitLabSetupForm: React.FC<Props> = ({ instanceUrl, token, onChange, error }) => {
  return (
    <div className="grid gap-2">
      <Input
        placeholder="https://gitlab.com"
        value={instanceUrl}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
          onChange({ instanceUrl: e.target.value })
        }
        className="h-9 w-full"
        autoFocus
      />
      <Input
        type="password"
        placeholder="Personal access token"
        value={token}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange({ token: e.target.value })}
        className="h-9 w-full"
      />
      <p className="text-xs text-muted-foreground">
        Create a personal access token with <span className="font-medium">read_api</span> scope in
        GitLab settings.
      </p>
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
};

export default GitLabSetupForm;
