import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { loopsStore } from '@renderer/features/loops/loops-store';
import { AgentIcon } from '@renderer/lib/components/agent-icon';
import { useFeatureFlag } from '@renderer/lib/hooks/useFeatureFlag';
import { type BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { useCloseGuard } from '@renderer/lib/modal/use-close-guard';
import { Button } from '@renderer/lib/ui/button';
import { Checkbox } from '@renderer/lib/ui/checkbox';
import { ConfirmButton } from '@renderer/lib/ui/confirm-button';
import {
  DialogContentArea,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/lib/ui/dialog';
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldTitle,
} from '@renderer/lib/ui/field';
import { Input } from '@renderer/lib/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/lib/ui/select';
import { Switch } from '@renderer/lib/ui/switch';
import { Textarea } from '@renderer/lib/ui/textarea';
import { cn } from '@renderer/utils/utils';
import {
  DEFAULT_LOOP_PROVIDER,
  LOOP_PROVIDER_IDS,
  VERIFIER_IDS,
  type LoopProviderId,
  type LoopVerifierAvailability,
  type VerifierId,
} from '@shared/core/loops/loops';
import {
  buildCreateLoopParams,
  defaultVerifier,
  makeCriterion,
  makePhase,
  moveItem,
  type DraftAgentBrowserConfig,
  type DraftCriterion,
  type DraftPhase,
  validationError,
} from './create-loop-form-model';
import { verifierLabel } from './loop-format';

const LOOP_PROVIDER_LABELS: Record<LoopProviderId, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
};

function fallbackAvailability(): LoopVerifierAvailability[] {
  return VERIFIER_IDS.map((id) => ({
    id,
    label: verifierLabel(id),
    available: false,
    reason: 'Checking availability',
  }));
}

