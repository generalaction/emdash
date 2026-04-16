import { FolderOpen, Trash2 } from 'lucide-react';
import React, { useCallback, useState } from 'react';
import type { CatalogSkill } from '@shared/skills/types';
import { parseFrontmatter } from '@shared/skills/validation';
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
import SkillIconRenderer from './SkillIconRenderer';

interface SkillDetailModalProps {
  skill: CatalogSkill | null;
  isOpen: boolean;
  onClose: () => void;
  onInstall: (skillId: string, source?: { owner: string; repo: string }) => Promise<boolean>;
  onUninstall: (skillId: string) => Promise<boolean>;
  onOpenTerminal?: (skillPath: string) => void;
}

function sourceLabel(source: CatalogSkill['source']): string {
  switch (source) {
    case 'openai':
      return 'OpenAI';
    case 'anthropic':
      return 'Anthropic';
    case 'skills-sh':
      return 'skills.sh';
    default:
      return '';
  }
}

function sourceAvatar(skill: CatalogSkill): string | null {
  if (skill.source === 'openai') return 'https://github.com/openai.png';
  if (skill.source === 'anthropic') return 'https://github.com/anthropics.png';
  if (skill.source === 'skills-sh' && skill.owner) {
    return `https://github.com/${skill.owner}.png?size=40`;
  }
  return null;
}

const SkillDetailModal: React.FC<SkillDetailModalProps> = ({
  skill,
  isOpen,
  onClose,
  onInstall,
  onUninstall,
  onOpenTerminal,
}) => {
  const [isProcessing, setIsProcessing] = useState(false);

  const handleInstall = useCallback(async () => {
    if (!skill) return;
    const source =
      skill.source === 'skills-sh' && skill.owner && skill.repo
        ? { owner: skill.owner, repo: skill.repo }
        : undefined;
    setIsProcessing(true);
    try {
      const success = await onInstall(skill.id, source);
      if (success) onClose();
    } finally {
      setIsProcessing(false);
    }
  }, [skill, onInstall, onClose]);

  const handleUninstall = useCallback(async () => {
    if (!skill) return;
    setIsProcessing(true);
    try {
      await onUninstall(skill.id);
      onClose();
    } finally {
      setIsProcessing(false);
    }
  }, [skill, onUninstall, onClose]);

  const handleOpen = useCallback(() => {
    if (skill?.localPath && onOpenTerminal) {
      onOpenTerminal(skill.localPath);
    }
  }, [skill, onOpenTerminal]);

  if (!skill) return null;

  const body = skill.skillMdContent ? parseFrontmatter(skill.skillMdContent).body.trim() : '';

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && !isProcessing && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <SkillIconRenderer skill={skill} size="md" />
            <div className="min-w-0 flex-1">
              <DialogTitle className="text-base font-sans normal-case tracking-normal text-foreground">
                {skill.displayName}
              </DialogTitle>
              {skill.source !== 'local' &&
                (() => {
                  const avatar = sourceAvatar(skill);
                  const label = sourceLabel(skill.source);
                  return (
                    <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                      {avatar && <img src={avatar} alt="" className="h-4 w-4 rounded-sm" />}
                      <span>
                        {skill.source === 'skills-sh' && skill.owner
                          ? `From ${skill.owner}/${skill.repo ?? ''} via ${label}`
                          : `From ${label} skill library`}
                      </span>
                    </div>
                  );
                })()}
            </div>
          </div>
        </DialogHeader>
        <DialogContentArea>
          {skill.defaultPrompt && (
            <div className="space-y-1 rounded-md bg-muted/40 pb-2">
              <p className="text-xs font-medium text-muted-foreground">Example prompt</p>
              <pre className="whitespace-pre-wrap wrap-break-word text-xs text-foreground">
                {skill.defaultPrompt}
              </pre>
            </div>
          )}

          {body && (
            <MarkdownRenderer
              content={body}
              variant="compact"
              className="max-h-60 overflow-y-auto rounded-md bg-muted/20  py-2 text-xs text-muted-foreground"
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

export default SkillDetailModal;
