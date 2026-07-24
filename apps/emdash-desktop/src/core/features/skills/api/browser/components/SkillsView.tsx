import { Plus, RefreshCw } from 'lucide-react';
import React, { useState } from 'react';
import { useOpenModal } from '@core/manifests/browser/modal-api';
import { Button } from '@core/primitives/ui/browser/button';
import { PageHeader } from '@core/primitives/ui/browser/components/page-header';
import { SearchInput } from '@core/primitives/ui/browser/search-input';
import { rpc } from '@renderer/lib/runtime/desktop-host-client';
import { useSkills } from '../../../browser/components/useSkills';
import { SkillsList } from './SkillsList';

export const SkillsView: React.FC = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const skills = useSkills({ searchQuery });
  const openCreateSkillModal = useOpenModal('createSkillModal');

  const handleOpenTerminal = (skillPath: string) => {
    void rpc.app.openIn({ app: 'terminal', path: skillPath });
  };

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
                onClick={skills.refresh}
                disabled={skills.isRefreshing}
                aria-label="Refresh catalog"
              >
                <RefreshCw
                  className={`text-muted-foreground h-4 w-4 ${skills.isRefreshing ? 'animate-spin' : ''}`}
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
      <SkillsList skills={skills} onOpenTerminal={handleOpenTerminal} />
    </div>
  );
};
