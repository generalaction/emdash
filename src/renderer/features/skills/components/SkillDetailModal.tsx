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
import type { CatalogSkill } from '@shared/skills/types';
import { parseFrontmatter } from '@shared/skills/validation';
import { SkillIconRenderer } from './SkillIconRenderer';

interface SkillDetailModalProps {
  skill: CatalogSkill | null;
  isOpen: boolean;
  onClose: () => void;
  onInstall: (skillId: string) => Promise<boolean>;
  onUninstall: (skillId: string) => void;
  onOpenTerminal?: (skillPath: string) => void;
}

export const SkillDetailModal: React.FC<SkillDetailModalProps> = ({
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
              {skill.source !== 'local' && (
                <div className="text-muted-foreground mt-0.5 flex items-center gap-1.5 text-xs">
                  <img
                    src={
                      skill.source === 'openai'
                        ? 'https://github.com/openai.png'
                        : 'https://github.com/anthropics.png'
                    }
                    alt=""
                    className="size-4 rounded-sm"
                  />
                  <span>
                    From {skill.source === 'openai' ? 'OpenAI' : 'Anthropic'} skill library
                  </span>
                </div>
              )}
            </div>
          </div>
        </DialogHeader>
        <DialogContentArea>
          {skill.defaultPrompt && (
            <div className="bg-muted/40 space-y-1 rounded-md pb-2">
              <p className="text-muted-foreground text-xs font-medium">Example prompt</p>
              <pre className="text-xs wrap-break-word whitespace-pre-wrap text-foreground">
                {skill.defaultPrompt}
              </pre>
            </div>
          )}

          {body && (
            <MarkdownRenderer
              content={body}
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
                <Trash2 className="mr-1.5 size-3.5" />
                Uninstall
              </Button>
              {skill.localPath && onOpenTerminal && (
                <Button variant="outline" size="sm" onClick={handleOpen}>
                  <FolderOpen className="mr-1.5 size-3.5" />
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
