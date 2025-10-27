import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Separator } from './ui/separator';
import { X, DownloadCloud, RefreshCw, Search, Folder } from 'lucide-react';
import RepositoryList from './RepositoryList';
import { useGithubAuth } from '../hooks/useGithubAuth';
import { Spinner } from './ui/spinner';
import { Alert, AlertDescription, AlertTitle } from './ui/alert';
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

type Repository = {
  id: number;
  name: string;
  full_name: string;
  description: string | null;
  html_url: string;
  clone_url: string;
  ssh_url: string;
  default_branch: string;
  private: boolean;
  updated_at: string | null;
  language: string | null;
  stargazers_count: number;
  forks_count: number;
};

export const GithubImportModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  onImported: (localPath: string) => Promise<void> | void;
}> = ({ isOpen, onClose, onImported }) => {
  const shouldReduceMotion = useReducedMotion();
  const { authenticated, installed, user, checkStatus } = useGithubAuth();
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  type View = 'list' | 'cloning' | 'error';
  const [view, setView] = useState<View>('list');
  type SourceTab = 'repos' | 'url';
  const [tab, setTab] = useState<SourceTab>('repos');
  const [isCloning, setIsCloning] = useState(false);
  const [selectedRepo, setSelectedRepo] = useState<Repository | null>(null);
  const [cloningTarget, setCloningTarget] = useState<string | null>(null);
  const [cloneRoot, setCloneRoot] = useState<string>('');
  const [savedDefaultRoot, setSavedDefaultRoot] = useState<string>('');

  const [sortKey, setSortKey] = useState<'updated' | 'alpha' | 'stars'>('updated');
  const filtered = useMemo(() => {
    if (!search.trim()) return repositories;
    const q = search.trim().toLowerCase();
    const base = repositories.filter(
      (r) => r.name.toLowerCase().includes(q) || r.full_name.toLowerCase().includes(q)
    );
    const sorted = [...base];
    if (sortKey === 'updated') {
      sorted.sort(
        (a, b) => new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime()
      );
    } else if (sortKey === 'alpha') {
      sorted.sort((a, b) => a.full_name.localeCompare(b.full_name));
    } else if (sortKey === 'stars') {
      sorted.sort((a, b) => (b.stargazers_count || 0) - (a.stargazers_count || 0));
    }
    return sorted;
  }, [repositories, search, sortKey]);

  const fetchRepos = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const status = await checkStatus();
      if (!status?.authenticated) {
        setRepositories([]);
        setError('Connect GitHub CLI to list repositories.');
        return;
      }
      const repos = await window.electronAPI.githubGetRepositories();
      setRepositories(Array.isArray(repos) ? repos : []);
    } catch (e) {
      setError('Failed to load repositories.');
      setRepositories([]);
    } finally {
      setLoading(false);
    }
  }, [checkStatus]);

  useEffect(() => {
    if (isOpen) {
      void fetchRepos();
      (async () => {
        try {
          const res = await window.electronAPI.getSettings();
          const root = String(res?.settings?.repository?.cloneRoot || '').trim();
          if (root) {
            setCloneRoot(root);
            setSavedDefaultRoot(root);
            // reset default hint
          }
        } catch {}
      })();
    }
  }, [isOpen, fetchRepos]);

  useEffect(() => {
    if (!isOpen) {
      // Reset state when closing
      setView('list');
      setSelectedRepo(null);
      setCloningTarget(null);
      setError(null);
      setSearch('');
    }
  }, [isOpen]);

  const sanitizeJoin = (base: string, leaf: string) => {
    const head = String(base || '').replace(/[\\/]+$/, '');
    const tail = String(leaf || '').replace(/^[\\/]+/, '');
    return `${head}/${tail}`;
  };

  const uniqueClonePath = async (baseDir: string, repoName: string) => {
    // Try up to 3 variants to avoid collisions
    const candidates = [repoName, `${repoName}-1`, `${repoName}-2`, `${repoName}-${Date.now()}`];
    for (const leaf of candidates) {
      const candidate = sanitizeJoin(baseDir, leaf);
      // Best-effort: if folder exists with .git, cloning will short-circuit to success per IPC
      // So we can just return the first candidate; otherwise try progressively on clone failure.
      return { candidate, tried: candidates };
    }
    return { candidate: sanitizeJoin(baseDir, repoName), tried: [repoName] };
  };

  const [repoUrl, setRepoUrl] = useState<string>('');
  const isValidRepoUrl = (input: string) => {
    const trimmed = input.trim();
    if (!trimmed) return false;
    if (/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(\.git)?$/i.test(trimmed)) return true;
    if (/^git@github\.com:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(\.git)?$/i.test(trimmed)) return true;
    if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(trimmed)) return true;
    return false;
  };
  const normalizeToHttps = (input: string) => {
    const t = input.trim();
    if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(t)) return `https://github.com/${t}.git`;
    if (/^git@github\.com:/.test(t)) {
      const rest = t.replace(/^git@github\.com:/, '').replace(/\.git$/i, '');
      return `https://github.com/${rest}.git`;
    }
    if (/^https:\/\//i.test(t)) return t.endsWith('.git') ? t : `${t}.git`;
    return t;
  };

  const handleImportRepository = useCallback(
    async (repo: Repository) => {
      if (!installed || !authenticated) {
        setError('GitHub CLI not ready. Please connect in Settings.');
        return;
      }
      setSelectedRepo(repo);
      setView('cloning');
      setIsCloning(true);
      try {
        const root = String(cloneRoot || '').trim();
        if (!root) {
          setError('Invalid clone root. Set it in Settings > Repository.');
          setView('error');
          return;
        }

        const repoName = repo.name;
        const { candidate, tried } = await uniqueClonePath(root, repoName);

        const tryTargets = tried.map((leaf) => sanitizeJoin(root, leaf));
        let successPath: string | null = null;
        for (const target of tryTargets) {
          const url = repo.clone_url; // default to HTTPS per requirement
          setCloningTarget(target);
          const result = await window.electronAPI.githubCloneRepository(url, target);
          if (result?.success) {
            successPath = target;
            break;
          }
        }

        if (!successPath) {
          setError('Clone failed. Choose another clone root or try again.');
          setView('error');
          return;
        }

        await onImported(successPath);
        onClose();
      } catch (e) {
        setError('Import failed. See console for details.');
        setView('error');
        // eslint-disable-next-line no-console
        console.error(e);
      } finally {
        setIsCloning(false);
      }
    },
    [authenticated, installed, onImported, onClose]
  );

  const handleImportByUrl = useCallback(async () => {
    if (!installed || !authenticated) {
      setError('GitHub CLI not ready. Please connect in Settings.');
      return;
    }
    const url = normalizeToHttps(repoUrl);
    if (!isValidRepoUrl(url)) {
      setError('Please enter a valid GitHub repository URL or owner/name.');
      return;
    }
    const ownerName = url.match(/github\.com\/([^\/]+)\/([^\/]+)\.git/i);
    const name = ownerName?.[2] || 'repo';
    setSelectedRepo({
      id: Date.now(),
      name,
      full_name: ownerName ? `${ownerName[1]}/${ownerName[2]}` : name,
      description: null,
      html_url: url.replace(/\.git$/i, ''),
      clone_url: url,
      ssh_url: '',
      default_branch: 'main',
      private: false,
      updated_at: null,
      language: null,
      stargazers_count: 0,
      forks_count: 0,
    });
    setView('cloning');
    setIsCloning(true);
    try {
      const root = String(cloneRoot || '').trim();
      if (!root) throw new Error('Invalid clone root. Set it in Settings > Repository.');
      const { tried } = await uniqueClonePath(root, name);
      const tryTargets = tried.map((leaf) => `${root.replace(/[\\/]+$/, '')}/${leaf}`);
      let successPath: string | null = null;
      for (const target of tryTargets) {
        setCloningTarget(target);
        const result = await window.electronAPI.githubCloneRepository(url, target);
        if (result?.success) {
          successPath = target;
          break;
        }
      }
      if (!successPath) throw new Error('Clone failed. Choose another clone root or try again.');
      await onImported(successPath);
      onClose();
    } catch (e: any) {
      setError(e?.message || 'Import failed.');
      setView('error');
    } finally {
      setIsCloning(false);
    }
  }, [authenticated, installed, repoUrl, cloneRoot, onImported, onClose]);

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-[130] flex items-center justify-center bg-black/60 backdrop-blur-sm"
          initial={shouldReduceMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={shouldReduceMotion ? { opacity: 1 } : { opacity: 0 }}
          transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.12, ease: 'easeOut' }}
          onClick={onClose}
        >
          <motion.div
            onClick={(event) => event.stopPropagation()}
            initial={shouldReduceMotion ? false : { opacity: 0, y: 8, scale: 0.995 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={shouldReduceMotion ? { opacity: 1 } : { opacity: 0, y: 6, scale: 0.995 }}
            transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="mx-4 w-full max-w-2xl overflow-hidden rounded-2xl border border-border/50 bg-background shadow-2xl"
          >
            <header className="flex items-center justify-between border-b border-border/60 px-5 py-3">
              <div className="flex min-w-0 flex-col">
                <div className="flex items-center gap-2">
                  <DownloadCloud className="h-4 w-4" />
                  <h2 className="truncate text-base font-semibold">Open from GitHub</h2>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Select a repository to clone and open in emdash.
                </p>
              </div>
              {installed && authenticated && (user?.login || user?.name) ? (
                <div className="hidden items-center gap-2 text-xs text-muted-foreground sm:flex">
                  <div className="h-5 w-5 overflow-hidden rounded-full bg-muted" />
                  <span className="truncate">{user?.login || user?.name}</span>
                </div>
              ) : null}
              <Button type="button" variant="ghost" size="icon" onClick={onClose} aria-label="Close">
                <X className="h-4 w-4" />
              </Button>
            </header>

            <div className="flex flex-col gap-3 p-5 pb-20">
              {view === 'list' && (
                <>
                  <div className="inline-flex w-full items-center gap-2 rounded-md border border-border/60 bg-muted/20 p-1">
                    <button
                      type="button"
                      onClick={() => setTab('repos')}
                      className={`flex-1 rounded-md px-3 py-1.5 text-sm transition ${tab === 'repos' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                    >
                      Your Repositories
                    </button>
                    <button
                      type="button"
                      onClick={() => setTab('url')}
                      className={`flex-1 rounded-md px-3 py-1.5 text-sm transition ${tab === 'url' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                    >
                      By URL
                    </button>
                  </div>
                  {tab === 'repos' && (
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        placeholder="Search repositories…"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="pl-8"
                        aria-label="Search repositories"
                      />
                    </div>
                    <Select value={sortKey} onValueChange={(v) => setSortKey(v as any)}>
                      <SelectTrigger className="w-[170px]"><SelectValue placeholder="Sort by" /></SelectTrigger>
                      <SelectContent align="end">
                        <SelectItem value="updated">Recently updated</SelectItem>
                        <SelectItem value="alpha">Alphabetical</SelectItem>
                        <SelectItem value="stars">Stars</SelectItem>
                      </SelectContent>
                    </Select>
                    <TooltipProvider delayDuration={250}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            onClick={fetchRepos}
                            aria-label="Refresh"
                            disabled={loading}
                          >
                            {loading ? <Spinner size="sm" /> : <RefreshCw className="h-4 w-4" />}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Refresh list</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                  <Separator />
                  {!installed ? (
                    <Alert>
                      <AlertTitle>GitHub CLI not installed</AlertTitle>
                      <AlertDescription>
                        Install GitHub CLI (gh) to enable listing and importing repositories.
                      </AlertDescription>
                    </Alert>
                  ) : !authenticated ? (
                    <Alert>
                      <AlertTitle>Not authenticated</AlertTitle>
                      <AlertDescription>Run “gh auth login” in your terminal and try again.</AlertDescription>
                    </Alert>
                  ) : null}
                  {error ? (
                    <Alert variant="destructive">
                      <AlertTitle>Couldn’t load repositories</AlertTitle>
                      <AlertDescription>{error}</AlertDescription>
                    </Alert>
                  ) : null}

                  <div className="min-h-40 max-h-96 overflow-y-auto rounded-md">
                    <RepositoryList
                      repositories={filtered}
                      onOpenRepository={(repo) => handleImportRepository(repo as any)}
                      onImportRepository={(repo) => handleImportRepository(repo as any)}
                    />
                    {Array.isArray(filtered) && filtered.length === 0 && !loading && installed && authenticated ? (
                      <div className="py-12 text-center text-sm text-muted-foreground">
                        {search.trim() ? 'No repositories match your search.' : 'No repositories found.'}
                      </div>
                    ) : null}
                  </div>
                  )}
                  {tab === 'url' && (
                    <div className="flex flex-col gap-3">
                      <div>
                        <label className="mb-1 block text-xs text-muted-foreground">Repository URL or owner/name</label>
                        <Input
                          placeholder="e.g. https://github.com/owner/repo or owner/repo"
                          value={repoUrl}
                          onChange={(e) => setRepoUrl(e.target.value)}
                          aria-label="Repository URL"
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <Button onClick={handleImportByUrl} disabled={!isValidRepoUrl(repoUrl)}>Import</Button>
                        {!isValidRepoUrl(repoUrl) && repoUrl.trim() ? (
                          <span className="text-xs text-muted-foreground">Enter a valid GitHub URL or owner/name</span>
                        ) : null}
                      </div>
                    </div>
                  )}
                </>
              )}

              {view === 'cloning' && (
                <div className="flex min-h-[260px] flex-col items-center justify-center gap-4 py-8 text-center">
                  <Spinner size="md" />
                  <div className="space-y-1 text-sm text-muted-foreground">
                    {selectedRepo ? (
                      <>
                        <div>
                          Cloning <span className="font-medium text-foreground">{selectedRepo.full_name}</span>
                        </div>
                        {cloningTarget ? (
                          <div>
                            to <code className="rounded bg-muted/60 px-1">{cloningTarget}</code>
                          </div>
                        ) : null}
                        <div>Preparing files…</div>
                      </>
                    ) : (
                      'Preparing clone…'
                    )}
                  </div>
                </div>
              )}

              {view === 'error' && (
                <div className="flex min-h-[260px] flex-col items-center justify-center gap-4 py-8">
                  <Alert variant="destructive" className="max-w-md">
                    <AlertTitle>Import failed</AlertTitle>
                    <AlertDescription>{error || 'We could not clone this repository.'}</AlertDescription>
                  </Alert>
                  <div className="flex gap-2">
                    <Button type="button" variant="secondary" onClick={() => setView('list')}>
                      Back to list
                    </Button>
                    <Button type="button" onClick={() => selectedRepo && handleImportRepository(selectedRepo)}>
                      Retry
                    </Button>
                  </div>
                </div>
              )}
              {/* Sticky footer with destination and change action */}
              <div className="sticky bottom-0 -mx-5 -mb-5 border-t border-border/60 bg-background/95 px-5 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/60">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Folder className="h-3.5 w-3.5" />
                    <span>
                      Destination: <code className="rounded bg-muted/60 px-1 text-foreground">{cloneRoot || 'Not set'}</code>
                    </span>
                  </div>
                  <div className="flex flex-col items-start gap-1 sm:flex-row sm:items-center sm:gap-2">
                    {cloneRoot && cloneRoot !== savedDefaultRoot ? (
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            await window.electronAPI.updateSettings({ repository: { cloneRoot } });
                            setSavedDefaultRoot(cloneRoot);
                          } catch {}
                        }}
                        className="px-0 text-left text-[11px] font-medium text-muted-foreground underline-offset-2 hover:underline sm:text-xs"
                        aria-label="Set current destination as default"
                      >
                        Set as default?
                      </button>
                    ) : null}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={async () => {
                        try {
                          const res = await window.electronAPI.pickDirectory({
                            title: 'Select Clone Destination',
                            message: 'Choose a folder to clone GitHub repositories into',
                            defaultPath: cloneRoot || undefined,
                          });
                          if (res?.success && res.path) {
                            const next = res.path;
                            setCloneRoot(next);
                            // show hint by rendering a link when different; no modal prompt
                          }
                        } catch {}
                      }}
                    >
                      Change…
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
};

export default GithubImportModal;
