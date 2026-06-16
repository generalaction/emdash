import { useState } from 'react';
import { Input } from '@renderer/lib/ui/input';
import { SetupFormShell, type SetupFormProps } from './SetupFormShell';

function JiraSetupForm({ onSuccess, onClose }: SetupFormProps) {
  const [siteUrl, setSiteUrl] = useState('');
  const [email, setEmail] = useState('');
  const [token, setToken] = useState('');

  return (
    <SetupFormShell
      providerId="jira"
      getInput={() => ({
        siteUrl: siteUrl.trim(),
        email: email.trim(),
        token: token.trim(),
      })}
      canSubmit={!!(siteUrl.trim() && email.trim() && token.trim())}
      onSuccess={onSuccess}
      onClose={onClose}
    >
      <div className="grid gap-2">
        <Input
          placeholder="https://your-domain.atlassian.net"
          value={siteUrl}
          onChange={(e) => setSiteUrl(e.target.value)}
          className="h-9 w-full"
          autoFocus
        />
        <Input
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="h-9 w-full"
        />
        <Input
          type="password"
          placeholder="API token"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          className="h-9 w-full"
        />
        <p className="text-muted-foreground text-xs">
          Create an API token at{' '}
          <span className="font-medium">id.atlassian.com/manage-profile/security/api-tokens</span>
        </p>
      </div>
    </SetupFormShell>
  );
}

export default JiraSetupForm;
