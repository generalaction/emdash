import { Download, ExternalLink, FolderOpen, Trash2, X } from 'lucide-react';
import React, { useCallback, useState } from 'react';
import type { CatalogSkill } from '@shared/skills/types';
import { parseFrontmatter } from '@shared/skills/validation';
import { Button } from '@renderer/lib/ui/button';
import { ConfirmButton } from '@renderer/lib/ui/confirm-button';
import {
  Dialog,
  DialogClose,
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
  isLoading: boolean;
  isOpen: boolean;
  onClose: () => void;
  onInstall: (skillId: string) => Promise<boolean>;
  onUninstall: (skillId: string) => Promise<boolean>;
  onOpenTerminal?: (skillPath: string) => void;
}

function getSourceLabel(source: CatalogSkill['source']): string {
  if (source === 'skillssh') return 'skills.sh';
  if (source === 'openai') return 'OpenAI';
  return 'Anthropic';
}

function getSourceIconUrl(source: CatalogSkill['source']): string {
  if (source === 'skillssh') return 'https://github.com/vercel.png';
  if (source === 'openai') return 'https://github.com/openai.png';
  return 'https://github.com/anthropics.png';
}

function SkillDetailLoadingText() {
  return (
    <div className="space-y-2 rounded-md bg-muted/20 px-3 py-3" aria-label="Loading skill details">
      <div className="h-3 w-4/5 animate-pulse rounded bg-gradient-to-r from-muted/40 via-muted/70 to-muted/40" />
      <div className="h-3 w-full animate-pulse rounded bg-gradient-to-r from-muted/40 via-muted/70 to-muted/40" />
      <div className="h-3 w-11/12 animate-pulse rounded bg-gradient-to-r from-muted/40 via-muted/70 to-muted/40" />
      <div className="h-3 w-2/3 animate-pulse rounded bg-gradient-to-r from-muted/40 via-muted/70 to-muted/40" />
    </div>
  );
}

const SkillDetailModal: React.FC<SkillDetailModalProps> = ({
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
  const description = skill.description?.trim() || skill.frontmatter.description?.trim() || '';

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && !isProcessing && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader showCloseButton={false} className="min-w-0 flex-1 pr-10">
          <div className="flex items-start gap-3">
            <SkillIconRenderer skill={skill} size="md" />
            <div className="min-w-0 flex-1">
              <DialogTitle className="text-base font-sans normal-case tracking-normal text-foreground">
                {skill.displayName}
              </DialogTitle>
              {skill.source !== 'local' && (
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5">
                    <img
                      src={getSourceIconUrl(skill.source)}
                      alt=""
                      className="h-3.5 w-3.5 rounded-sm"
                    />
                    {getSourceLabel(skill.source)}
                  </span>
                  {skill.repoSlug && (
                    <>
                      <span aria-hidden className="text-muted-foreground/40">
                        ·
                      </span>
                      {skill.sourceUrl ? (
                        <a
                          href={`https://github.com/${skill.repoSlug}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-0.5 hover:text-foreground"
                        >
                          {skill.repoSlug}
                          <ExternalLink className="h-2.5 w-2.5" />
                        </a>
                      ) : (
                        <span>{skill.repoSlug}</span>
                      )}
                    </>
                  )}
                  {skill.installs !== undefined && (
                    <>
                      <span aria-hidden className="text-muted-foreground/40">
                        ·
                      </span>
                      <span className="inline-flex items-center gap-0.5">
                        <Download className="h-3 w-3" />
                        {skill.installs.toLocaleString()} installs
                      </span>
                    </>
                  )}
                </div>
              )}
              {description && (
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{description}</p>
              )}
            </div>
          </div>
        </DialogHeader>
        <DialogClose
          render={
            <button
              type="button"
              disabled={isProcessing}
              className="absolute right-4 top-4 inline-flex h-8 w-8 items-center justify-center rounded-md bg-background/80 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
              aria-label="Close"
            />
          }
        >
          <X aria-hidden className="h-4 w-4" />
        </DialogClose>
        <DialogContentArea>
          {skill.defaultPrompt && (
            <div className="space-y-1 rounded-md bg-muted/40 pb-2">
              <p className="text-xs font-medium text-muted-foreground">Example prompt</p>
              <pre className="whitespace-pre-wrap wrap-break-word text-xs text-foreground">
                {skill.defaultPrompt}
              </pre>
            </div>
          )}

          {body ? (
            <MarkdownRenderer
              content={body}
              variant="compact"
              className="rounded-md bg-muted/20 px-3 py-2 text-xs text-muted-foreground"
            />
          ) : (
            isLoading && <SkillDetailLoadingText />
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
