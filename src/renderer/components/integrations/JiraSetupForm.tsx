import React from 'react';
import { Input } from '../ui/input';
import { Info } from 'lucide-react';
import jiraLogo from '../../../assets/images/jira.png';

interface Props {
  site: string;
  email: string;
  token: string;
  onChange: (update: Partial<{ site: string; email: string; token: string }>) => void;
  onSubmit: () => void | Promise<void>;
  onClose: () => void;
  canSubmit: boolean;
  error?: string | null;
}

const JiraSetupForm: React.FC<Props> = ({
  site,
  email,
  token,
  onChange,
  onSubmit,
  onClose,
  canSubmit,
  error,
}) => {
  return (
    <div className="w-full">
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-muted/40 px-2 py-0.5 text-xs font-medium">
          <img src={jiraLogo} alt="Jira" className="h-3.5 w-3.5" />
          Jira
        </span>
      </div>
      <div className="mt-2 grid gap-2">
        <Input
          placeholder="https://your-domain.atlassian.net"
          value={site}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange({ site: e.target.value })}
          className="h-8 w-full"
        />
        <Input
          placeholder="Email"
          value={email}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange({ email: e.target.value })}
          className="h-8 w-full"
        />
        <Input
          type="password"
          placeholder="API token"
          value={token}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange({ token: e.target.value })}
          className="h-8 w-full"
        />
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        <Info className="mr-1 inline h-3 w-3" aria-hidden="true" />
        Create an API token at{' '}
        <span className="font-medium">id.atlassian.com/manage-profile/security/api-tokens</span>
      </p>
      {error ? (
        <p className="mt-2 text-xs text-red-600" role="alert">
          {error}
        </p>
      ) : null}
      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          className="inline-flex h-8 items-center justify-center rounded-md border border-border/70 bg-background px-2.5 text-xs font-medium"
          onClick={onClose}
        >
          Close
        </button>
        <button
          type="button"
          className="inline-flex h-8 items-center justify-center rounded-md border border-border/70 bg-background px-2.5 text-xs font-medium disabled:opacity-60"
          onClick={() => void onSubmit()}
          disabled={!canSubmit}
        >
          Connect
        </button>
      </div>
    </div>
  );
};

export default JiraSetupForm;
