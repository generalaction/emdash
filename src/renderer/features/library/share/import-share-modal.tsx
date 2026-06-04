import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { createPromptId } from '@renderer/features/library/prompts/prompt-library-view';
import { usePromptLibrary } from '@renderer/features/library/prompts/use-prompt-library';
import { toast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import type { BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import { ConfirmButton } from '@renderer/lib/ui/confirm-button';
import {
  DialogContentArea,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/lib/ui/dialog';
import { Input } from '@renderer/lib/ui/input';
import { Label } from '@renderer/lib/ui/label';
import { MarkdownRenderer } from '@renderer/lib/ui/markdown-renderer';
import type { ShareType } from '@shared/share';
import { isValidSkillName, parseFrontmatter } from '@shared/skills/validation';

type Props = BaseModalProps<void> & {
  type: ShareType;
  id: string;
};

export function ImportShareModal({ type, id, onClose, onSuccess }: Props) {
  const queryClient = useQueryClient();
  const promptLibrary = usePromptLibrary();
  const [skillNameOverride, setSkillNameOverride] = useState('');
  const [inlineError, setInlineError] = useState<string | null>(null);

  const shareQuery = useQuery({
    queryKey: ['share', type, id],
    queryFn: async () => {
      const result = await rpc.share.fetch({ type, id });
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
  });

  const importMutation = useMutation({
    mutationFn: async () => {
      const share = shareQuery.data;
      if (!share) throw new Error('Share not loaded');

      if (share.payload.type === 'prompt') {
        if (promptLibrary.isLoading) {
          throw new Error('Prompt library is still loading');
        }

        await promptLibrary.updateAsync([
          ...promptLibrary.value,
          {
            id: createPromptId(),
            title: share.payload.prompt.title,
            prompt: share.payload.prompt.prompt,
          },
        ]);
        toast({ title: 'Prompt added' });
        onSuccess();
        return;
      }

      const { frontmatter, body } = parseFrontmatter(share.payload.skill.skillMdContent);
      const name = skillNameOverride.trim() || frontmatter.name || share.payload.skill.name;
      if (!isValidSkillName(name)) {
        throw new Error('Name must be lowercase letters, numbers, and hyphens.');
      }

      const result = await rpc.skills.create({
        name,
        description: frontmatter.description || share.payload.skill.description,
        content: body.trim(),
      });
      if (!result.success) throw new Error(result.error);
      await queryClient.invalidateQueries({ queryKey: ['skills', 'catalog'] });
      toast({ title: 'Skill added' });
      onSuccess();
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : 'Failed to import share';
      setInlineError(message);
    },
  });

  const share = shareQuery.data;
  const isPromptLibraryLoading = share?.payload.type === 'prompt' && promptLibrary.isLoading;
  const isPending = shareQuery.isLoading || isPromptLibraryLoading || importMutation.isPending;
  const title = type === 'skill' ? 'Import Skill' : 'Import Prompt';

  return (
    <>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
      </DialogHeader>

      <DialogContentArea>
        {shareQuery.isLoading && <ImportShimmer />}
        {shareQuery.isError && (
          <p className="text-destructive text-sm">
            {shareQuery.error instanceof Error ? shareQuery.error.message : 'Failed to load share'}
          </p>
        )}
        {share?.payload.type === 'skill' && (
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-medium">{share.payload.skill.displayName}</h3>
              <p className="text-muted-foreground mt-1 text-xs">
                {share.payload.skill.description}
              </p>
            </div>
            {inlineError?.includes('already exists') && (
              <div className="space-y-2">
                <Label htmlFor="shared-skill-name" className="text-xs">
                  Rename skill
                </Label>
                <Input
                  id="shared-skill-name"
                  value={skillNameOverride}
                  onChange={(event) => {
                    setSkillNameOverride(event.target.value);
                    setInlineError(null);
                  }}
                  placeholder={share.payload.skill.name}
                />
              </div>
            )}
            <MarkdownRenderer
              content={parseFrontmatter(share.payload.skill.skillMdContent).body.trim()}
              variant="compact"
              className="bg-muted/20 text-muted-foreground rounded-md px-3 py-2 text-xs"
            />
          </div>
        )}
        {share?.payload.type === 'prompt' && (
          <div className="space-y-3">
            <h3 className="text-sm font-medium">{share.payload.prompt.title}</h3>
            <pre className="bg-muted/20 text-muted-foreground max-h-80 overflow-auto rounded-md px-3 py-2 text-xs wrap-break-word whitespace-pre-wrap">
              {share.payload.prompt.prompt}
            </pre>
          </div>
        )}
        {inlineError && <p className="text-destructive mt-3 text-xs">{inlineError}</p>}
      </DialogContentArea>

      <DialogFooter className="gap-2 sm:gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={isPending}>
          Cancel
        </Button>
        <ConfirmButton
          size="sm"
          disabled={!share || isPending}
          onClick={() => {
            setInlineError(null);
            importMutation.mutate();
          }}
        >
          {importMutation.isPending ? 'Adding...' : 'Add to library'}
        </ConfirmButton>
      </DialogFooter>
    </>
  );
}

function ImportShimmer() {
  return (
    <div className="min-h-32 space-y-3 rounded-md border border-border bg-background-quaternary-1 px-3 py-3">
      <Loader2 className="text-muted-foreground h-4 w-4 animate-spin" />
      <div className="h-3 w-48 animate-pulse rounded-full bg-foreground/10" />
      <div className="h-3 w-full animate-pulse rounded-full bg-foreground/10" />
      <div className="h-3 w-2/3 animate-pulse rounded-full bg-foreground/10" />
    </div>
  );
}
