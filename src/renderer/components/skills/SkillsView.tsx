import React, { useState } from 'react';
import { RefreshCw, Search, Plus, Loader2, Sparkles } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Label } from '../ui/label';
import { Separator } from '../ui/separator';
import SkillCard from './SkillCard';
import SkillDetailModal from './SkillDetailModal';
import { useSkills } from './useSkills';
import { isValidSkillName } from '@shared/skills/validation';

const SkillsView: React.FC = () => {
  const {
    isLoading,
    isRefreshing,
    searchQuery,
    setSearchQuery,
    selectedSkill,
    showDetailModal,
    showCreateModal,
    setShowCreateModal,
    installedSkills,
    recommendedSkills,
    refresh,
    install,
    uninstall,
    openDetail,
    closeDetail,
    loadCatalog,
  } = useSkills();

  // New Skill form state
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const handleCreateSkill = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError(null);

    const trimmedName = newName.trim();
    if (!isValidSkillName(trimmedName)) {
      setCreateError('Name must be lowercase letters, numbers, and hyphens (2-64 chars).');
      return;
    }
    if (!newDescription.trim()) {
      setCreateError('Description is required.');
      return;
    }

    setIsCreating(true);
    try {
      const result = await window.electronAPI.skillsCreate({
        name: trimmedName,
        description: newDescription.trim(),
      });
      if (result.success) {
        setShowCreateModal(false);
        setNewName('');
        setNewDescription('');
        await loadCatalog();

        // Open terminal in the new skill directory
        if (result.data?.localPath) {
          const ptyId = `skill-${trimmedName}-${Date.now()}`;
          window.electronAPI.ptyStart({ id: ptyId, cwd: result.data.localPath });
        }
      } else {
        setCreateError(result.error || 'Failed to create skill');
      }
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create skill');
    } finally {
      setIsCreating(false);
    }
  };

  const handleOpenTerminal = (skillPath: string) => {
    window.electronAPI.openIn({ app: 'terminal', path: skillPath });
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
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search skills..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
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
          <Button variant="outline" size="sm" onClick={() => setShowCreateModal(true)}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            New Skill
          </Button>
        </div>

        <div className="mb-4 flex items-start gap-3 rounded-lg border border-border bg-muted/20 px-4 py-3">
          <p className="text-xs leading-relaxed text-muted-foreground">
            Skills from the{' '}
            <a
              href="https://github.com/openai/skills"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-foreground underline decoration-muted-foreground/40 underline-offset-2 hover:decoration-foreground"
            >
              OpenAI
            </a>{' '}
            and{' '}
            <a
              href="https://github.com/anthropics/skills"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-foreground underline decoration-muted-foreground/40 underline-offset-2 hover:decoration-foreground"
            >
              Anthropic
            </a>{' '}
            catalogs. Install a skill to make it available across all your coding agents. If you
            want to use skills from another skills library, feel free to let us know in the
            feedback.
          </p>
        </div>

        {installedSkills.length > 0 && (
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

        {recommendedSkills.length > 0 && (
          <div className="mb-6">
            <h2 className="mb-3 text-xs font-medium tracking-wide text-muted-foreground">
              Recommended
            </h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {recommendedSkills.map((skill) => (
                <SkillCard key={skill.id} skill={skill} onSelect={openDetail} onInstall={install} />
              ))}
            </div>
          </div>
        )}

        {installedSkills.length === 0 && recommendedSkills.length === 0 && (
          <div className="py-12 text-center">
            <p className="text-sm text-muted-foreground">
              {searchQuery ? 'No skills match your search.' : 'No skills available.'}
            </p>
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

      <Dialog
        open={showCreateModal}
        onOpenChange={(open) => !open && !isCreating && setShowCreateModal(false)}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>New Skill</DialogTitle>
            <DialogDescription className="text-xs">
              Create a new skill module in ~/.agentskills/
            </DialogDescription>
          </DialogHeader>
          <Separator />
          <form onSubmit={handleCreateSkill} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="skill-name" className="text-xs">
                Name
              </Label>
              <Input
                id="skill-name"
                placeholder="my-skill"
                value={newName}
                onChange={(e) => {
                  setNewName(e.target.value);
                  setCreateError(null);
                }}
                className="text-sm"
              />
              <p className="text-[10px] text-muted-foreground">
                Lowercase letters, numbers, and hyphens
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="skill-desc" className="text-xs">
                Description
              </Label>
              <Input
                id="skill-desc"
                placeholder="What does this skill do?"
                value={newDescription}
                onChange={(e) => {
                  setNewDescription(e.target.value);
                  setCreateError(null);
                }}
                className="text-sm"
              />
            </div>
            {createError && <p className="text-xs text-destructive">{createError}</p>}
            <DialogFooter>
              <Button type="submit" size="sm" disabled={isCreating}>
                {isCreating ? 'Creating...' : 'Create'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default SkillsView;
