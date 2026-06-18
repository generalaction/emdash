import { FolderOpen, Trash2 } from 'lucide-react';
import React, { useCallback, useState } from 'react';
import { Button } from '@renderer/lib/ui/button';
import { ConfirmButton } from '@renderer/lib/ui/confirm-button';
import {
  Dialog,
  DialogContent,
  DialogContentArea,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/lib/ui/dialog';
import { MarkdownRenderer } from '@renderer/lib/ui/markdown-renderer';
import type { CatalogSkill } from '@shared/core/skills/types';
import { parseFrontmatter } from '@shared/core/skills/validation';
import { SkillIconRenderer } from './SkillIconRenderer';

const sourceMeta = {
  openai: { name: 'OpenAI', icon: 'https://github.com/openai.png' },
  anthropic: { name: 'Anthropic', icon: 'https://github.com/anthropics.png' },
  skillssh: { name: 'Skills.SH', icon: 'https://skills.sh/favicon.ico' },
} as const;

interface SkillDetailModalProps {
  skill: CatalogSkill | null;
  isLoading: boolean;
  isOpen: boolean;
  onClose: () => void;
  onInstall: (skillId: string) => Promise<boolean>;
  onUninstall: (skillId: string) => void;
  onOpenTerminal?: (skillPath: string) => void;
}

export const SkillDetailModal: React.FC<SkillDetailModalProps> = ({
  skill,
  isLoading,
  isOpen,
  onClose,
  onInstall,
  onUninstall,
  onOpenTerminal,
}) => {
  const [isProcessing, setIsProcessing] = useState(false);

  const handleInstall = useCallback(async () => {
    if (!skill) return;
    setIsProcessing(true);
    try {
      const success = await onInstall(skill.id);
      if (success) onClose();
    } finally {
      setIsProcessing(false);
    }
  }, [skill, onInstall, onClose]);

  const handleUninstall = useCallback(() => {
    if (!skill) return;
    onUninstall(skill.id);
  }, [skill, onUninstall]);

  const handleOpen = useCallback(() => {
    if (skill?.localPath && onOpenTerminal) {
      onOpenTerminal(skill.localPath);
    }
  }, [skill, onOpenTerminal]);

  if (!skill) return null;

  const body = skill.skillMdContent ? parseFrontmatter(skill.skillMdContent).body.trim() : '';
  const visibleBody = isSkillShPathBody(body) ? '' : body;
  const meta = skill.source === 'local' ? null : sourceMeta[skill.source];
  const showLoadingContent = isLoading && !skill.skillMdContent;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && !isProcessing && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <SkillIconRenderer skill={skill} />
            <div className="min-w-0 flex-1">
              <DialogTitle className="font-sans text-base tracking-normal text-foreground normal-case">
                {skill.displayName}
              </DialogTitle>
              {meta && (
                <div className="text-muted-foreground mt-0.5 flex items-center gap-1.5 text-xs">
                  <img src={meta.icon} alt="" className="h-4 w-4 rounded-sm" />
                  <span>From {meta.name} skill library</span>
                </div>
              )}
            </div>
          </div>
        </DialogHeader>
        <DialogContentArea>
          {showLoadingContent && <SkillDetailShimmer />}

          {!showLoadingContent && skill.defaultPrompt && (
            <div className="bg-muted/40 space-y-1 rounded-md pb-2">
              <p className="text-muted-foreground text-xs font-medium">Example prompt</p>
              <pre className="text-xs wrap-break-word whitespace-pre-wrap text-foreground">
                {skill.defaultPrompt}
              </pre>
            </div>
          )}

          {!showLoadingContent && visibleBody && (
            <MarkdownRenderer
              content={visibleBody}
              variant="compact"
              className="bg-muted/20 text-muted-foreground rounded-md px-3 py-2 text-xs"
            />
          )}
        </DialogContentArea>

        <DialogFooter className="gap-2 sm:gap-2">
          {skill.installed && (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleUninstall}
                disabled={isProcessing}
                className="text-destructive hover:text-destructive"
              >
                <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                Uninstall
              </Button>
              {skill.localPath && onOpenTerminal && (
                <Button variant="outline" size="sm" onClick={handleOpen}>
                  <FolderOpen className="mr-1.5 h-3.5 w-3.5" />
                  Open
                </Button>
              )}
            </>
          )}
          {!skill.installed && (
            <ConfirmButton size="sm" onClick={() => void handleInstall()} disabled={isProcessing}>
              {isProcessing ? 'Installing...' : 'Install'}
            </ConfirmButton>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

function isSkillShPathBody(body: string): boolean {
  return /^\.\.\/.*\/SKILL\.md$/.test(body);
}

function SkillDetailShimmer() {
  const lineClass = 'h-3 animate-pulse rounded-full bg-foreground/10 dark:bg-white/15';

  return (
    <div
      className="min-h-32 space-y-4 rounded-md border border-border bg-background-2 px-3 py-3"
      aria-label="Loading skill details"
    >
      <div className="space-y-2">
        <div className={`${lineClass} w-24`} />
        <div className={`${lineClass} w-full`} />
        <div className={`${lineClass} w-5/6`} />
      </div>
      <div className="space-y-2">
        <div className={`${lineClass} w-32`} />
        <div className={`${lineClass} w-11/12`} />
        <div className={`${lineClass} w-2/3`} />
      </div>
    </div>
  );
}
