import { Loader2, Plus, RefreshCw } from 'lucide-react';
import React, { useCallback } from 'react';
import { useOpenModal } from '@core/manifests/browser/modal-api';
import { Button } from '@core/primitives/ui/browser/button';
import { CardGridSection } from '@core/primitives/ui/browser/components/card-grid';
import { PageHeader } from '@core/primitives/ui/browser/components/page-header';
import { SearchInput } from '@core/primitives/ui/browser/search-input';
import { rpc } from '@renderer/lib/runtime/desktop-host-client';
import { SkillCard } from '../../../browser/components/SkillCard';
import { SkillDetailModal } from '../../../browser/components/SkillDetailModal';
import { useSkills } from '../../../browser/components/useSkills';

export const SkillsView: React.FC = () => {
  const {
    catalog,
    isLoading,
    isRefreshing,
    searchQuery,
    setSearchQuery,
    selectedSkill,
    isLoadingDetail,
    showDetailModal,
    installedSkills,
    recommendedSkills,
    skillShSearchSkills,
    isSearchingSkillSh,
    refresh,
    install,
    uninstall,
    openDetail,
    closeDetail,
  } = useSkills();
  const openCreateSkillModal = useOpenModal('createSkillModal');
  const openConfirm = useOpenModal('confirmActionModal');

  const handleOpenTerminal = (skillPath: string) => {
    void rpc.app.openIn({ app: 'terminal', path: skillPath });
  };

  const handleUninstallRequest = useCallback(
    (skillId: string) => {
      const displayName = catalog?.skills.find((s) => s.id === skillId)?.displayName ?? skillId;
      void openConfirm({
        title: 'Uninstall skill?',
        description: `This will uninstall "${displayName}" from all agents. This action cannot be undone.`,
        confirmLabel: 'Uninstall',
      }).then((outcome) => {
        if (outcome.success) {
          closeDetail();
          void uninstall(skillId);
        }
      });
    },
    [catalog, closeDetail, openConfirm, uninstall]
  );

  if (isLoading) {
    return (
      <div className="flex min-h-64 items-center justify-center text-foreground">
        <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col text-foreground">
      <PageHeader
        sticky
        title="Skills"
        description="Extend your agents with reusable skill modules"
      >
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
              <Button onClick={() => void openCreateSkillModal()}>
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
        {(isSearchingSkillSh || skillShSearchSkills.length > 0) && (
          <CardGridSection title={isSearchingSkillSh ? 'Searching Skills.SH...' : 'Skills.SH'}>
            {skillShSearchSkills.map((skill) => (
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
      <SkillDetailModal
        skill={selectedSkill}
        isLoading={isLoadingDetail}
        isOpen={showDetailModal}
        onClose={closeDetail}
        onInstall={install}
        onUninstall={handleUninstallRequest}
        onOpenTerminal={handleOpenTerminal}
      />
    </div>
  );
};
