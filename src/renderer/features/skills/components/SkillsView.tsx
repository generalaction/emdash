import { Compass, Loader2, Plus, RefreshCw, Search, SearchX } from 'lucide-react';
import React from 'react';
import { rpc } from '@renderer/lib/ipc';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import { EmptyState } from '@renderer/lib/ui/empty-state';
import { Input } from '@renderer/lib/ui/input';
import SkillCard from './SkillCard';
import SkillDetailModal from './SkillDetailModal';
import { useSkills } from './useSkills';

const SKELETON_TITLE_WIDTHS = ['65%', '52%', '74%', '58%'] as const;
const SKELETON_DESC_WIDTHS = ['88%', '76%', '94%', '82%'] as const;
const SKELETON_META_WIDTHS = ['28%', '34%', '24%', '40%'] as const;

function SkillCardSkeleton({ index = 0 }: { index?: number }) {
  const titleWidth = SKELETON_TITLE_WIDTHS[index % SKELETON_TITLE_WIDTHS.length];
  const descWidth = SKELETON_DESC_WIDTHS[index % SKELETON_DESC_WIDTHS.length];
  const metaWidth = SKELETON_META_WIDTHS[index % SKELETON_META_WIDTHS.length];

  return (
    <div
      aria-hidden
      className="flex w-full items-center gap-3 rounded-lg border border-border bg-muted/20 p-4 shadow-sm"
    >
      <div className="skeleton-shimmer h-10 w-10 shrink-0 rounded-xl" />
      <div className="min-w-0 flex-1 space-y-2">
        <div className="skeleton-shimmer h-3.5 rounded" style={{ width: titleWidth }} />
        <div className="skeleton-shimmer h-3 rounded" style={{ width: descWidth }} />
        <div className="skeleton-shimmer h-2.5 rounded" style={{ width: metaWidth }} />
      </div>
      <div className="skeleton-shimmer h-6 w-6 shrink-0 rounded-md" />
    </div>
  );
}

function SkillCardSkeletonGrid({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {Array.from({ length: count }).map((_, i) => (
        <SkillCardSkeleton key={i} index={i} />
      ))}
    </div>
  );
}

const SkillsView: React.FC = () => {
  const {
    isLoading,
    isRefreshing,
    isSearching,
    hasActiveSearch,
    searchQuery,
    setSearchQuery,
    selectedSkill,
    isDetailLoading,
    showDetailModal,
    installedSkills,
    recommendedSkills,
    refresh,
    install,
    uninstall,
    openDetail,
    closeDetail,
  } = useSkills();
  const showCreateSkillModal = useShowModal('createSkillModal');

  const handleOpenTerminal = (skillPath: string) => {
    void rpc.app.openIn({ app: 'terminal', path: skillPath });
  };

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center bg-background text-foreground">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const trimmedQuery = searchQuery.trim();
  const showBrowseSection = hasActiveSearch || recommendedSkills.length > 0;
  const browseLabel = hasActiveSearch ? 'Results from skills.sh' : 'Browse skills.sh';
  const showEmptyState =
    installedSkills.length === 0 && recommendedSkills.length === 0 && !hasActiveSearch;

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-background text-foreground">
      <div className="mx-auto w-full max-w-3xl px-8 py-8">
        <div className="mb-6">
          <h1 className="text-lg font-semibold">Skills</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Extend your agents with reusable skill modules
          </p>
        </div>

        <div className="mb-6 flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search skills.sh..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 pr-9"
            />
            {isSearching && (
              <Loader2 className="absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
            )}
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={refresh}
            disabled={isRefreshing}
            aria-label="Refresh catalog"
          >
            <RefreshCw
              className={`h-4 w-4 text-muted-foreground ${isRefreshing ? 'animate-spin' : ''}`}
            />
          </Button>
          <Button variant="outline" size="sm" onClick={() => showCreateSkillModal({})}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            New Skill
          </Button>
        </div>

        <div className="mb-4 flex items-start gap-3 rounded-lg border border-border bg-muted/20 px-4 py-3">
          <p className="text-xs leading-relaxed text-muted-foreground">
            Skills from{' '}
            <a
              href="https://skills.sh"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-foreground underline decoration-muted-foreground/40 underline-offset-2 hover:decoration-foreground"
            >
              skills.sh
            </a>
            . Install a skill to make it available across all your coding agents. Skills follow the
            open{' '}
            <a
              href="https://agentskills.io"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-foreground underline decoration-muted-foreground/40 underline-offset-2 hover:decoration-foreground"
            >
              Agent Skills
            </a>{' '}
            standard.
          </p>
        </div>

        {installedSkills.length > 0 && (
          <div className="mb-6">
            <h2 className="mb-3 flex items-center gap-1.5 text-xs font-medium tracking-wide text-muted-foreground">
              Installed
              <span className="text-muted-foreground/60">{installedSkills.length}</span>
            </h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {installedSkills.map((skill) => (
                <SkillCard key={skill.id} skill={skill} onSelect={openDetail} onInstall={install} />
              ))}
            </div>
          </div>
        )}

        {showBrowseSection && (
          <div className="mb-6">
            <h2 className="mb-3 flex items-center gap-1.5 text-xs font-medium tracking-wide text-muted-foreground">
              <span>{browseLabel}</span>
              {!isSearching && recommendedSkills.length > 0 && (
                <span className="text-muted-foreground/60">{recommendedSkills.length}</span>
              )}
            </h2>

            {isSearching ? (
              <SkillCardSkeletonGrid count={recommendedSkills.length || 4} />
            ) : recommendedSkills.length > 0 ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {recommendedSkills.map((skill) => (
                  <SkillCard
                    key={skill.id}
                    skill={skill}
                    onSelect={openDetail}
                    onInstall={install}
                  />
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-border bg-muted/10 px-4 py-8 text-center">
                <SearchX className="mx-auto mb-2 h-5 w-5 text-muted-foreground" />
                <p className="text-sm font-medium text-foreground">
                  No skills on skills.sh match "{trimmedQuery}"
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Try a different keyword, or create your own skill.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  onClick={() => showCreateSkillModal({})}
                >
                  <Plus className="mr-1.5 h-3.5 w-3.5" />
                  New Skill
                </Button>
              </div>
            )}
          </div>
        )}

        {showEmptyState && (
          <div className="py-8">
            <EmptyState
              icon={<Compass className="h-5 w-5 text-muted-foreground" />}
              label="No skills yet"
              description="The skills.sh catalog could not be loaded. Refresh, or create a skill of your own."
              action={
                <Button variant="outline" size="sm" onClick={refresh} disabled={isRefreshing}>
                  <RefreshCw
                    className={`mr-1.5 h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`}
                  />
                  Refresh catalog
                </Button>
              }
            />
          </div>
        )}
      </div>

      <SkillDetailModal
        skill={selectedSkill}
        isLoading={isDetailLoading}
        isOpen={showDetailModal}
        onClose={closeDetail}
        onInstall={install}
        onUninstall={uninstall}
        onOpenTerminal={handleOpenTerminal}
      />
    </div>
  );
};

export default SkillsView;
