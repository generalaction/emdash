import { ChevronDown } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@renderer/lib/ui/collapsible';
import { Field, FieldDescription, FieldTitle } from '@renderer/lib/ui/field';
import { Input } from '@renderer/lib/ui/input';
import { Separator } from '@renderer/lib/ui/separator';
import { Textarea } from '@renderer/lib/ui/textarea';
import type {
  FormState,
  FormUpdate,
  WorktreeLifecycleValidationErrors,
} from '../project-settings-form-model';

type WorktreeLifecycleSettingsSectionProps = {
  form: FormState;
  errors: WorktreeLifecycleValidationErrors;
  update: FormUpdate;
};

const ENVIRONMENT_VARIABLES = [
  'EMDASH_BRANCH_NAME',
  'EMDASH_TARGET_DIR',
  'EMDASH_WORKTREE_PATH',
  'EMDASH_PROJECT_ID',
  'EMDASH_TASK_ID',
  'EMDASH_WORKSPACE_ID',
  'EMDASH_PROJECT_PATH',
  'EMDASH_SOURCE_BRANCH',
];

export function WorktreeLifecycleSettingsSection({
  form,
  errors,
  update,
}: WorktreeLifecycleSettingsSectionProps) {
  const hasCustomLifecycle = Boolean(
    form.worktreeCreateCommand.trim() ||
    form.worktreeTeardownCommand.trim() ||
    form.worktreeWorkingDirectory.trim()
  );

  return (
    <>
      <Separator />
      <Collapsible defaultOpen={hasCustomLifecycle}>
        <div className="flex flex-col gap-4">
          <CollapsibleTrigger className="group flex w-full items-center justify-between gap-3 rounded-md px-0 py-1 text-left">
            <div className="flex min-w-0 flex-col gap-1">
              <FieldTitle>Advanced worktree lifecycle</FieldTitle>
              <FieldDescription className="text-foreground-muted">
                Leave blank to use Emdash&apos;s default git worktree flow.
              </FieldDescription>
            </div>
            <ChevronDown className="size-4 shrink-0 text-foreground-muted transition-transform group-data-[panel-open]:rotate-180" />
          </CollapsibleTrigger>

          <CollapsibleContent className="flex flex-col gap-4">
            <Field>
              <FieldTitle>Create command</FieldTitle>
              <FieldDescription className="text-foreground-muted">
                Runs instead of the built-in worktree creation command for new task worktrees.
              </FieldDescription>
              <Textarea
                rows={3}
                placeholder={'graft create "$EMDASH_BRANCH_NAME" "$EMDASH_TARGET_DIR"'}
                value={form.worktreeCreateCommand}
                onChange={(e) => update('worktreeCreateCommand', e.target.value)}
              />
            </Field>

            <Field>
              <FieldTitle>Delete command</FieldTitle>
              <FieldDescription className="text-foreground-muted">
                Runs when deleting a task worktree. Leave blank to use Emdash&apos;s default
                cleanup.
              </FieldDescription>
              <Textarea
                rows={3}
                placeholder={'graft remove "$EMDASH_WORKTREE_PATH"'}
                value={form.worktreeTeardownCommand}
                onChange={(e) => update('worktreeTeardownCommand', e.target.value)}
              />
            </Field>

            <Field>
              <FieldTitle>Agent working directory</FieldTitle>
              <FieldDescription className="text-foreground-muted">
                Optional relative path where agent sessions should start inside each worktree.
              </FieldDescription>
              <Input
                aria-invalid={errors.worktreeWorkingDirectory ? true : undefined}
                placeholder="services/web"
                value={form.worktreeWorkingDirectory}
                onChange={(e) => update('worktreeWorkingDirectory', e.target.value)}
              />
              {errors.worktreeWorkingDirectory ? (
                <p className="text-xs text-foreground-error">{errors.worktreeWorkingDirectory}</p>
              ) : null}
            </Field>

            <div className="border-border-muted bg-background-muted/40 flex flex-col gap-2 rounded-md border p-3 text-xs text-foreground-muted">
              <div className="font-medium text-foreground">Available variables</div>
              <div className="flex flex-wrap gap-1.5">
                {ENVIRONMENT_VARIABLES.map((variable) => (
                  <code
                    key={variable}
                    className="border-border-muted rounded border bg-background px-1.5 py-0.5"
                  >
                    {variable}
                  </code>
                ))}
              </div>
              <div>
                Example sparse checkout setup: create with{' '}
                <code>
                  graft create &quot;$EMDASH_BRANCH_NAME&quot; &quot;$EMDASH_TARGET_DIR&quot;
                </code>{' '}
                and delete with <code>graft remove &quot;$EMDASH_WORKTREE_PATH&quot;</code>.
              </div>
            </div>
          </CollapsibleContent>
        </div>
      </Collapsible>
    </>
  );
}
