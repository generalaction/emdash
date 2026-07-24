import type { HostRef } from '@emdash/core/primitives/host/api';
import { Loader2 } from 'lucide-react';
import React, { useCallback } from 'react';
import { useOpenModal } from '@core/manifests/browser/modal-api';
import { CardGridSection } from '@core/primitives/ui/browser/components/card-grid';
import { SkillCard } from '../../../browser/components/SkillCard';
import { SkillDetailModal } from '../../../browser/components/SkillDetailModal';
import { useSkills, type UseSkillsResult } from '../../../browser/components/useSkills';

type SkillsListProps = {
  skills: UseSkillsResult;
  onOpenTerminal?: (skillPath: string) => void;
};

export const SkillsList: React.FC<SkillsListProps> = ({ skills, onOpenTerminal }) => {
  const openConfirm = useOpenModal('confirmActionModal');

  const handleUninstallRequest = useCallback(
    (skillId: string) => {
      const displayName =
        skills.catalog?.skills.find((skill) => skill.id === skillId)?.displayName ?? skillId;
      void openConfirm({
        title: 'Uninstall skill?',
        description: `This will uninstall "${displayName}" from all agents. This action cannot be undone.`,
        confirmLabel: 'Uninstall',
      }).then((outcome) => {
        if (outcome.success) {
          skills.closeDetail();
          void skills.uninstall(skillId);
        }
      });
    },
    [openConfirm, skills]
  );

  if (skills.isLoading) {
    return (
      <div className="flex min-h-64 items-center justify-center text-foreground">
        <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col text-foreground">
      <div className="flex flex-col gap-8 py-8">
        {skills.installedSkills.length > 0 && (
          <CardGridSection title="Installed">
            {skills.installedSkills.map((skill) => (
              <SkillCard
                key={skill.id}
                skill={skill}
                isInstalled={true}
                onInstall={skills.install}
                onUninstall={handleUninstallRequest}
                onClick={() => skills.openDetail(skill)}
              />
            ))}
          </CardGridSection>
        )}
        {skills.recommendedSkills.length > 0 && (
          <CardGridSection title="Recommended">
            {skills.recommendedSkills.map((skill) => (
              <SkillCard
                key={skill.id}
                skill={skill}
                isInstalled={false}
                onInstall={skills.install}
                onUninstall={handleUninstallRequest}
                onClick={() => skills.openDetail(skill)}
              />
            ))}
          </CardGridSection>
        )}
        {(skills.isSearchingSkillSh || skills.skillShSearchSkills.length > 0) && (
          <CardGridSection
            title={skills.isSearchingSkillSh ? 'Searching Skills.sh...' : 'Skills.sh'}
          >
            {skills.skillShSearchSkills.map((skill) => (
              <SkillCard
                key={skill.id}
                skill={skill}
                isInstalled={false}
                onInstall={skills.install}
                onUninstall={handleUninstallRequest}
                onClick={() => skills.openDetail(skill)}
              />
            ))}
          </CardGridSection>
        )}
      </div>
      <SkillDetailModal
        skill={skills.selectedSkill}
        isLoading={skills.isLoadingDetail}
        isOpen={skills.showDetailModal}
        onClose={skills.closeDetail}
        onInstall={skills.install}
        onUninstall={handleUninstallRequest}
        onOpenTerminal={onOpenTerminal}
      />
    </div>
  );
};

export function SkillsListForHost({ host }: { host: HostRef }) {
  const skills = useSkills({ host });

  return <SkillsList skills={skills} />;
}
