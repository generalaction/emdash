import { Field, FieldLabel } from '@renderer/lib/ui/field';
import { Input } from '@renderer/lib/ui/input';
import type { BranchNameState } from './use-branch-name';

interface BranchNameFieldProps {
  state: Pick<BranchNameState, 'branchName' | 'setBranchName' | 'branchAlreadyExists'>;
}

export function BranchNameField({ state }: BranchNameFieldProps) {
  const { branchName, setBranchName, branchAlreadyExists } = state;

  return (
    <Field>
      <FieldLabel className="flex items-center gap-1.5">Branch name</FieldLabel>
      <Input
        value={branchName}
        onChange={(e) => setBranchName(e.target.value)}
        placeholder="branch-name"
        className="font-mono text-sm"
      />
      {branchAlreadyExists && (
        <p className="text-muted-foreground mt-1 text-xs">
          This branch already exists, so the task will check it out instead of creating a new one.
        </p>
      )}
    </Field>
  );
}
