import { RefreshCw, Search } from 'lucide-react';
import { motion } from 'motion/react';
import { useDeferredValue, useMemo, useState } from 'react';
import type { PullRequest, PullRequestStatus } from '@shared/pull-requests';
import { Button } from '@renderer/components/ui/button';
import { Input } from '@renderer/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/components/ui/select';
import { useGithubContext } from '@renderer/core/github-context-provider';
import { usePullRequests } from '@renderer/hooks/usePullRequests';
import { useRequiredCurrentProject } from '@renderer/views/projects/project-view-wrapper';
import { parseGithubNameWithOwner } from '@renderer/views/tasks/diff-viewer/utils';
import { PrRow } from './pr-row';

type StatusFilter = PullRequestStatus | 'all';
type AddonFilter = 'mine' | 'assigned' | 'review' | 'draft';

const STATUS_OPTIONS: StatusFilter[] = ['open', 'closed', 'merged', 'all'];

const ADDON_FILTERS: Array<{ key: AddonFilter; label: string; statuses: StatusFilter[] }> = [
  { key: 'mine', label: 'My PRs', statuses: ['open', 'closed', 'merged', 'all'] },
  { key: 'assigned', label: 'Assigned to me', statuses: ['open', 'closed', 'merged', 'all'] },
  { key: 'review', label: 'Needs my review', statuses: ['open'] },
  { key: 'draft', label: 'Draft', statuses: ['open'] },
];

function textSearch(prs: PullRequest[], query: string) {
  if (!query.trim()) return prs;
  const lower = query.trim().toLowerCase();
  return prs.filter(
    (pr) =>
      pr.title.toLowerCase().includes(lower) ||
      pr.metadata.headRefName.toLowerCase().includes(lower) ||
      String(pr.metadata.number).includes(lower)
  );
}

export function PullRequestList() {
  const project = useRequiredCurrentProject();
  const { user } = useGithubContext();
  const projectRemote =
    project?.gitInfo?.remote ??
    ((project as unknown as Record<string, unknown> | null)?.gitRemote as string | undefined);
  const nameWithOwner = projectRemote ? parseGithubNameWithOwner(projectRemote) : null;

  const { prs, refresh } = usePullRequests(nameWithOwner ?? undefined);

  const [syncing, setSyncing] = useState(false);
  const [status, setStatus] = useState('Open');
  const [addon, setAddon] = useState<AddonFilter | null>(null);
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);

  const statusFilter = status.toLowerCase() as StatusFilter;

  const visibleAddons = useMemo(
    () => ADDON_FILTERS.filter((f) => f.statuses.includes(statusFilter)),
    [statusFilter]
  );

  const filteredPrs = useMemo(() => {
    let result = prs;

    if (statusFilter !== 'all') {
      result = result.filter((pr) => pr.status === statusFilter);
    }

    switch (addon) {
      case 'mine':
        result = result.filter((pr) => pr.author?.userName === user?.login);
        break;
      case 'assigned':
        result = result.filter((pr) => pr.metadata.assignees.some((a) => a.login === user?.login));
        break;
      case 'review':
        result = result.filter((pr) =>
          pr.metadata.reviewers.some(
            (r) => r.login === user?.login && (!r.state || r.state === 'PENDING')
          )
        );
        break;
      case 'draft':
        result = result.filter((pr) => pr.isDraft);
        break;
    }

    result = textSearch(result, deferredQuery);

    return result.toSorted(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  }, [prs, status, addon, deferredQuery, user?.login]);

  const handleRefresh = async () => {
    setSyncing(true);
    try {
      await refresh();
    } finally {
      setSyncing(false);
    }
  };

  const handleStatusChange = (value: string) => {
    setStatus(value);
    setAddon(null);
  };

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <div className="flex items-center gap-2 py-4 shrink-0">
        <Select value={status} onValueChange={handleStatusChange}>
          <SelectTrigger size="sm" className="w-auto">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((value) => {
              const label = value.charAt(0).toUpperCase() + value.slice(1);
              return (
                <SelectItem key={value} value={label}>
                  {label}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>

        {visibleAddons.map(({ key, label }) => (
          <Button
            key={key}
            variant={addon === key ? 'outline' : 'ghost'}
            size="sm"
            onClick={() => setAddon(addon === key ? null : key)}
          >
            {label}
          </Button>
        ))}
      </div>

      <div className="flex items-center gap-2 pb-4 shrink-0">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
          <Input
            className="pl-9"
            placeholder="Search by title, branch, or number..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={handleRefresh}
          disabled={syncing}
        >
          <motion.div
            animate={syncing ? { rotate: 360 } : {}}
            transition={syncing ? { repeat: Infinity, duration: 0.8, ease: 'linear' } : {}}
          >
            <RefreshCw className="size-4" />
          </motion.div>
        </Button>
      </div>

      <div className="space-y-2 overflow-y-auto min-h-0 flex-1" style={{ scrollbarWidth: 'none' }}>
        {filteredPrs.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            No PRs match this filter.
          </p>
        ) : (
          filteredPrs.map((pr) => <PrRow key={pr.metadata.number} pr={pr} />)
        )}
      </div>
    </div>
  );
}
