import { useQueryClient } from '@tanstack/react-query';
import React, { useState } from 'react';
import { isValidSkillName } from '@shared/skills/validation';
import { rpc } from '@renderer/lib/ipc';
import { BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { useCloseGuard } from '@renderer/lib/modal/use-close-guard';
import { Button } from '@renderer/lib/ui/button';
import { ConfirmButton } from '@renderer/lib/ui/confirm-button';
import {
  DialogContentArea,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/lib/ui/dialog';
import { Input } from '@renderer/lib/ui/input';
import { Label } from '@renderer/lib/ui/label';
import { Textarea } from '@renderer/lib/ui/textarea';
import { captureTelemetry } from '@renderer/utils/telemetryClient';

type Props = BaseModalProps<void>;

export function CreateSkillModal({ onSuccess, onClose }: Props) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [content, setContent] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  useCloseGuard(isCreating);

  const handleCreateSkill = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setCreateError(null);

    const trimmedName = name.trim();
    if (!isValidSkillName(trimmedName)) {
      setCreateError('Name must be lowercase letters, numbers, and hyphens (2-64 chars).');
      return;
    }
    if (!description.trim()) {
      setCreateError('Description is required.');
      return;
    }

    setIsCreating(true);
    try {
      const result = await rpc.skills.create({
        name: trimmedName,
        description: description.trim(),
        content: content.trim(),
      });

      if (!result.success) {
        setCreateError(result.error || 'Failed to create skill');
        return;
      }

      captureTelemetry('skill_created');
      await queryClient.invalidateQueries({ queryKey: ['skills', 'catalog'] });
      onSuccess();
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : 'Failed to create skill');
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <div className="flex flex-col gap-0.5">
          <DialogTitle>New Skill</DialogTitle>
        </div>
      </DialogHeader>

      <DialogContentArea>
        <form id="create-skill-form" onSubmit={handleCreateSkill} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="skill-name" className="text-xs">
              Name
            </Label>
            <Input
              id="skill-name"
              placeholder="my-skill"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setCreateError(null);
              }}
              className="text-sm"
            />
            <p className="text-[10px] text-muted-foreground">
              Lowercase letters, numbers, and hyphens
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="skill-desc" className="text-xs">
              Description
            </Label>
            <Input
              id="skill-desc"
              placeholder="What does this skill do?"
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
                setCreateError(null);
              }}
              className="text-sm"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="skill-content" className="text-xs">
              Instructions
            </Label>
            <Textarea
              id="skill-content"
              placeholder="Write the skill instructions here. The YAML frontmatter (name and description) will be added automatically."
              value={content}
              onChange={(e) => {
                setContent(e.target.value);
                setCreateError(null);
              }}
              className="min-h-[200px] font-mono text-sm"
            />
            <p className="text-[10px] text-muted-foreground">
              Define what this skill does and how agents should use it
            </p>
          </div>

          {createError && <p className="text-xs text-destructive">{createError}</p>}
        </form>
      </DialogContentArea>

      <DialogFooter className="gap-2 sm:gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={isCreating}>
          Cancel
        </Button>
        <ConfirmButton type="submit" form="create-skill-form" size="sm" disabled={isCreating}>
          {isCreating ? 'Creating...' : 'Create'}
        </ConfirmButton>
      </DialogFooter>
    </>
  );
}
