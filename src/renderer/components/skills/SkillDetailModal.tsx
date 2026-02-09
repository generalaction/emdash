import React, { useState, useEffect, useCallback } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Button } from '../ui/button';
import { Separator } from '../ui/separator';
import { Check, FolderOpen, Trash2 } from 'lucide-react';
import type { CatalogSkill } from '@shared/skills/types';
import { parseFrontmatter } from '@shared/skills/validation';
import { useIsMonochrome } from '../../hooks/useIsMonochrome';

const ModalSkillIcon: React.FC<{ skill: CatalogSkill }> = ({ skill }) => {
  const letter = skill.displayName.charAt(0).toUpperCase();
  const isMonochrome = useIsMonochrome(skill.iconUrl);

  if (skill.iconUrl) {
    return (
      <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center overflow-hidden rounded-xl bg-muted/40">
        <img
          src={skill.iconUrl}
          alt=""
          className={`h-10 w-10 rounded-lg object-contain${isMonochrome !== false ? ' dark:invert' : ''}`}
        />
      </div>
    );
  }

  return (
    <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-muted/40 text-base font-semibold text-foreground/60 dark:text-white">
      {letter}
    </div>
  );
};

interface SkillDetailModalProps {
  skill: CatalogSkill | null;
  isOpen: boolean;
  onClose: () => void;
  onInstall: (skillId: string) => Promise<boolean>;
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

  // Reset justInstalled when the modal opens with a different skill
  useEffect(() => {
    if (isOpen) setJustInstalled(false);
  }, [isOpen, skill?.id]);

  const handleInstall = useCallback(async () => {
    if (!skill) return;
    setIsProcessing(true);
    try {
      const success = await onInstall(skill.id);
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
            <ModalSkillIcon skill={skill} />
            <div className="min-w-0 flex-1">
              <DialogTitle className="text-base">{skill.displayName}</DialogTitle>
            </div>
          </div>
        </DialogHeader>

        {/* Source badge */}
        {skill.source !== 'local' && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <img
              src={
                skill.source === 'openai'
                  ? 'https://github.com/openai.png'
                  : 'https://github.com/anthropics.png'
              }
              alt=""
              className="h-3.5 w-3.5 rounded-full"
            />
            <span>From {skill.source === 'openai' ? 'OpenAI' : 'Anthropic'} skill library</span>
          </div>
        )}

        <Separator />

        {/* Default prompt */}
        {skill.defaultPrompt && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">Example prompt</p>
            <pre className="whitespace-pre-wrap break-words rounded-md bg-muted/40 px-3 py-2 text-xs text-foreground">
              {skill.defaultPrompt}
            </pre>
          </div>
        )}

        {/* SKILL.md body */}
        {body && (
          <div className="max-h-60 overflow-y-auto rounded-md bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
            <Markdown
              remarkPlugins={[remarkGfm]}
              components={{
                h1: ({ children }) => <h2 className="mb-1 mt-3 text-sm font-semibold text-foreground first:mt-0">{children}</h2>,
                h2: ({ children }) => <h3 className="mb-1 mt-3 text-sm font-semibold text-foreground first:mt-0">{children}</h3>,
                h3: ({ children }) => <h4 className="mb-1 mt-2 text-xs font-semibold text-foreground">{children}</h4>,
                p: ({ children }) => <p className="mb-2 leading-relaxed">{children}</p>,
                ul: ({ children }) => <ul className="mb-2 ml-4 list-disc space-y-0.5">{children}</ul>,
                ol: ({ children }) => <ol className="mb-2 ml-4 list-decimal space-y-0.5">{children}</ol>,
                li: ({ children }) => <li className="leading-relaxed">{children}</li>,
                code: ({ children, className }) => {
                  const isBlock = className?.includes('language-');
                  return isBlock
                    ? <code className="block overflow-x-auto rounded bg-muted/60 p-2 text-[11px]">{children}</code>
                    : <code className="rounded bg-muted/60 px-1 py-0.5 text-[11px]">{children}</code>;
                },
                pre: ({ children }) => <pre className="mb-2 overflow-x-auto">{children}</pre>,
                strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
                a: ({ href, children }) => <a href={href} className="text-primary underline" target="_blank" rel="noopener noreferrer">{children}</a>,
              }}
            >
              {body}
            </Markdown>
          </div>
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
