import { Loader2, Plus, RefreshCw } from 'lucide-react';
import React, { useCallback } from 'react';
import { CardGridSection } from '@renderer/lib/components/card-grid';
import { PageHeader } from '@renderer/lib/components/page-header';
import { rpc } from '@renderer/lib/ipc';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import { SearchInput } from '@renderer/lib/ui/search-input';
import { SkillCard } from './SkillCard';
import { SkillDetailModal } from './SkillDetailModal';
import { useSkills } from './useSkills';

export const SkillsView: React.FC = () => {
  const {
    catalog,
    isLoading,
    isRefreshing,
    searchQuery,
    setSearchQuery,
    selectedSkill,
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
  const showConfirm = useShowModal('confirmActionModal');

  const handleOpenTerminal = (skillPath: string) => {
    void rpc.app.openIn({ app: 'terminal', path: skillPath });
  };

  const handleUninstallRequest = useCallback(
    (skillId: string) => {
      const displayName = catalog?.skills.find((s) => s.id === skillId)?.displayName ?? skillId;
      closeDetail();
      showConfirm({
        title: 'Uninstall skill?',
        description: `This will uninstall "${displayName}" from all agents. This action cannot be undone.`,
        confirmLabel: 'Uninstall',
        onSuccess: () => void uninstall(skillId),
      });
    },
    [catalog, closeDetail, showConfirm, uninstall]
  );

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-foreground">
        <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto text-foreground">
      <div className="mx-auto w-full max-w-3xl px-8 py-8">
        <PageHeader title="Skills" description="Extend your agents with reusable skill modules">
          <div className="flex flex-col items-center gap-2">
            <div className="flex w-full items-center justify-between gap-2">
              <SearchInput
                placeholder="Search skills..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="icon"
                  onClick={refresh}
                  disabled={isRefreshing}
                  aria-label="Refresh catalog"
                >
                  <RefreshCw
                    className={`text-muted-foreground h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`}
                  />
                </Button>
                <Button onClick={() => showCreateSkillModal({})}>
                  <Plus className="size-4" />
                  New Skill
                </Button>
              </div>
            </div>
          </div>
        </PageHeader>
        <div className="flex flex-col gap-8 py-8">
          {installedSkills.length > 0 && (
            <CardGridSection title="Installed">
              {installedSkills.map((skill) => (
                <SkillCard
                  key={skill.id}
                  skill={skill}
                  isInstalled={true}
                  onInstall={install}
                  onUninstall={handleUninstallRequest}
                  onClick={() => openDetail(skill)}
                />
              ))}
            </CardGridSection>
          )}
          {recommendedSkills.length > 0 && (
            <CardGridSection title="Recommended">
              {recommendedSkills.map((skill) => (
                <SkillCard
                  key={skill.id}
                  skill={skill}
                  isInstalled={false}
                  onInstall={install}
                  onUninstall={handleUninstallRequest}
                  onClick={() => openDetail(skill)}
                />
              ))}
            </CardGridSection>
          )}
        </div>
      </div>
      <SkillDetailModal
        skill={selectedSkill}
        isOpen={showDetailModal}
        onClose={closeDetail}
        onInstall={install}
        onUninstall={handleUninstallRequest}
        onOpenTerminal={handleOpenTerminal}
      />
    </div>
  );
};
