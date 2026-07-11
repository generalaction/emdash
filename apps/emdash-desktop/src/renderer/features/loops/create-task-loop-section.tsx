import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { Button } from '@renderer/lib/ui/button';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldTitle,
} from '@renderer/lib/ui/field';
import { Input } from '@renderer/lib/ui/input';
import { Switch } from '@renderer/lib/ui/switch';
import { Textarea } from '@renderer/lib/ui/textarea';
import {
  normalizeLoopPlan,
  validateLoopPlanDraft,
  type LoopPlanDraft,
  type LoopWorkPhaseDraft,
} from './loop-plan-model';

export type CreateTaskLoopSectionProps = {
  value: LoopPlanDraft;
  onChange: (draft: LoopPlanDraft) => void;
};

function nextPhaseId(phases: LoopWorkPhaseDraft[]): string {
  const used = new Set(phases.map((phase) => phase.id));
  let ordinal = phases.length + 1;
  while (used.has(`work-${ordinal}`)) ordinal += 1;
  return `work-${ordinal}`;
}

export function CreateTaskLoopSection({ value, onChange }: CreateTaskLoopSectionProps) {
  const { value: experiments, isLoading } = useAppSettingsKey('experiments');
  const [errors, setErrors] = useState<string[]>([]);

  if (isLoading || !experiments?.loops) return null;

  const goalInvalid = errors.includes('Add a goal for this Loop.');
  const update = (patch: Partial<LoopPlanDraft>): void => {
    onChange({ ...value, ...patch });
  };

  const updatePhase = (phaseId: string, patch: Partial<LoopWorkPhaseDraft>): void => {
    update({
      workPhases: value.workPhases.map((phase) =>
        phase.id === phaseId ? { ...phase, ...patch } : phase
      ),
    });
  };

  const buildPhases = (): void => {
    const normalized = normalizeLoopPlan({
      goal: value.goal,
      planSource: value.planSource,
      terminalGates: value.terminalGates,
    });
    setErrors(validateLoopPlanDraft(normalized));
    onChange(normalized);
  };

  return (
    <section
      role="region"
      aria-label="Loop plan"
      className="flex w-full flex-col gap-4 rounded-lg border border-border bg-background-1 p-4"
    >
      <Field orientation="horizontal">
        <Switch
          checked={value.enabled}
          aria-label="Create this task with a Loop"
          onCheckedChange={(enabled) => update({ enabled })}
        />
        <div className="flex flex-col gap-0.5">
          <FieldLabel>Create with Loop</FieldLabel>
          <FieldDescription>
            Run this task as editable work phases with optional terminal verification.
          </FieldDescription>
        </div>
      </Field>

      {value.enabled ? (
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="loop-goal">Goal</FieldLabel>
            <Textarea
              id="loop-goal"
              aria-label="Loop goal"
              aria-invalid={goalInvalid}
              aria-describedby={goalInvalid ? 'loop-plan-errors' : undefined}
              value={value.goal}
              placeholder="Describe the outcome this Loop should deliver"
              onInput={(event) => update({ goal: event.currentTarget.value })}
            />
          </Field>

          <Field>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex flex-col gap-0.5">
                <FieldLabel htmlFor="loop-plan-source">Plan</FieldLabel>
                <FieldDescription>
                  Paste Markdown headings, numbered items, or checklist items to build work phases.
                </FieldDescription>
              </div>
              <Button type="button" size="sm" variant="secondary" onClick={buildPhases}>
                Build phases
              </Button>
            </div>
            <Textarea
              id="loop-plan-source"
              aria-label="Pasted plan"
              value={value.planSource}
              placeholder={'## Implement\n## Test\n## Polish'}
              onInput={(event) => update({ planSource: event.currentTarget.value })}
            />
          </Field>

          <div className="flex items-center justify-between gap-3">
            <FieldTitle>Work phases</FieldTitle>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => {
                const id = nextPhaseId(value.workPhases);
                update({
                  workPhases: [
                    ...value.workPhases,
                    {
                      id,
                      kind: 'work',
                      name: `Phase ${value.workPhases.length + 1}`,
                      goal: '',
                    },
                  ],
                });
              }}
            >
              <Plus className="size-3.5" />
              Add phase
            </Button>
          </div>

          <div className="grid gap-3">
            {value.workPhases.map((phase, index) => (
              <div
                key={phase.id}
                className="flex flex-col gap-2 rounded-md border border-border bg-background p-3"
              >
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs text-foreground-passive">{index + 1}</span>
                  <Input
                    aria-label={`Phase ${index + 1} name`}
                    value={phase.name}
                    onInput={(event) => updatePhase(phase.id, { name: event.currentTarget.value })}
                  />
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Remove ${phase.name || `Phase ${index + 1}`}`}
                    disabled={value.workPhases.length === 1}
                    onClick={() =>
                      update({
                        workPhases: value.workPhases.filter((item) => item.id !== phase.id),
                      })
                    }
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
                <Textarea
                  aria-label={`Phase ${index + 1} goal`}
                  value={phase.goal}
                  placeholder="Describe what this phase should complete"
                  onInput={(event) => updatePhase(phase.id, { goal: event.currentTarget.value })}
                />
              </div>
            ))}
          </div>

          <div role="group" aria-label="Terminal gates" className="grid gap-3">
            <Field orientation="horizontal">
              <Switch
                checked={value.terminalGates.review}
                aria-label="Run terminal Review"
                onCheckedChange={(review) =>
                  update({ terminalGates: { ...value.terminalGates, review } })
                }
              />
              <div className="flex flex-col gap-0.5">
                <FieldLabel>Review</FieldLabel>
                <FieldDescription>
                  Review and correct the complete change after all work phases.
                </FieldDescription>
              </div>
            </Field>
            <Field orientation="horizontal">
              <Switch
                checked={value.terminalGates.e2e}
                aria-label="Run clean-room E2E"
                onCheckedChange={(e2e) =>
                  update({ terminalGates: { ...value.terminalGates, e2e } })
                }
              />
              <div className="flex flex-col gap-0.5">
                <FieldLabel>E2E</FieldLabel>
                <FieldDescription>
                  Verify independently in a clean workspace after Review when both are selected.
                </FieldDescription>
              </div>
            </Field>
          </div>

          {errors.length > 0 ? (
            <FieldError id="loop-plan-errors" errors={errors.map((message) => ({ message }))} />
          ) : null}
        </FieldGroup>
      ) : null}
    </section>
  );
}
