import { AnimatePresence, motion } from 'framer-motion';
import { Loader2, Plus, RefreshCw, Search } from 'lucide-react';
import React from 'react';
import { rpc } from '@renderer/lib/ipc';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import { Input } from '@renderer/lib/ui/input';
import { cn } from '@renderer/utils/utils';
import SkillCard from './SkillCard';
import SkillDetailModal from './SkillDetailModal';
import { useSkills, type SkillsTab } from './useSkills';

const TABS: Array<{ id: SkillsTab; label: string }> = [
  { id: 'recommended', label: 'Recommended' },
  { id: 'all-time', label: 'All Time' },
  { id: 'trending', label: 'Trending' },
  { id: 'hot', label: 'Hot' },
];

const BROWSE_TAB_LABELS: Record<Exclude<SkillsTab, 'recommended'>, string> = {
  'all-time': 'All Time',
  trending: 'Trending',
  hot: 'Hot',
};

const SkillsView: React.FC = () => {
  const {
    isLoading,
    isRefreshing,
    searchQuery,
    setSearchQuery,
    selectedSkill,
    showDetailModal,
    installedSkills,
    recommendedSkills,
    skillsShResults,
    isSearching,
    isSearchActive,
    activeTab,
    setActiveTab,
    browseResults,
    isBrowseLoading,
    refresh,
    install,
    uninstall,
    openDetail,
    closeDetail,
  } = useSkills();
  const showCreateSkillModal = useShowModal('createSkillModal');

  const handleOpenTerminal = (skillPath: string) => {
    rpc.app.openIn({ app: 'terminal', path: skillPath });
  };

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center bg-background text-foreground">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-background text-foreground">
      <div className="mx-auto w-full max-w-3xl px-8 py-8">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-lg font-semibold">Skills</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Extend your agents with reusable skill modules
          </p>
        </div>

        {/* Toolbar */}
        <div className="mb-6 flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search skills across the ecosystem..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
            {isSearching && (
              <Loader2 className="absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-muted-foreground" />
            )}
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={refresh}
            disabled={isRefreshing}
            aria-label="Refresh catalog"
            title="Refresh catalog"
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

        <p className="mb-6 text-[11px] leading-relaxed text-muted-foreground">
          Curated skills from{' '}
          <a
            href="https://github.com/openai/skills"
            target="_blank"
            rel="noopener noreferrer"
            className="text-foreground underline decoration-muted-foreground/40 underline-offset-2 hover:decoration-foreground"
          >
            OpenAI
          </a>
          ,{' '}
          <a
            href="https://github.com/anthropics/skills"
            target="_blank"
            rel="noopener noreferrer"
            className="text-foreground underline decoration-muted-foreground/40 underline-offset-2 hover:decoration-foreground"
          >
            Anthropic
          </a>
          , and{' '}
          <a
            href="https://skills.sh"
            target="_blank"
            rel="noopener noreferrer"
            className="text-foreground underline decoration-muted-foreground/40 underline-offset-2 hover:decoration-foreground"
          >
            skills.sh
          </a>
          . Follows the{' '}
          <a
            href="https://agentskills.io"
            target="_blank"
            rel="noopener noreferrer"
            className="text-foreground underline decoration-muted-foreground/40 underline-offset-2 hover:decoration-foreground"
          >
            Agent Skills
          </a>{' '}
          standard.
        </p>

        {!isSearchActive && (
          <div className="mb-5 flex items-center gap-1 border-b border-border">
            {TABS.map((tab) => {
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    'relative -mb-px px-3 py-2 text-xs font-medium transition-colors',
                    active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {tab.label}
                  {active && (
                    <motion.span
                      layoutId="skills-tab-underline"
                      className="absolute inset-x-0 bottom-[-1px] h-0.5 bg-foreground"
                      transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                    />
                  )}
                </button>
              );
            })}
          </div>
        )}

        {isSearchActive && installedSkills.length > 0 && (
          <div className="mb-6">
            <h2 className="mb-3 text-xs font-medium tracking-wide text-muted-foreground">
              Installed
            </h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {installedSkills.map((skill) => (
                <SkillCard key={skill.id} skill={skill} onSelect={openDetail} onInstall={install} />
              ))}
            </div>
          </div>
        )}

        {!isSearchActive && (
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
            >
              {activeTab === 'recommended' ? (
                <>
                  {installedSkills.length > 0 && (
                    <div className="mb-6">
                      <h2 className="mb-3 text-xs font-medium tracking-wide text-muted-foreground">
                        Installed
                      </h2>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        {installedSkills.map((skill) => (
                          <SkillCard
                            key={skill.id}
                            skill={skill}
                            onSelect={openDetail}
                            onInstall={install}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                  {recommendedSkills.length > 0 && (
                    <div className="mb-6">
                      <h2 className="mb-3 text-xs font-medium tracking-wide text-muted-foreground">
                        Recommended
                      </h2>
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
                    </div>
                  )}
                </>
              ) : (
                <div className="mb-6">
                  <h2 className="mb-3 flex items-center gap-2 text-xs font-medium tracking-wide text-muted-foreground">
                    {BROWSE_TAB_LABELS[activeTab]} on skills.sh
                    {isBrowseLoading && <Loader2 className="h-3 w-3 animate-spin" />}
                  </h2>
                  {browseResults.length > 0 ? (
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      {browseResults.map((skill) => (
                        <SkillCard
                          key={`${skill.owner}/${skill.repo}/${skill.id}`}
                          skill={skill}
                          onSelect={openDetail}
                          onInstall={install}
                        />
                      ))}
                    </div>
                  ) : (
                    !isBrowseLoading && (
                      <p className="text-sm text-muted-foreground">No skills to show.</p>
                    )
                  )}
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        )}

        {isSearchActive && (skillsShResults.length > 0 || isSearching) && (
          <div className="mb-6">
            <h2 className="mb-3 flex items-center gap-2 text-xs font-medium tracking-wide text-muted-foreground">
              From skills.sh
              {isSearching && <Loader2 className="h-3 w-3 animate-spin" />}
            </h2>
            {skillsShResults.length > 0 && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {skillsShResults.map((skill) => (
                  <SkillCard
                    key={skill.id}
                    skill={skill}
                    onSelect={openDetail}
                    onInstall={install}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {isSearchActive &&
          installedSkills.length === 0 &&
          recommendedSkills.length === 0 &&
          skillsShResults.length === 0 &&
          !isSearching && (
            <div className="py-12 text-center">
              <p className="text-sm text-muted-foreground">No skills match your search.</p>
            </div>
          )}
      </div>

      <SkillDetailModal
        skill={selectedSkill}
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
