import { useEffect, useRef } from 'react';
import type { Automation } from '@core/primitives/automations/api';
import type { ConversationConfig, TriggerConfig } from '@core/primitives/automations/api';
import { assertValidCronTrigger } from '@core/primitives/automations/api';
import { formatAutomationError } from './automation-run-format';
import { useAutomationTargetAvailability, useUpdateAutomation } from './use-automations';
import { useAutomationFormState } from './useAutomationFormState';

export type AutomationSettingsAutoSave = ReturnType<typeof useAutomationSettingsAutoSave>;

export function useAutomationSettingsAutoSave(automation: Automation, editable = true) {
  const formState = useAutomationFormState(automation);
  const update = useUpdateAutomation();

  const {
    effectiveProjectId,
    prompt,
    provider,
    model,
    triggerConfig,
    cronTz,
    canSave,
    buildTaskConfig,
    name,
    workspaceConfig,
  } = formState;
  const availability = useAutomationTargetAvailability(effectiveProjectId);

  function buildConversationConfig(): ConversationConfig {
    if (!provider) throw new Error('Cannot build automation conversation config without provider');
    const useChatUi = formState.initialConversation.useChatUi;
    return {
      prompt: prompt.trim(),
      provider,
      autoApprove: false,
      type: useChatUi ? 'acp' : 'pty',
      ...(model && { model }),
      ...(automation.conversationConfig?.title && {
        title: automation.conversationConfig.title,
      }),
    };
  }

  function savePatch(overrideTrigger?: TriggerConfig) {
    if (!editable) return;
    if (!effectiveProjectId || !provider) return;
    const activeTrigger = overrideTrigger ?? triggerConfig;
    const taskConfig = buildTaskConfig(effectiveProjectId);
    if (!taskConfig) return;
    try {
      assertValidCronTrigger(activeTrigger);
    } catch {
      return;
    }
    if (!name.trim() || !prompt.trim()) return;
    void update.mutateAsync({
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
    if (editable && canSave) savePatch();
    // We intentionally only track provider here; other fields use action-at-change-site.
    // oxlint-disable-next-line react/exhaustive-deps
  }, [provider]);

  // Workspace config changes (preset, branch name, sandbox toggle, etc.) are not
  // interceptable at the setter level because they go through useWorkspaceConfig
  // internals. Serialize the resolved config to a stable primitive key and auto-save
  // whenever it changes, mirroring the provider effect above.
  const resolvedConfigKey = JSON.stringify(workspaceConfig.resolvedConfig);
  const isFirstWorkspaceRender = useRef(true);
  useEffect(() => {
    if (isFirstWorkspaceRender.current) {
      isFirstWorkspaceRender.current = false;
      return;
    }
    if (editable && canSave) savePatch();
    // oxlint-disable-next-line react/exhaustive-deps
  }, [resolvedConfigKey]);

  function handlePromptBlur() {
    if (editable && canSave) savePatch();
  }

  function handleNameBlur() {
    if (!editable) return;
    const trimmed = name.trim();
    if (!trimmed || trimmed === automation.name) return;
    void update.mutateAsync({ id: automation.id, patch: { name: trimmed } });
  }

  const saveError = update.error
    ? formatAutomationError(update.error)
    : availability.data?.available === false
      ? availability.data.reason
      : null;

  return {
    formState,
    setCronExpr,
    handlePromptBlur,
    handleNameBlur,
    isSaving: update.isPending,
    saveError,
  };
}
