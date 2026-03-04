import { useEffect, useState } from 'react';
import { UserPlus, Loader2, CheckCircle2, XCircle, Clock } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { Spinner } from './ui/spinner';
import type { Reviewer, ReviewerState } from '../lib/reviewersStatus';

interface Props {
  taskPath: string;
  prState?: string; // 'OPEN' | 'MERGED' | 'CLOSED'
  reviewers: Reviewer[];
  isLoading: boolean;
  pendingLogins: Set<string>;
  onAdd: (login: string) => void;
  onRemove: (login: string) => void;
}

function ReviewStateBadge({ state }: { state: ReviewerState }) {
  switch (state) {
    case 'APPROVED':
      return (
        <span className="flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="h-3 w-3" />
          Approved
        </span>
      );
    case 'CHANGES_REQUESTED':
      return (
        <span className="flex items-center gap-1 rounded-full bg-red-500/10 px-2 py-0.5 text-[10px] font-medium text-red-600 dark:text-red-400">
          <XCircle className="h-3 w-3" />
          Changes requested
        </span>
      );
    case 'PENDING':
      return (
        <span className="flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
          <Clock className="h-3 w-3" />
          Requested
        </span>
      );
    default:
      return null;
  }
}

export function ReviewersSection({
  taskPath,
  prState,
  reviewers,
  isLoading,
  pendingLogins,
  onAdd,
  onRemove,
}: Props) {
  const [open, setOpen] = useState(false);
  const [collaborators, setCollaborators] = useState<Array<{ login: string; avatar_url?: string }>>(
    []
  );
  const [collabLoading, setCollabLoading] = useState(false);
  const [collabError, setCollabError] = useState(false);
  const [search, setSearch] = useState('');
  const [manualLogin, setManualLogin] = useState('');

  const isReadOnly = prState && prState !== 'OPEN';
  const requestedLogins = new Set(reviewers.map((r) => r.login));

  useEffect(() => {
    if (!open) return;
    setCollabLoading(true);
    setCollabError(false);
    window.electronAPI
      .getRepoCollaborators({ taskPath })
      .then((res) => {
        if (res.success && res.collaborators) {
          setCollaborators(res.collaborators);
        } else {
          setCollabError(true);
        }
      })
      .catch(() => setCollabError(true))
      .finally(() => setCollabLoading(false));
  }, [open, taskPath]);

  const filtered = search
    ? collaborators.filter((c) => c.login.toLowerCase().includes(search.toLowerCase()))
    : collaborators.slice(0, 4);

  const handleToggle = (login: string) => {
    if (requestedLogins.has(login)) {
      onRemove(login);
    } else {
      onAdd(login);
    }
  };

  const handleManualAdd = () => {
    const login = manualLogin.trim();
    if (!login) return;
    onAdd(login);
    setManualLogin('');
  };

  return (
    <div className="border-b border-border/50 px-4 py-2.5">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-foreground">Reviewers</span>
        {!isReadOnly && (
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <UserPlus className="h-3.5 w-3.5" />
                Add reviewer
              </button>
            </PopoverTrigger>
            <PopoverContent
              side="bottom"
              align="end"
              className="w-56 p-1"
              onOpenAutoFocus={(e) => e.preventDefault()}
            >
              {collabLoading ? (
                <div className="flex items-center justify-center py-4">
                  <Spinner size="sm" />
                </div>
              ) : collabError ? (
                <div className="p-2">
                  <p className="mb-1.5 text-xs text-muted-foreground">
                    Could not list collaborators. Enter reviewer&apos;s GitHub username:
                  </p>
                  <div className="flex gap-1.5">
                    <input
                      className="flex-1 rounded border border-border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                      placeholder="username"
                      value={manualLogin}
                      onChange={(e) => setManualLogin(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleManualAdd()}
                    />
                    <button
                      type="button"
                      className="rounded bg-primary px-2 py-1 text-xs text-primary-foreground"
                      onClick={handleManualAdd}
                    >
                      Add
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="px-2 py-1.5">
                    <input
                      className="w-full rounded border border-border bg-background px-2 py-1 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                      placeholder="Search reviewers..."
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </div>
                  <div className="max-h-40 overflow-y-auto">
                    {filtered.length === 0 ? (
                      <p className="px-2 py-2 text-xs text-muted-foreground">No results</p>
                    ) : (
                      filtered.map((c) => {
                        const selected = requestedLogins.has(c.login);
                        const isPending = pendingLogins.has(c.login);
                        return (
                          <button
                            key={c.login}
                            type="button"
                            disabled={isPending}
                            onClick={() => handleToggle(c.login)}
                            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted disabled:opacity-50"
                          >
                            {isPending ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                            ) : (
                              <span
                                className={`flex h-3.5 w-3.5 items-center justify-center rounded-sm border ${
                                  selected
                                    ? 'border-primary bg-primary'
                                    : 'border-muted-foreground/40'
                                }`}
                              >
                                {selected && (
                                  <svg
                                    viewBox="0 0 8 8"
                                    className="h-2.5 w-2.5 fill-primary-foreground"
                                  >
                                    <path
                                      d="M1 4l2 2 4-4"
                                      stroke="currentColor"
                                      strokeWidth="1.5"
                                      fill="none"
                                    />
                                  </svg>
                                )}
                              </span>
                            )}
                            <img
                              src={c.avatar_url || `https://github.com/${c.login}.png?size=40`}
                              alt=""
                              className="h-5 w-5 rounded-full"
                            />
                            <span className="truncate text-xs">{c.login}</span>
                          </button>
                        );
                      })
                    )}
                  </div>
                </>
              )}
            </PopoverContent>
          </Popover>
        )}
      </div>

      {isLoading && reviewers.length === 0 ? (
        <div className="mt-1.5 flex items-center gap-1.5">
          <Spinner size="sm" className="text-muted-foreground" />
          <span className="text-xs text-muted-foreground">Loading…</span>
        </div>
      ) : reviewers.length === 0 ? (
        <p className="mt-1 text-xs text-muted-foreground">No reviewers assigned</p>
      ) : (
        <div className="mt-1.5 flex flex-col gap-1.5">
          {reviewers.map((reviewer) => (
            <div key={reviewer.login} className="flex items-center gap-2">
              {pendingLogins.has(reviewer.login) ? (
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              ) : (
                <img
                  src={reviewer.avatarUrl || `https://github.com/${reviewer.login}.png?size=40`}
                  alt={reviewer.login}
                  className="h-5 w-5 rounded-full"
                />
              )}
              <span className="min-w-0 flex-1 truncate text-xs">{reviewer.login}</span>
              <ReviewStateBadge state={reviewer.state} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
