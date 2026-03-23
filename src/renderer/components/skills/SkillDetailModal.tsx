import React, { useState, useEffect, useCallback } from 'react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { MarkdownRenderer } from '../ui/markdown-renderer';
import { Button } from '../ui/button';
import { Separator } from '../ui/separator';
import { Check, FolderOpen, Trash2 } from 'lucide-react';
import type { CatalogSkill } from '@shared/skills/types';
import { parseFrontmatter } from '@shared/skills/validation';
import { useIsMonochrome } from '../../hooks/useIsMonochrome';
import { skillIconMap, skillSourceIcons } from '../../lib/skillIcons';
import { useTheme } from '../../hooks/useTheme';

const ModalSkillIcon: React.FC<{ skill: CatalogSkill }> = ({ skill }) => {
  const [iconUrlError, setIconUrlError] = useState(false);
  const [avatarError, setAvatarError] = useState(false);
  const letter = skill.displayName.charAt(0).toUpperCase();
  const { effectiveTheme } = useTheme();
  const isDark = effectiveTheme === 'dark' || effectiveTheme === 'dark-black';

  // 1. Bundled icon by skill ID, then by source
  const iconDef = skillIconMap[skill.id] ?? skillSourceIcons[skill.source];

  // Only probe monochrome for remote URLs we'll actually render
  const remoteUrl = !iconDef ? skill.iconUrl : undefined;
  const isMonochrome = useIsMonochrome(remoteUrl);

  if (iconDef) {
    let processed = iconDef.data;
    if (iconDef.preserveColors) {
      processed = processed.replace(/\bwidth="[^"]*"/g, '').replace(/\bheight="[^"]*"/g, '');
    } else {
      const fillColor = isDark ? '#ffffff' : `#${iconDef.color}`;
      processed = processed
        .replace(/\bwidth="[^"]*"/g, '')
        .replace(/\bheight="[^"]*"/g, '')
        .replace('<svg ', `<svg fill="${fillColor}" `);
    }
    processed = processed.replace('<svg ', '<svg class="h-full w-full" ');

    return (
      <div
        className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-muted/40 p-2.5"
        dangerouslySetInnerHTML={{ __html: processed }}
      />
    );
  }

  // 2. Remote iconUrl (incl. GitHub avatars for skills.sh)
  if (skill.iconUrl && !iconUrlError) {
    const isAvatar = skill.iconUrl.includes('github.com/') && skill.iconUrl.includes('.png');
    return (
      <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center overflow-hidden rounded-xl bg-muted/40 p-2">
        <img
          src={skill.iconUrl}
          alt=""
          className={`h-full w-full object-contain ${isAvatar ? 'rounded-lg' : `rounded-lg ${isMonochrome !== false ? 'dark:invert' : ''}`}`.trim()}
          onError={() => setIconUrlError(true)}
        />
      </div>
    );
  }

  // 3. Owner GitHub avatar fallback (separate error state)
  if (skill.source === 'skills-sh' && skill.owner && !avatarError) {
    const avatarUrl = `https://github.com/${skill.owner}.png?size=80`;
    if (skill.iconUrl === avatarUrl && iconUrlError) {
      // iconUrl was already this avatar and it failed — skip
    } else {
      return (
        <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center overflow-hidden rounded-xl bg-muted/40 p-2">
          <img
            src={avatarUrl}
            alt=""
            className="h-full w-full rounded-lg object-cover"
            onError={() => setAvatarError(true)}
          />
        </div>
      );
    }
  }

  // 4. Letter fallback
  return (
    <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-muted/40 text-base font-semibold text-foreground/60">
      {letter}
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
  const isDark = effectiveTheme === 'dark' || effectiveTheme === 'dark-black';

  // Reset justInstalled when the modal opens with a different skill
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
            <ModalSkillIcon skill={skill} />
            <div className="min-w-0 flex-1">
              <DialogTitle className="text-base">{skill.displayName}</DialogTitle>
            </div>
          </div>
        </DialogHeader>

        {skill.source !== 'local' && (
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            {skill.source === 'skills-sh' ? (
              <>
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
                  {skill.owner && (
                    <span className="text-muted-foreground/60"> · {skill.owner}</span>
                  )}
                </span>
              </>
            ) : (
              (() => {
                const srcIcon = skillSourceIcons[skill.source];
                if (srcIcon) {
                  let svg = srcIcon.data
                    .replace(/\bwidth="[^"]*"/g, '')
                    .replace(/\bheight="[^"]*"/g, '');
                  const fc = isDark ? '#ffffff' : `#${srcIcon.color}`;
                  svg = svg.replace('<svg ', `<svg fill="${fc}" class="h-full w-full" `);
                  return (
                    <>
                      <div
                        className="flex h-5 w-5 items-center justify-center rounded-sm bg-muted/60 p-0.5"
                        dangerouslySetInnerHTML={{ __html: svg }}
                      />
                      <span>
                        From {skill.source === 'openai' ? 'OpenAI' : 'Anthropic'} skill library
                      </span>
                    </>
                  );
                }
                return (
                  <span>
                    From {skill.source === 'openai' ? 'OpenAI' : 'Anthropic'} skill library
                  </span>
                );
              })()
            )}
          </div>
        )}

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
