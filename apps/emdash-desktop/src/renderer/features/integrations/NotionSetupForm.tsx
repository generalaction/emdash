import { useState } from 'react';
import { Input } from '@renderer/lib/ui/input';
import { SetupFormShell, type SetupFormProps } from './SetupFormShell';

function NotionSetupForm({ onSuccess, onClose }: SetupFormProps) {
  const [token, setToken] = useState('');
  const [databaseUrls, setDatabaseUrls] = useState('');

  return (
    <SetupFormShell
      providerId="notion"
      getInput={() => ({
        token: token.trim(),
        databaseUrls: databaseUrls.trim(),
      })}
      canSubmit={!!token.trim()}
      onSuccess={onSuccess}
      onClose={onClose}
    >
      <div className="grid gap-2">
        <Input
          type="password"
          placeholder="Internal integration token"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          className="h-9 w-full"
          autoFocus
        />
        <Input
          placeholder="Database URLs or IDs (optional, comma-separated)"
          value={databaseUrls}
          onChange={(e) => setDatabaseUrls(e.target.value)}
          className="h-9 w-full"
        />
        <p className="text-muted-foreground text-xs">
          Create an internal integration at{' '}
          <span className="font-medium">notion.so/my-integrations</span>, then share the target
          databases with that integration. Add database URLs to choose exactly which databases
          Emdash searches; otherwise it searches all shared pages.
        </p>
      </div>
    </SetupFormShell>
  );
}

export default NotionSetupForm;
