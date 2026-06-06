import { Circle, CircleCheck, Github, Loader2, Plus, Trash2 } from 'lucide-react';
import { useToast } from '@renderer/lib/hooks/use-toast';
import {
  useGitHubAccounts,
  useRemoveGitHubAccount,
  useSetDefaultGitHubAccount,
} from '@renderer/lib/hooks/useGithubAccounts';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { Badge } from '@renderer/lib/ui/badge';
import { Button } from '@renderer/lib/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import type { GitHubAccountSummary, GitHubCredentialSource } from '@shared/github';

const GITHUB_SOURCE_LABELS: Record<GitHubCredentialSource, string> = {
  cli: 'GitHub CLI',
  emdash_oauth: 'OAuth',
  device_flow: 'Device flow',
  secure_storage: 'Saved token',
};

export function GitHubAccountsSection() {
  const { data: accounts = [], isLoading } = useGitHubAccounts();
  const sortedAccounts = [...accounts].sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
  const setDefaultMutation = useSetDefaultGitHubAccount();
  const removeMutation = useRemoveGitHubAccount();
  const showConnectGitHub = useShowModal('githubConnectModal');
  const showConfirmRemove = useShowModal('confirmActionModal');
  const { toast } = useToast();

  const setDefaultAccount = async (account: GitHubAccountSummary) => {
    const result = await setDefaultMutation.mutateAsync(account.accountId);
    if (!result.success) {
      toast({
        title: 'Unable to update default account',
        description: result.error,
        variant: 'destructive',
      });
      return;
    }
    toast({
      title: 'Default GitHub account updated',
      description: `New projects will use @${account.login} by default.`,
    });
  };

  const removeAccount = async (account: GitHubAccountSummary) => {
    const result = await removeMutation.mutateAsync(account.accountId);
    if (!result.success) {
      toast({
        title: 'Unable to remove GitHub account',
        description: result.error,
        variant: 'destructive',
      });
      return;
    }
    toast({
      title: 'GitHub account removed',
      description: `Removed @${account.login}.`,
    });
  };

  const confirmRemove = (account: GitHubAccountSummary) => {
    showConfirmRemove({
      title: `Remove @${account.login}?`,
      description: 'This removes the saved GitHub token from Emdash.',
      confirmLabel: 'Remove',
      onSuccess: () => void removeAccount(account),
    });
  };

  return (
    <section className="space-y-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">GitHub Accounts</p>
          <p className="text-muted-foreground text-xs">
            Accounts available for project pull requests and issues.
          </p>
        </div>
        <TooltipProvider delay={150}>
          <Tooltip>
            <TooltipTrigger>
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                onClick={() => showConnectGitHub({})}
                aria-label="Add GitHub account"
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">Add GitHub account</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      {isLoading ? (
        <div className="text-muted-foreground flex items-center gap-2 py-3 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading GitHub accounts...
        </div>
      ) : sortedAccounts.length === 0 ? (
        <div className="flex items-center gap-3 rounded-lg border border-dashed border-border/70 p-3">
          <div className="bg-muted/50 flex h-9 w-9 shrink-0 items-center justify-center rounded-md">
            <Github className="text-muted-foreground h-4 w-4" />
          </div>
          <p className="text-muted-foreground min-w-0 flex-1 text-sm">
            No GitHub accounts are connected.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {sortedAccounts.map((account) => (
            <GitHubAccountRow
              key={account.accountId}
              account={account}
              setDefaultPending={setDefaultMutation.isPending}
              removePending={removeMutation.isPending}
              onSetDefault={() => void setDefaultAccount(account)}
              onRemove={() => confirmRemove(account)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function GitHubAccountRow({
  account,
  setDefaultPending,
  removePending,
  onSetDefault,
  onRemove,
}: {
  account: GitHubAccountSummary;
  setDefaultPending: boolean;
  removePending: boolean;
  onSetDefault: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border/60 bg-background/60 p-3">
      {account.avatarUrl ? (
        <img
          src={account.avatarUrl}
          alt={account.login}
          className="h-9 w-9 shrink-0 rounded-full border border-border/60"
        />
      ) : (
        <div className="bg-muted flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border/60">
          <Github className="text-muted-foreground h-4 w-4" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <p className="truncate text-sm font-medium text-foreground">@{account.login}</p>
          {account.isDefault && <DefaultGitHubAccountBadge login={account.login} />}
          <Badge variant="outline">{GITHUB_SOURCE_LABELS[account.credentialSource]}</Badge>
        </div>
        <p className="text-muted-foreground truncate text-xs">{account.host}</p>
      </div>
      <TooltipProvider delay={150}>
        <Tooltip>
          <TooltipTrigger>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={setDefaultPending}
              onClick={account.isDefault ? undefined : onSetDefault}
              aria-label={
                account.isDefault
                  ? `@${account.login} is the default GitHub account`
                  : `Set @${account.login} as default GitHub account`
              }
            >
              {account.isDefault ? (
                <CircleCheck className="text-foreground" />
              ) : (
                <Circle className="text-foreground-muted" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">
            {account.isDefault ? 'Default account' : 'Set as default'}
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={removePending}
              onClick={onRemove}
              aria-label={`Remove @${account.login}`}
            >
              <Trash2 />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">Remove account</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}

function DefaultGitHubAccountBadge({ login }: { login: string }) {
  return (
    <TooltipProvider delay={150}>
      <Tooltip>
        <TooltipTrigger className="inline-flex h-4.5 items-center leading-none">
          <Badge variant="secondary">Default</Badge>
        </TooltipTrigger>
        <TooltipContent side="top">New projects will use @{login} by default.</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
