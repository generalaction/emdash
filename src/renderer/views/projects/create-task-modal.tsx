import { useState } from 'react';
import { ProviderId } from '@shared/agent-provider-registry';
import { Branch } from '@shared/git';
import AgentSelector from '@renderer/components/AgentSelector';
import { Button } from '@renderer/components/ui/button';
import {
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/components/ui/dialog';
import { Field, FieldGroup, FieldLabel } from '@renderer/components/ui/field';
import { Input } from '@renderer/components/ui/input';
import { Switch } from '@renderer/components/ui/switch';
import { Textarea } from '@renderer/components/ui/textarea';
import { BaseModalProps } from '@renderer/contexts/ModalProvider';
import { BranchSelector } from './branch-selector';
import { useRepositoryContext } from './repository-provider';

export function CreateTaskModal({ onClose, onSuccess }: BaseModalProps) {
  const { branches, defaultBranch } = useRepositoryContext();
  const [selectedBranch, setSelectedBranch] = useState<Branch | undefined>(
    defaultBranch ? { type: 'local', branch: defaultBranch.name } : undefined
  );
  const [providerId, setProviderId] = useState<ProviderId>('claude');
  const [createBranchAndWorktree, setCreateBranchAndWorktree] = useState(true);
  const [autoApprove, setAutoApprove] = useState(false);

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Create Task</DialogTitle>
      </DialogHeader>
      <div className="flex flex-col gap-2 w-full">
        <FieldGroup>
          <Field>
            <FieldLabel>From Branch</FieldLabel>
            <BranchSelector
              branches={branches}
              value={selectedBranch}
              onValueChange={setSelectedBranch}
            />
          </Field>
          <Field>
            <FieldLabel>Task name</FieldLabel>
            <Input />
          </Field>
          <Field>
            <FieldLabel>Agent</FieldLabel>
            <AgentSelector value={providerId} onChange={setProviderId} />
          </Field>
          <Field orientation="horizontal">
            <Switch
              checked={createBranchAndWorktree}
              onCheckedChange={setCreateBranchAndWorktree}
            />
            <FieldLabel>Create task branch and worktree</FieldLabel>
          </Field>
          <Field>
            <FieldLabel>Attach an issue</FieldLabel>
            <Input />
          </Field>
          <Field>
            <FieldLabel>Initial prompt</FieldLabel>
            <Textarea />
          </Field>
          <Field orientation="horizontal">
            <Switch checked={autoApprove} onCheckedChange={setAutoApprove} />
            <FieldLabel>Auto approve</FieldLabel>
          </Field>
        </FieldGroup>
      </div>
      <DialogFooter>
        <Button>Create</Button>
      </DialogFooter>
    </DialogContent>
  );
}
