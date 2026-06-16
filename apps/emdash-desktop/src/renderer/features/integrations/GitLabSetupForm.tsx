import { useState } from 'react';
import { Input } from '@renderer/lib/ui/input';
import { SetupFormShell, type SetupFormProps } from './SetupFormShell';

function GitLabSetupForm({ onSuccess, onClose }: SetupFormProps) {
  const [instanceUrl, setInstanceUrl] = useState('');
  const [token, setToken] = useState('');

  return (
    <SetupFormShell
      providerId="gitlab"
      getInput={() => ({
        instanceUrl: instanceUrl.trim(),
        token: token.trim(),
      })}
      canSubmit={!!(instanceUrl.trim() && token.trim())}
      onSuccess={onSuccess}
      onClose={onClose}
    >
      <div className="grid gap-2">
        <Input
          placeholder="https://gitlab.com"
          value={instanceUrl}
          onChange={(e) => setInstanceUrl(e.target.value)}
          className="h-9 w-full"
          autoFocus
        />
        <Input
          type="password"
          placeholder="Personal access token"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          className="h-9 w-full"
        />
        <p className="text-muted-foreground text-xs">
          Create a personal access token with <span className="font-medium">read_api</span> scope in
          GitLab settings.
        </p>
      </div>
    </SetupFormShell>
  );
}

export default GitLabSetupForm;
