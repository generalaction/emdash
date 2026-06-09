import { useState } from 'react';
import { Input } from '@renderer/lib/ui/input';
import { SetupFormShell, type SetupFormProps } from './SetupFormShell';

function ForgejoSetupForm({ onSuccess, onClose }: SetupFormProps) {
  const [instanceUrl, setInstanceUrl] = useState('');
  const [token, setToken] = useState('');

  return (
    <SetupFormShell
      providerId="forgejo"
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
          placeholder="https://forgejo.example.com"
          value={instanceUrl}
          onChange={(e) => setInstanceUrl(e.target.value)}
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
        <p className="text-muted-foreground text-xs">
          Create an API token in your Forgejo user settings under{' '}
          <span className="font-medium">Applications</span>.
        </p>
      </div>
    </SetupFormShell>
  );
}

export default ForgejoSetupForm;