export function CreateLoopModal({
  onSuccess,
  onClose,
  projectId,
  taskId,
}: BaseModalProps<{ loopId: string }> & {
  projectId: string;
  taskId: string;
}) {
  const [name, setName] = useState('');
  const [provider, setProvider] = useState<LoopProviderId>(DEFAULT_LOOP_PROVIDER);
  const [phases, setPhases] = useState<DraftPhase[]>(() => [makePhase(0)]);
  const [selectedVerifiers, setSelectedVerifiers] = useState<Set<VerifierId>>(() => new Set());
  const [validationCommands, setValidationCommands] = useState<string[]>(['pnpm run test']);
  const [agentBrowser, setAgentBrowser] = useState<DraftAgentBrowserConfig>({
    targetUrl: '',
    cdpPort: '',
  });
  const [reviewEnabled, setReviewEnabled] = useState(false);
  const [availability, setAvailability] =
    useState<LoopVerifierAvailability[]>(fallbackAvailability);
  const [availabilityError, setAvailabilityError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const chatUiEnabled = useFeatureFlag('chat-ui');

  useCloseGuard(isSubmitting);

  useEffect(() => {
    let cancelled = false;
    void loopsStore.getVerifierAvailability(taskId).then((result) => {
      if (cancelled) return;
      if (result.success) {
        setAvailability(result.data);
        setAvailabilityError(null);
      } else {
        setAvailability(fallbackAvailability());
        const message =
          result.error && typeof result.error === 'object' && 'message' in result.error
            ? String(result.error.message)
            : 'Unable to check verifier availability.';
        setAvailabilityError(message);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [taskId]);

  const availabilityById = useMemo(
    () => new Map(availability.map((item) => [item.id, item])),
    [availability]
  );

  const selectedVerifierArray = useMemo(() => Array.from(selectedVerifiers), [selectedVerifiers]);
  const agentBrowserSelected = selectedVerifiers.has('agent-browser');

  const firstSelectedOrAvailableVerifier = useCallback((): VerifierId => {
    return (
      selectedVerifierArray[0] ?? availability.find((item) => item.available)?.id ?? defaultVerifier
    );
  }, [availability, selectedVerifierArray]);

  const blockingError =
    availabilityError ??
    validationError({
      name,
      phases,
      validationCommands,
      selectedVerifiers,
      availability,
      agentBrowser,
    });
  const error = submitError ?? blockingError;

  const toggleVerifier = (verifierId: VerifierId, checked: boolean): void => {
    setSelectedVerifiers((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(verifierId);
      } else {
        next.delete(verifierId);
      }
      return next;
    });
  };

  const updatePhase = (phaseId: string, patch: Partial<DraftPhase>): void => {
    setPhases((current) =>
      current.map((phase) => (phase.id === phaseId ? { ...phase, ...patch } : phase))
    );
  };

  const updateCriterion = (
    phaseId: string,
    criterionId: string,
    patch: Partial<DraftCriterion>
  ): void => {
    setPhases((current) =>
      current.map((phase) =>
        phase.id === phaseId
          ? {
              ...phase,
              criteria: phase.criteria.map((criterion) =>
                criterion.id === criterionId ? { ...criterion, ...patch } : criterion
              ),
            }
          : phase
      )
    );
  };

  const removeCriterion = (phaseId: string, criterionId: string): void => {
    setPhases((current) =>
      current.map((phase) =>
        phase.id === phaseId && phase.criteria.length > 1
          ? {
              ...phase,
              criteria: phase.criteria.filter((criterion) => criterion.id !== criterionId),
            }
          : phase
      )
    );
  };

  const handleVerifierPickedForCriterion = (
    phaseId: string,
    criterionId: string,
    verifier: VerifierId
  ): void => {
    updateCriterion(phaseId, criterionId, { verifier });
    if (availabilityById.get(verifier)?.available) toggleVerifier(verifier, true);
  };

  const handleSubmit = async (): Promise<void> => {
    const currentValidationError = validationError({
      name,
      phases,
      validationCommands,
      selectedVerifiers,
      availability,
      agentBrowser,
    });
    if (currentValidationError || isSubmitting) {
      setSubmitError(currentValidationError);
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);
    const result = await loopsStore.createLoop(
      buildCreateLoopParams({
        projectId,
        taskId,
        name,
        provider: chatUiEnabled ? provider : undefined,
        planSource: 'manual',
        validationCommands,
        selectedVerifiers,
        reviewEnabled,
        phases,
        agentBrowser,
      })
    );
    setIsSubmitting(false);

    if (result.success) {
      onSuccess({ loopId: result.data.id });
      return;
    }

    const message =
      result.error && typeof result.error === 'object' && 'message' in result.error
        ? String(result.error.message)
        : 'Failed to create loop.';
    setSubmitError(message);
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Create Loop</DialogTitle>
      </DialogHeader>
      <DialogContentArea className="gap-5">
        <FieldGroup>
          <Field>
            <FieldLabel>Loop name</FieldLabel>
            <Input
              autoFocus
              value={name}
              placeholder="Cookie consent rollout"
              onChange={(event) => setName(event.target.value)}
            />
          </Field>

          {chatUiEnabled ? (
            <Field>
              <FieldLabel>Agent</FieldLabel>
              <Select
                value={provider}
                onValueChange={(value) => setProvider(value as LoopProviderId)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue>
                    <AgentIcon id={provider} size={16} className="rounded-sm" />
                    {LOOP_PROVIDER_LABELS[provider]}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {LOOP_PROVIDER_IDS.map((providerId) => (
                    <SelectItem key={providerId} value={providerId}>
                      <AgentIcon id={providerId} size={16} className="rounded-sm" />
                      {LOOP_PROVIDER_LABELS[providerId]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          ) : null}

          <Field>
            <div className="flex items-center justify-between gap-3">
              <FieldTitle>Verifiers</FieldTitle>
              <span className="text-xs text-foreground-passive">Unit tests always run first</span>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {availability.map((item) => (
                <label
                  key={item.id}
                  className={cn(
                    'flex min-h-14 items-start gap-2 rounded-md border border-border bg-background-1 p-2 text-sm',
                    !item.available && 'opacity-60'
                  )}
                >
                  <Checkbox
                    checked={selectedVerifiers.has(item.id)}
                    disabled={!item.available}
                    onCheckedChange={(checked) => toggleVerifier(item.id, checked === true)}
                    className="mt-0.5"
                  />
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate text-foreground">{item.label}</span>
                    <span className="line-clamp-2 text-xs text-foreground-passive">
                      {item.available ? 'Available' : (item.reason ?? 'Unavailable')}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </Field>

          {agentBrowserSelected ? (
            <Field>
              <div className="flex flex-col gap-0.5">
                <FieldTitle>Agent Browser target</FieldTitle>
                <FieldDescription>
                  Optional target for the verification agent to open or attach to.
                </FieldDescription>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-foreground-passive">Target URL</span>
                  <Input
                    value={agentBrowser.targetUrl}
                    placeholder="http://localhost:5173"
                    onChange={(event) =>
                      setAgentBrowser((current) => ({
                        ...current,
                        targetUrl: event.target.value,
                      }))
                    }
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-foreground-passive">CDP port</span>
                  <Input
                    value={agentBrowser.cdpPort}
                    inputMode="numeric"
                    placeholder="9222"
                    onChange={(event) =>
                      setAgentBrowser((current) => ({
                        ...current,
                        cdpPort: event.target.value,
                      }))
                    }
                  />
                </label>
              </div>
            </Field>
          ) : null}

          <Field>
            <div className="flex items-center justify-between gap-3">
              <FieldTitle>Validation commands</FieldTitle>
              <Button
                size="xs"
                variant="secondary"
                onClick={() => setValidationCommands((current) => [...current, ''])}
              >
                <Plus className="size-3" />
                Add
              </Button>
            </div>
            <div className="flex flex-col gap-2">
              {validationCommands.map((command, index) => (
                <div key={index} className="flex items-center gap-2">
                  <Input
                    value={command}
                    placeholder="pnpm run test"
                    onChange={(event) =>
                      setValidationCommands((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index ? event.target.value : item
                        )
                      )
                    }
                  />
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    disabled={validationCommands.length === 1}
                    onClick={() =>
                      setValidationCommands((current) =>
                        current.filter((_item, itemIndex) => itemIndex !== index)
                      )
                    }
                    aria-label="Remove validation command"
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          </Field>

          <Field orientation="horizontal">
            <Switch checked={reviewEnabled} onCheckedChange={setReviewEnabled} />
            <div className="flex flex-col gap-0.5">
              <FieldLabel>Review agent</FieldLabel>
              <FieldDescription>
                Require a review pass before each phase is accepted.
              </FieldDescription>
            </div>
          </Field>
        </FieldGroup>

        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-normal text-foreground">Phases</h3>
          <Button
            size="sm"
            variant="secondary"
            onClick={() =>
              setPhases((current) => [
                ...current,
                makePhase(current.length, firstSelectedOrAvailableVerifier()),
              ])
            }
          >
            <Plus className="size-3.5" />
            Add phase
          </Button>
        </div>

        <div className="flex flex-col gap-3">
          {phases.map((phase, phaseIndex) => (
            <div
              key={phase.id}
              className="flex flex-col gap-3 rounded-lg border border-border bg-background-1 p-3"
            >
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs text-foreground-passive">{phaseIndex + 1}</span>
                <Input
                  value={phase.name}
                  onChange={(event) => updatePhase(phase.id, { name: event.target.value })}
                  placeholder={`Phase ${phaseIndex + 1}`}
                  className="h-7"
                />
                <Button
                  size="icon-sm"
                  variant="ghost"
                  disabled={phaseIndex === 0}
                  onClick={() =>
                    setPhases((current) => moveItem(current, phaseIndex, phaseIndex - 1))
                  }
                  aria-label="Move phase up"
                >
                  <ArrowUp className="size-3.5" />
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  disabled={phaseIndex === phases.length - 1}
                  onClick={() =>
                    setPhases((current) => moveItem(current, phaseIndex, phaseIndex + 1))
                  }
                  aria-label="Move phase down"
                >
                  <ArrowDown className="size-3.5" />
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  disabled={phases.length === 1}
                  onClick={() =>
                    setPhases((current) => current.filter((item) => item.id !== phase.id))
                  }
                  aria-label="Remove phase"
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>

              <Textarea
                value={phase.goal}
                onChange={(event) => updatePhase(phase.id, { goal: event.target.value })}
                placeholder="Describe what the agent should complete in this phase"
                className="min-h-20"
              />

              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-3">
                  <FieldTitle className="text-xs">Pass criteria</FieldTitle>
                  <Button
                    size="xs"
                    variant="secondary"
                    onClick={() =>
                      updatePhase(phase.id, {
                        criteria: [
                          ...phase.criteria,
                          makeCriterion(firstSelectedOrAvailableVerifier()),
                        ],
                      })
                    }
                  >
                    <Plus className="size-3" />
                    Add
                  </Button>
                </div>
                {phase.criteria.map((criterion) => {
                  const selectedVerifier = availabilityById.get(criterion.verifier);
                  return (
                    <div key={criterion.id} className="flex items-start gap-2">
                      <Input
                        value={criterion.description}
                        onChange={(event) =>
                          updateCriterion(phase.id, criterion.id, {
                            description: event.target.value,
                          })
                        }
                        placeholder="The banner can be accepted and dismissed"
                      />
                      <Select
                        value={criterion.verifier}
                        onValueChange={(value) =>
                          handleVerifierPickedForCriterion(
                            phase.id,
                            criterion.id,
                            value as VerifierId
                          )
                        }
                      >
                        <SelectTrigger className="w-44">
                          <SelectValue>
                            {selectedVerifier?.label ?? verifierLabel(criterion.verifier)}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {availability.map((item) => (
                            <SelectItem key={item.id} value={item.id} disabled={!item.available}>
                              {item.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        disabled={phase.criteria.length === 1}
                        onClick={() => removeCriterion(phase.id, criterion.id)}
                        aria-label="Remove pass criterion"
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {error ? <p className="text-xs text-foreground-destructive">{error}</p> : null}
      </DialogContentArea>
      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
          Cancel
        </Button>
        <ConfirmButton
          onClick={() => void handleSubmit()}
          disabled={isSubmitting || blockingError !== null}
        >
          {isSubmitting ? 'Creating...' : 'Create loop'}
        </ConfirmButton>
      </DialogFooter>
    </>
  );
}
