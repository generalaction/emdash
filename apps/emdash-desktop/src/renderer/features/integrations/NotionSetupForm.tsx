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
          placeholder="Access token"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          className="h-9 w-full"
          autoFocus
        />
        <Input
          placeholder="Page, database, or data source URLs (optional)"
          value={databaseUrls}
          onChange={(e) => setDatabaseUrls(e.target.value)}
          className="h-9 w-full"
        />
        <p className="text-muted-foreground text-xs">
          Create a connection at <span className="font-medium">notion.com/my-integrations</span>,
          copy the access token, then share the target pages or databases with that connection. Add
          URLs to choose exactly which data sources Emdash searches; otherwise it searches all
          shared pages.
        </p>
      </div>
    </SetupFormShell>
  );
}

export default NotionSetupForm;
