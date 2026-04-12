import React, { useState, useEffect, useCallback } from 'react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { MarkdownRenderer } from '../ui/markdown-renderer';
import { Button } from '../ui/button';
import { Separator } from '../ui/separator';
import { Check, FolderOpen, Trash2 } from 'lucide-react';
import type { CatalogSkill } from '@shared/skills/types';
import { parseFrontmatter } from '@shared/skills/validation';
import { skillSourceIcons } from '../../lib/skillIcons';
import { useTheme } from '../../hooks/useTheme';
import SkillIconRenderer from './SkillIconRenderer';

function processSourceSvg(raw: string, fillColor: string): string {
  return raw
    .replace(/\bwidth="[^"]*"/g, '')
    .replace(/\bheight="[^"]*"/g, '')
    .replace('<svg ', `<svg fill="${fillColor}" class="h-full w-full" `);
}

function getSourceLabel(source: string): string {
  if (source === 'openai') return 'OpenAI';
  if (source === 'anthropic') return 'Anthropic';
  return source;
}

const SkillSourceBadge: React.FC<{ skill: CatalogSkill; isDark: boolean }> = ({
  skill,
  isDark,
}) => {
  if (skill.source === 'local') return null;

  if (skill.source === 'skills-sh') {
    return (
      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <span className="flex h-5 w-5 items-center justify-center rounded-sm bg-neutral-900 text-[10px] font-bold text-white dark:bg-white dark:text-neutral-900">
          S
        </span>
        <span>
          From{' '}
          <a
            href={
              skill.owner && skill.repo
                ? `https://skills.sh/${skill.owner}/${skill.repo}/${skill.id}`
                : 'https://skills.sh'
            }
            target="_blank"
            rel="noopener noreferrer"
            className="underline decoration-muted-foreground/40 underline-offset-2 hover:decoration-foreground"
          >
            skills.sh
          </a>
          {skill.owner && <span className="text-muted-foreground/60"> · {skill.owner}</span>}
        </span>
      </div>
    );
  }

  const srcIcon = skillSourceIcons[skill.source];
  const label = getSourceLabel(skill.source);

  return (
    <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
      {srcIcon && (
        <div
          className="flex h-5 w-5 items-center justify-center rounded-sm bg-muted/60 p-0.5"
          dangerouslySetInnerHTML={{
            __html: processSourceSvg(srcIcon.data, isDark ? '#ffffff' : `#${srcIcon.color}`),
          }}
        />
      )}
      <span>From {label} skill library</span>
    </div>
  );
};

interface SkillDetailModalProps {
  skill: CatalogSkill | null;
  isOpen: boolean;
  onClose: () => void;
  onInstall: (skillId: string, source?: { owner: string; repo: string }) => Promise<boolean>;
  onUninstall: (skillId: string) => Promise<boolean>;
  onOpenTerminal?: (skillPath: string) => void;
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
  const [justInstalled, setJustInstalled] = useState(false);
  const { effectiveTheme } = useTheme();
  const isDark = effectiveTheme !== 'light';

  useEffect(() => {
    if (isOpen) setJustInstalled(false);
  }, [isOpen, skill?.id]);

  const handleInstall = useCallback(async () => {
    if (!skill) return;
    setIsProcessing(true);
    try {
      const source =
        skill.source === 'skills-sh' && skill.owner && skill.repo
          ? { owner: skill.owner, repo: skill.repo }
          : undefined;
      const success = await onInstall(skill.id, source);
      if (success) setJustInstalled(true);
    } finally {
      setIsProcessing(false);
    }
  }, [skill, onInstall]);

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
              <DialogTitle className="text-base">{skill.displayName}</DialogTitle>
            </div>
          </div>
        </DialogHeader>

        <SkillSourceBadge skill={skill} isDark={isDark} />

        <Separator />

        {skill.defaultPrompt && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">Example prompt</p>
            <pre className="whitespace-pre-wrap break-words rounded-md bg-muted/40 px-3 py-2 text-xs text-foreground">
              {skill.defaultPrompt}
            </pre>
          </div>
        )}

        {body && (
          <MarkdownRenderer
            content={body}
            variant="compact"
            className="max-h-60 overflow-y-auto rounded-md bg-muted/20 px-3 py-2 text-xs text-muted-foreground"
          />
        )}

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
          {!skill.installed && !justInstalled && (
            <Button size="sm" onClick={handleInstall} disabled={isProcessing}>
              {isProcessing ? 'Installing...' : 'Install'}
            </Button>
          )}
          {justInstalled && (
            <Button size="sm" variant="outline" disabled>
              <Check className="mr-1.5 h-3.5 w-3.5" />
              Installed
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default SkillDetailModal;
