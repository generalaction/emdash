import { Github } from 'lucide-react';
import { Badge } from '@renderer/lib/ui/badge';
import { SelectItem } from '@renderer/lib/ui/select';
import type { GitHubAccountSummary, GitHubCredentialSource } from '@shared/github';

export const GITHUB_SOURCE_LABELS: Record<GitHubCredentialSource, string> = {
  cli: 'GitHub CLI',
  emdash_oauth: 'OAuth',
  device_flow: 'Device flow',
  secure_storage: 'Saved token',
};

export function GitHubAccountSelectItem({ account }: { account: GitHubAccountSummary }) {
  return (
    <SelectItem value={account.accountId} className="py-2">
      <GitHubAccountSelectLabel account={account} />
    </SelectItem>
  );
}

export function GitHubAccountSelectLabel({ account }: { account: GitHubAccountSummary }) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2 text-left">
      {account.avatarUrl ? (
        <img
          src={account.avatarUrl}
          alt={account.login}
          className="h-4 w-4 shrink-0 rounded-full"
        />
      ) : (
        <Github className="text-muted-foreground h-4 w-4 shrink-0" />
      )}
      <span className="min-w-0 truncate">@{account.login}</span>
      <span className="text-muted-foreground shrink-0 text-xs">{account.host}</span>
      {account.isDefault ? <GitHubDefaultAccountBadge /> : null}
    </div>
  );
}

export function GitHubDefaultAccountBadge() {
  return (
    <Badge
      variant="secondary"
      className="rounded-md border-border/40 bg-background-2 text-foreground"
    >
      Default
    </Badge>
  );
}

export function GitHubCredentialSourceBadge({ source }: { source: GitHubCredentialSource }) {
  return (
    <Badge
      variant="outline"
      className="rounded-md border-border/60 bg-transparent text-foreground-muted"
    >
      {GITHUB_SOURCE_LABELS[source]}
    </Badge>
  );
}
