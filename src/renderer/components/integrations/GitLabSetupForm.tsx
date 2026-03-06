import React from 'react';
import { Input } from '../ui/input';
import { Info } from 'lucide-react';
import gitlabLogoSvg from '../../../assets/images/GitLab.svg?raw';
import AgentLogo from '../AgentLogo';

interface Props {
  instanceUrl: string;
  token: string;
  onChange: (update: Partial<{ instanceUrl: string; token: string }>) => void;
  onSubmit: () => void | Promise<void>;
  onClose: () => void;
  canSubmit: boolean;
  error?: string | null;
  hideHeader?: boolean;
  hideFooter?: boolean;
}

const GitLabSetupForm: React.FC<Props> = ({
  instanceUrl,
  token,
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
            <AgentLogo logo={gitlabLogoSvg} alt="GitLab" className="h-3.5 w-3.5" />
            GitLab setup
          </span>
          <span className="text-xs text-muted-foreground">
            Connect to GitLab with a personal access token.
          </span>
        </div>
      )}
      <div className={hideHeader ? 'grid gap-2' : 'mt-2 grid gap-2'}>
        <Input
          placeholder="https://gitlab.com"
          value={instanceUrl}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            onChange({ instanceUrl: e.target.value })
          }
          className="h-9 w-full"
        />
        <Input
          type="password"
          placeholder="Personal access token"
          value={token}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange({ token: e.target.value })}
          className="h-9 w-full"
        />
      </div>
      <div className="mt-2 rounded-md border border-dashed border-border/70 bg-muted/40 p-2">
        <div className="flex items-start gap-2">
          <Info className="mt-0.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <div className="text-xs leading-snug text-muted-foreground">
            <p className="font-medium text-foreground">Required token scope</p>
            <p className="mt-0.5">
              Create a personal access token with the <code className="font-mono">read_api</code>{' '}
              scope at <span className="font-medium">Settings → Access Tokens</span>.
            </p>
          </div>
        </div>
      </div>
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

export default GitLabSetupForm;
