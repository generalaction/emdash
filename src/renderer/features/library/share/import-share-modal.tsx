import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { isAutomationQuery } from '@renderer/features/automations/automation-query-keys';
import { createPromptId } from '@renderer/features/library/prompts/prompt-library-view';
import { usePromptLibrary } from '@renderer/features/library/prompts/use-prompt-library';
import {
  asMounted,
  firstMountedProjectId,
  getProjectManagerStore,
  projectDisplayName,
} from '@renderer/features/projects/stores/project-selectors';
import { toast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import type { BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { agentMeta } from '@renderer/lib/providers/meta';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/lib/ui/select';
import { formatAutomationError, formatTriggerLabel } from '@shared/automations/format';
import type { ShareType } from '@shared/share';
import { isValidSkillName, parseFrontmatter } from '@shared/skills/validation';

type Props = BaseModalProps<void> & {
  type: ShareType;
  id: string;
};

export const ImportShareModal = observer(function ImportShareModal({
  type,
  id,
  onClose,
  onSuccess,
}: Props) {
  const queryClient = useQueryClient();
  const promptLibrary = usePromptLibrary();
  const [skillNameOverride, setSkillNameOverride] = useState('');
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [targetProjectId, setTargetProjectId] = useState(() => firstMountedProjectId());

  const mountedProjects =
    type === 'automation'
      ? [...getProjectManagerStore().projects.entries()]
          .filter(([, store]) => asMounted(store))
          .map(([projectId, store]) => ({
            id: projectId,
            name: projectDisplayName(store) ?? 'Untitled project',
          }))
      : [];

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

      if (share.payload.type === 'automation') {
        if (!targetProjectId) {
          throw new Error('Select a project to import this automation into.');
        }

        const automation = share.payload.automation;
        // Imported automations start paused so a shared cron never runs silently.
        // Only the shared agent provider is carried over; workspace and branch
        // fall back to project defaults at run time.
        const result = await rpc.automations.create({
          name: automation.name,
          description: automation.description ?? null,
          category: automation.category,
          trigger: automation.trigger,
          actions: automation.actions,
          taskConfig: automation.agentProviderId
            ? { initialConversation: { provider: automation.agentProviderId } }
            : null,
          projectId: targetProjectId,
          enabled: false,
          isDraft: false,
          deadlinePolicy: automation.deadlinePolicy,
          deadlineMs: automation.deadlineMs ?? null,
        });
        if (!result.success) throw new Error(formatAutomationError(result.error));
        void queryClient.invalidateQueries({
          predicate: (query) => isAutomationQuery(query.queryKey),
        });
        toast({ title: 'Automation added', description: 'It starts paused — resume to schedule.' });
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
  const missingAutomationProject = share?.payload.type === 'automation' && !targetProjectId;
  const title =
    type === 'skill'
      ? 'Import Skill'
      : type === 'automation'
        ? 'Import Automation'
        : 'Import Prompt';

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
        {share?.payload.type === 'automation' && (
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-medium">{share.payload.automation.name}</h3>
              {share.payload.automation.description ? (
                <p className="text-muted-foreground mt-1 text-xs">
                  {share.payload.automation.description}
                </p>
              ) : null}
              <p className="text-muted-foreground mt-1 text-xs">
                {formatTriggerLabel(share.payload.automation.trigger)} ·{' '}
                {share.payload.automation.trigger.tz} · {share.payload.automation.category}
                {share.payload.automation.agentProviderId
                  ? ` · ${agentMeta[share.payload.automation.agentProviderId].label}`
                  : ''}
              </p>
            </div>
            <pre className="bg-muted/20 text-muted-foreground max-h-60 overflow-auto rounded-md px-3 py-2 text-xs wrap-break-word whitespace-pre-wrap">
              {share.payload.automation.actions.map((action) => action.prompt).join('\n\n')}
            </pre>
            <div className="space-y-2">
              <Label htmlFor="shared-automation-project" className="text-xs">
                Project
              </Label>
              {mountedProjects.length > 0 ? (
                <Select
                  value={targetProjectId}
                  onValueChange={(value) => setTargetProjectId(value ?? undefined)}
                >
                  <SelectTrigger id="shared-automation-project" className="w-full">
                    <SelectValue placeholder="Select a project" />
                  </SelectTrigger>
                  <SelectContent>
                    {mountedProjects.map((project) => (
                      <SelectItem key={project.id} value={project.id}>
                        {project.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <p className="text-muted-foreground text-xs">
                  Add or open a project to import this automation.
                </p>
              )}
              <p className="text-muted-foreground text-xs">
                The automation is added paused, so it never runs without your review.
              </p>
            </div>
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
          disabled={!share || isPending || missingAutomationProject}
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
});

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
