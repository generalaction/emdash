import React from 'react';
import { Input } from '../ui/input';
import jiraLogo from '../../../assets/images/jira.png';

type AuthType = 'basic' | 'bearer';

interface Props {
  site: string;
  email: string;
  token: string;
  authType: AuthType;
  onChange: (
    update: Partial<{ site: string; email: string; token: string; authType: AuthType }>
  ) => void;
  onSubmit: () => void | Promise<void>;
  onClose: () => void;
  canSubmit: boolean;
  error?: string | null;
  hideHeader?: boolean;
  hideFooter?: boolean;
}

const JiraSetupForm: React.FC<Props> = ({
  site,
  email,
  token,
  authType,
  onChange,
  onSubmit,
  onClose,
  canSubmit,
  error,
  hideHeader,
  hideFooter,
}) => {
  return (
    <div className="w-full">
      {!hideHeader && (
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-muted/40 px-2 py-0.5 text-xs font-medium">
            <img src={jiraLogo} alt="Jira" className="h-3.5 w-3.5" />
            Jira
          </span>
        </div>
      )}
      <div className={hideHeader ? 'grid gap-2' : 'mt-2 grid gap-2'}>
        {/* Auth type toggle */}
        <div className="flex overflow-hidden rounded-md border border-border/70 text-xs">
          <button
            type="button"
            className={`flex-1 px-3 py-1.5 font-medium transition-colors ${
              authType === 'basic'
                ? 'bg-foreground text-background'
                : 'bg-background text-muted-foreground hover:text-foreground'
            }`}
            onClick={() => onChange({ authType: 'basic' })}
          >
            API Token (Cloud)
          </button>
          <button
            type="button"
            className={`flex-1 border-l border-border/70 px-3 py-1.5 font-medium transition-colors ${
              authType === 'bearer'
                ? 'bg-foreground text-background'
                : 'bg-background text-muted-foreground hover:text-foreground'
            }`}
            onClick={() => onChange({ authType: 'bearer' })}
          >
            PAT (Server/DC)
          </button>
        </div>

        <Input
          placeholder="https://your-domain.atlassian.net"
          value={site}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange({ site: e.target.value })}
          className="h-9 w-full"
        />
        {authType === 'basic' && (
          <Input
            placeholder="Email"
            value={email}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              onChange({ email: e.target.value })
            }
            className="h-9 w-full"
          />
        )}
        <Input
          type="password"
          placeholder={authType === 'bearer' ? 'Personal Access Token' : 'API token'}
          value={token}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange({ token: e.target.value })}
          className="h-9 w-full"
        />
      </div>
      {authType === 'basic' ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Create an API token at{' '}
          <span className="font-medium">id.atlassian.com/manage-profile/security/api-tokens</span>
        </p>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">
          Create a PAT in your Jira profile under{' '}
          <span className="font-medium">Profile → Personal Access Tokens</span>
        </p>
      )}
      {error ? (
        <p className="mt-2 text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      {!hideFooter && (
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
      )}
    </div>
  );
};

export default JiraSetupForm;
