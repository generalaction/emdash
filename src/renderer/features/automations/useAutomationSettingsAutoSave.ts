import { useEffect, useRef } from 'react';
import type { Automation } from '@shared/core/automations/automation';
import type { ConversationConfig, TriggerConfig } from '@shared/core/automations/config';
import { assertValidCronTrigger } from '@shared/core/automations/validation';
import { formatAutomationError } from './automation-run-format';
import { useAutomations } from './use-automations';
import { useAutomationFormState } from './useAutomationFormState';

export type AutomationSettingsAutoSave = ReturnType<typeof useAutomationSettingsAutoSave>;

export function useAutomationSettingsAutoSave(automation: Automation) {
  const formState = useAutomationFormState(automation);
  const { updateSettings, rename } = useAutomations();

  const {
    effectiveProjectId,
    prompt,
    provider,
    triggerConfig,
    cronTz,
    canSave,
    buildTaskConfig,
    name,
  } = formState;

  function buildConversationConfig(): ConversationConfig {
    return { prompt: prompt.trim(), provider, autoApprove: false };
  }

  function savePatch(overrideTrigger?: TriggerConfig) {
    if (!effectiveProjectId) return;
    const activeTrigger = overrideTrigger ?? triggerConfig;
    const taskConfig = buildTaskConfig(effectiveProjectId);
    if (!taskConfig) return;
    try {
      assertValidCronTrigger(activeTrigger);
    } catch {
      return;
    }
    if (!name.trim() || !prompt.trim()) return;
    void updateSettings.mutateAsync({
      id: automation.id,
      patch: {
        triggerConfig: activeTrigger,
        conversationConfig: buildConversationConfig(),
        taskConfig,
        projectId: effectiveProjectId,
      },
    });
  }

  function setCronExpr(expr: string) {
    formState.setCronExpr(expr);
    savePatch({ expr, tz: cronTz });
  }

  // Provider lives inside the initialConversation sub-hook and is not directly
  // interceptable at the setter level, so watch it with a narrow effect.
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    if (canSave) savePatch();
    // We intentionally only track provider here; other fields use action-at-change-site.
    // oxlint-disable-next-line react/exhaustive-deps
  }, [provider]);

  function handlePromptBlur() {
    if (canSave) savePatch();
  }

  function handleNameBlur() {
    const trimmed = name.trim();
    if (!trimmed || trimmed === automation.name) return;
    void rename.mutateAsync({ id: automation.id, name: trimmed });
  }

  const saveError = updateSettings.error
    ? formatAutomationError(updateSettings.error)
    : rename.error
      ? formatAutomationError(rename.error)
      : null;

  return {
    formState,
    setCronExpr,
    handlePromptBlur,
    handleNameBlur,
    isSaving: updateSettings.isPending || rename.isPending,
    saveError,
  };
}
