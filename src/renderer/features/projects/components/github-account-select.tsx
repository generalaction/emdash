import { Github } from 'lucide-react';
import { Badge } from '@renderer/lib/ui/badge';
import { SelectItem } from '@renderer/lib/ui/select';
import type { GitHubAccountSummary } from '@shared/github';

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
      {account.isDefault ? <Badge variant="secondary">Default</Badge> : null}
    </div>
  );
}
