import React, { useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { Button } from '../ui/button';
import { Separator } from '../ui/separator';
import { FolderOpen, Trash2 } from 'lucide-react';
import type { CatalogSkill } from '@shared/skills/types';
import { parseFrontmatter } from '@shared/skills/validation';

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

  if (!skill) return null;

  const letter = skill.displayName.charAt(0).toUpperCase();
  const bgColor = skill.brandColor || (skill.source === 'openai' ? '#10a37f' : '#d4a574');

  const body = skill.skillMdContent ? parseFrontmatter(skill.skillMdContent).body.trim() : '';

  const handleInstall = async () => {
    setIsProcessing(true);
    try {
      await onInstall(skill.id);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleUninstall = async () => {
    setIsProcessing(true);
    try {
      await onUninstall(skill.id);
      onClose();
    } finally {
      setIsProcessing(false);
    }
  };

  const handleOpen = () => {
    if (skill.localPath && onOpenTerminal) {
      onOpenTerminal(skill.localPath);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && !isProcessing && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-3">
            {skill.iconUrl ? (
              <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center overflow-hidden rounded-xl bg-muted/40">
                <img
                  src={skill.iconUrl}
                  alt=""
                  className="h-10 w-10 rounded-lg object-contain"
                />
              </div>
            ) : (
              <div
                className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl text-base font-semibold text-white"
                style={{ backgroundColor: bgColor }}
              >
                {letter}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <DialogTitle className="text-base">{skill.displayName}</DialogTitle>
              <DialogDescription className="text-xs">{skill.description}</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <Separator />

        {/* Default prompt */}
        {skill.defaultPrompt && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">Example prompt</p>
            <pre className="rounded-md bg-muted/40 px-3 py-2 text-xs text-foreground">
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
          {!skill.installed && (
            <Button size="sm" onClick={handleInstall} disabled={isProcessing}>
              {isProcessing ? 'Installing...' : 'Install'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default SkillDetailModal;
